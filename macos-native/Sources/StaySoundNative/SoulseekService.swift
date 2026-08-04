import Foundation

@MainActor
final class SoulseekService: ObservableObject {
    @Published var credentials: SoulseekCredentials
    @Published private(set) var results: [SoulseekMatch] = []
    @Published private(set) var isSearching = false
    @Published private(set) var downloadingIDs = Set<String>()
    @Published private(set) var message = ""
    @Published private(set) var lastDownloadedURL: URL?

    private var bridgeProcess: Process?
    private let baseURL = URL(string: "http://127.0.0.1:4317")!

    init() {
        credentials = SoulseekCredentials(
            username: UserDefaults.standard.string(forKey: "native.soulseek.username") ?? "",
            password: UserDefaults.standard.string(forKey: "native.soulseek.password") ?? ""
        )
        startBridgeIfNeeded()
    }

    func saveCredentials() {
        UserDefaults.standard.set(credentials.username, forKey: "native.soulseek.username")
        UserDefaults.standard.set(credentials.password, forKey: "native.soulseek.password")
    }

    func search(_ query: String) {
        let cleaned = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        saveCredentials()
        isSearching = true
        message = "Buscando en Soulseek…"

        Task {
            do {
                let body = SearchBody(query: cleaned, timeoutMs: 9_000, maxResults: 50, credentials: credentials)
                let response: SearchResponse = try await post(path: "search", body: body)
                results = response.results
                message = response.results.isEmpty ? "Sin resultados." : "\(response.results.count) resultados"
            } catch {
                message = error.localizedDescription
            }
            isSearching = false
        }
    }

    func download(_ match: SoulseekMatch) {
        downloadingIDs.insert(match.id)
        message = "Descargando \(URL(fileURLWithPath: match.filename).lastPathComponent)…"
        Task {
            do {
                let body = DownloadBody(match: match, filename: nil, credentials: credentials)
                let response: DownloadResponse = try await post(path: "download", body: body)
                message = "Guardado: \(response.filename)"
                lastDownloadedURL = newestSoulseekDownload()
            } catch {
                message = error.localizedDescription
            }
            downloadingIDs.remove(match.id)
        }
    }

    private func newestSoulseekDownload() -> URL? {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Music/StaySound/SoulseekBridge", isDirectory: true)
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        ) else { return nil }
        return files
            .filter { (try? $0.resourceValues(forKeys: keys).isRegularFile) == true }
            .max {
                let left = (try? $0.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
                let right = (try? $1.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
                return left < right
            }
    }

    private func startBridgeIfNeeded() {
        guard bridgeProcess == nil else { return }
        let candidates = [
            Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/staysound-soulseek-bridge"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("../src-tauri/binaries/staysound-soulseek-bridge-aarch64-apple-darwin")
                .standardizedFileURL,
        ]
        guard let executable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) else {
            message = "El bridge de Soulseek no está disponible en esta compilación."
            return
        }
        let process = Process()
        process.executableURL = executable
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            bridgeProcess = process
        } catch {
            message = "No se pudo iniciar Soulseek: \(error.localizedDescription)"
        }
    }

    private func post<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 35
        let (data, urlResponse) = try await URLSession.shared.data(for: request)
        guard let http = urlResponse as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let errorPayload = try? JSONDecoder().decode(BridgeError.self, from: data)
            throw NSError(
                domain: "StaySoundSoulseek",
                code: (urlResponse as? HTTPURLResponse)?.statusCode ?? -1,
                userInfo: [NSLocalizedDescriptionKey: errorPayload?.error ?? "Soulseek no respondió correctamente."]
            )
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}

private struct SearchBody: Encodable {
    let query: String
    let timeoutMs: Int
    let maxResults: Int
    let credentials: SoulseekCredentials
}

private struct SearchResponse: Decodable {
    let results: [SoulseekMatch]
}

private struct DownloadBody: Encodable {
    let match: SoulseekMatch
    let filename: String?
    let credentials: SoulseekCredentials
}

private struct DownloadResponse: Decodable {
    let url: String
    let filename: String
    let mimeType: String
    let size: Int
}

private struct BridgeError: Decodable {
    let error: String
}
