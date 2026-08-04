import AppKit
import AVFoundation
import Foundation
import UniformTypeIdentifiers

@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var tracks: [Track] = []
    @Published var isImporting = false
    @Published var importMessage = ""
    @Published var searchText = ""

    var currentFolderPath: String? {
        UserDefaults.standard.string(forKey: "native.library.folder")
    }

    private let supportedExtensions: Set<String> = [
        "3gp", "aac", "ac3", "aif", "aiff", "alac", "amr", "ape", "caf",
        "dff", "dsf", "flac", "m4a", "mka", "mp3", "mp4", "mpc", "oga",
        "ogg", "opus", "tak", "tta", "wav", "wave", "webm", "wma", "wv"
    ]

    init() {
        loadCatalog()
        if let path = UserDefaults.standard.string(forKey: "native.library.folder") {
            Task { [weak self] in
                self?.importFolder(URL(fileURLWithPath: path, isDirectory: true))
            }
        }
    }

    var filteredTracks: [Track] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return tracks }
        return tracks.filter {
            $0.title.localizedCaseInsensitiveContains(query)
                || $0.artist.localizedCaseInsensitiveContains(query)
                || $0.album.localizedCaseInsensitiveContains(query)
        }
    }

    var albums: [AlbumGroup] {
        Dictionary(grouping: filteredTracks) { "\($0.artist)\u{0}\($0.album)" }
            .values
            .map { grouped in
                AlbumGroup(
                    name: grouped.first?.album ?? "Álbum desconocido",
                    artist: grouped.first?.artist ?? "Artista desconocido",
                    tracks: grouped.sorted { ($0.trackNumber ?? 999) < ($1.trackNumber ?? 999) }
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var artists: [ArtistGroup] {
        Dictionary(grouping: filteredTracks, by: \.artist)
            .map { ArtistGroup(name: $0.key, tracks: $0.value) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func chooseFolder() {
        let panel = NSOpenPanel()
        panel.title = "Selecciona tu carpeta de música"
        panel.prompt = "Importar carpeta"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.resolvesAliases = true
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        importFolder(folder)
    }

    func importFolder(_ folder: URL) {
        isImporting = true
        importMessage = "Buscando canciones…"

        let extensions = supportedExtensions
        Task {
            let imported = await Task.detached(priority: .userInitiated) {
                Self.scan(folder: folder, supportedExtensions: extensions)
            }.value
            tracks = imported
            importMessage = "\(imported.count) canciones importadas"
            isImporting = false
            UserDefaults.standard.set(folder.path, forKey: "native.library.folder")
            saveCatalog()
        }
    }

    func rescanRememberedFolder() {
        guard let path = UserDefaults.standard.string(forKey: "native.library.folder") else {
            chooseFolder()
            return
        }
        importFolder(URL(fileURLWithPath: path, isDirectory: true))
    }

    func clearLibrary() {
        tracks = []
        searchText = ""
        importMessage = "Biblioteca vaciada"
        UserDefaults.standard.removeObject(forKey: "native.library.folder")
        if let url = catalogURL { try? FileManager.default.removeItem(at: url) }
    }

    func importDownloadedFile(_ url: URL) {
        let resolved = url.resolvingSymlinksInPath().standardizedFileURL
        guard FileManager.default.fileExists(atPath: resolved.path),
              !tracks.contains(where: { $0.id == resolved.path }) else { return }
        Task {
            let track = await Task.detached(priority: .userInitiated) {
                Self.readMetadata(from: resolved)
            }.value
            tracks.append(track)
            tracks.sort {
                let artist = $0.artist.localizedCaseInsensitiveCompare($1.artist)
                if artist != .orderedSame { return artist == .orderedAscending }
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
            importMessage = "Descarga agregada: \(track.title)"
            saveCatalog()
        }
    }

    nonisolated private static func scan(folder: URL, supportedExtensions: Set<String>) -> [Track] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .isHiddenKey]
        let enumerator = FileManager.default.enumerator(
            at: folder,
            includingPropertiesForKeys: keys + [.contentTypeKey],
            options: [.skipsPackageDescendants]
        )
        var result: [Track] = []
        var seenPaths = Set<String>()

        while let url = enumerator?.nextObject() as? URL {
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .contentTypeKey])
            guard values?.isRegularFile == true else { continue }
            let extensionMatch = supportedExtensions.contains(url.pathExtension.lowercased())
            let typeMatch = values?.contentType?.conforms(to: .audio) == true
            guard extensionMatch || typeMatch else { continue }
            let resolved = url.resolvingSymlinksInPath().standardizedFileURL
            guard seenPaths.insert(resolved.path).inserted else { continue }
            result.append(readMetadata(from: resolved))
        }

        return result.sorted {
            let artist = $0.artist.localizedCaseInsensitiveCompare($1.artist)
            if artist != .orderedSame { return artist == .orderedAscending }
            let album = $0.album.localizedCaseInsensitiveCompare($1.album)
            if album != .orderedSame { return album == .orderedAscending }
            if let left = $0.trackNumber, let right = $1.trackNumber, left != right { return left < right }
            return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
        }
    }

    nonisolated private static func readMetadata(from url: URL) -> Track {
        let asset = AVURLAsset(url: url)
        var title = url.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: #"-\d{10,}$"#, with: "", options: .regularExpression)
        var artist = "Artista desconocido"
        var album = url.deletingLastPathComponent().lastPathComponent
        var trackNumber: Int?

        if let sidecar = readMetadataSidecar(for: url) {
            title = sidecar.title?.nonEmpty ?? title
            artist = sidecar.artist?.nonEmpty ?? artist
            album = sidecar.album?.nonEmpty ?? album
            trackNumber = sidecar.trackNumber
        }

        for item in asset.commonMetadata {
            switch item.commonKey {
            case .commonKeyTitle:
                if let value = item.stringValue, !value.isEmpty { title = value }
            case .commonKeyArtist:
                if let value = item.stringValue, !value.isEmpty { artist = value }
            case .commonKeyAlbumName:
                if let value = item.stringValue, !value.isEmpty { album = value }
            default:
                break
            }

            if item.identifier?.rawValue.localizedCaseInsensitiveContains("track") == true,
               let number = item.numberValue?.intValue {
                trackNumber = number
            }
        }

        if artist == "Artista desconocido" {
            let pieces = title.components(separatedBy: " - ").map { $0.trimmingCharacters(in: .whitespaces) }
            if pieces.count >= 2 {
                artist = pieces[0]
                title = pieces.dropFirst().joined(separator: " - ")
            }
        }

        let assetDuration = asset.duration.seconds
        let duration = assetDuration.isFinite ? assetDuration : 0
        return Track(
            fileURL: url,
            title: title,
            artist: artist,
            album: album,
            duration: duration,
            trackNumber: trackNumber
        )
    }

    nonisolated private static func readMetadataSidecar(for audioURL: URL) -> MetadataSidecar? {
        let sidecarURL = audioURL.deletingPathExtension().appendingPathExtension("json")
        guard let data = try? Data(contentsOf: sidecarURL) else { return nil }
        return try? JSONDecoder().decode(MetadataSidecar.self, from: data)
    }

    private var catalogURL: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let folder = base.appendingPathComponent("StaySoundNative", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("library.json")
    }

    private func loadCatalog() {
        guard let url = catalogURL,
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([Track].self, from: data) else { return }
        tracks = decoded.filter { FileManager.default.fileExists(atPath: $0.fileURL.path) }
    }

    private func saveCatalog() {
        guard let url = catalogURL, let data = try? JSONEncoder().encode(tracks) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

private struct MetadataSidecar: Decodable {
    let title: String?
    let artist: String?
    let album: String?
    let artwork: String?
    let trackNumber: Int?
}

private extension String {
    var nonEmpty: String? {
        let cleaned = trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }
}
