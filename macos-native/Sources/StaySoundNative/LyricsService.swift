import Foundation

@MainActor
final class LyricsService: ObservableObject {
    @Published private(set) var lines: [LyricLine] = []
    @Published private(set) var isLoading = false
    @Published private(set) var source = ""
    @Published private(set) var message = "Reproduce una canción para ver sus letras."

    private var loadingTrackID: String?
    private var generation = 0
    private var memoryCache: [String: CachedLyrics] = [:]

    func load(for track: Track?, force: Bool = false) {
        guard let track else {
            generation += 1
            loadingTrackID = nil
            lines = []
            source = ""
            message = "Reproduce una canción para ver sus letras."
            isLoading = false
            return
        }
        guard force || loadingTrackID != track.id else { return }

        generation += 1
        let requestGeneration = generation
        loadingTrackID = track.id
        isLoading = true
        lines = []
        source = ""
        message = "Buscando letra sincronizada…"

        let key = Self.cacheKey(for: track)
        if !force, let cached = memoryCache[key] ?? Self.readCache(key: key) {
            memoryCache[key] = cached
            apply(cached, for: track.id, generation: requestGeneration)
            if cached.source == "LRCLIB", !cached.lines.contains(where: { !$0.words.isEmpty }) {
                upgradeToWordLyrics(track: track, key: key, generation: requestGeneration)
            }
            return
        }

        Task {
            if let local = Self.localLyrics(for: track), !local.isEmpty {
                let cached = CachedLyrics(lines: local, source: "ARCHIVO LOCAL", savedAt: Date())
                guard generation == requestGeneration, loadingTrackID == track.id else { return }
                memoryCache[key] = cached
                Self.writeCache(cached, key: key)
                apply(cached, for: track.id, generation: requestGeneration)
                return
            }

            async let wordLyrics = Self.fetchKpoe(track: track)
            async let lineLyrics = Self.fetchLineLyrics(track: track)

            if let fastLine = await lineLyrics {
                guard generation == requestGeneration, loadingTrackID == track.id else { return }
                memoryCache[key] = fastLine
                Self.writeCache(fastLine, key: key)
                apply(fastLine, for: track.id, generation: requestGeneration)
            }

            let fetched = await wordLyrics
            guard generation == requestGeneration, loadingTrackID == track.id else { return }

            if let fetched, !fetched.lines.isEmpty {
                memoryCache[key] = fetched
                Self.writeCache(fetched, key: key)
                lines = fetched.lines
                source = fetched.source
                message = ""
            } else if lines.isEmpty {
                lines = []
                source = ""
                message = "No encontramos una letra sincronizada para esta versión."
            }
            isLoading = false
        }
    }

    func reload(for track: Track) {
        let key = Self.cacheKey(for: track)
        memoryCache.removeValue(forKey: key)
        Self.removeCache(key: key)
        loadingTrackID = nil
        load(for: track, force: true)
    }

    private func apply(_ cached: CachedLyrics, for trackID: String, generation: Int) {
        guard self.generation == generation, loadingTrackID == trackID else { return }
        lines = cached.lines
        source = cached.source
        message = cached.lines.isEmpty ? "No encontramos una letra sincronizada para esta versión." : ""
        isLoading = false
    }

    private func upgradeToWordLyrics(track: Track, key: String, generation: Int) {
        Task {
            guard let wordLyrics = await Self.fetchKpoe(track: track), !wordLyrics.lines.isEmpty,
                  self.generation == generation, loadingTrackID == track.id else { return }
            memoryCache[key] = wordLyrics
            Self.writeCache(wordLyrics, key: key)
            apply(wordLyrics, for: track.id, generation: generation)
        }
    }
}

private extension LyricsService {
    struct CachedLyrics: Codable, Sendable {
        let lines: [LyricLine]
        let source: String
        let savedAt: Date
    }

    struct LRCLIBResult: Decodable, Sendable {
        let trackName: String?
        let artistName: String?
        let albumName: String?
        let duration: Double?
        let instrumental: Bool?
        let syncedLyrics: String?
    }

    struct KpoePayload: Decodable, Sendable {
        let metadata: KpoeMetadata?
        let lyrics: [KpoeLine]?
    }

    struct KpoeMetadata: Decodable, Sendable {
        let source: String?
    }

    struct KpoeLine: Decodable, Sendable {
        let time: Double?
        let duration: Double?
        let text: String?
        let syllabus: [KpoeSyllable]?
    }

    struct KpoeSyllable: Decodable, Sendable {
        let time: Double?
        let duration: Double?
        let text: String?
        let isBackground: Bool?
    }

    nonisolated static func fetch(track: Track) async -> CachedLyrics? {
        if let local = localLyrics(for: track), !local.isEmpty {
            return CachedLyrics(lines: local, source: "ARCHIVO LOCAL", savedAt: Date())
        }

        if let kpoe = await fetchKpoe(track: track), !kpoe.lines.isEmpty {
            return kpoe
        }

        if let exact = await fetchLRCLIBExact(track: track), !exact.isEmpty {
            return CachedLyrics(lines: exact, source: "LRCLIB", savedAt: Date())
        }

        if let searched = await fetchLRCLIBSearch(track: track), !searched.isEmpty {
            return CachedLyrics(lines: searched, source: "LRCLIB", savedAt: Date())
        }

        return nil
    }

    nonisolated static func fetchLineLyrics(track: Track) async -> CachedLyrics? {
        if let searched = await fetchLRCLIBSearch(track: track), !searched.isEmpty {
            return CachedLyrics(lines: searched, source: "LRCLIB", savedAt: Date())
        }
        if let exact = await fetchLRCLIBExact(track: track), !exact.isEmpty {
            return CachedLyrics(lines: exact, source: "LRCLIB", savedAt: Date())
        }
        return nil
    }

    nonisolated static func localLyrics(for track: Track) -> [LyricLine]? {
        let base = track.fileURL.deletingPathExtension()
        let candidates = [base.appendingPathExtension("lrc"), base.appendingPathExtension("LRC")]
        for url in candidates {
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            let parsed = parseLRC(text, fallbackDuration: track.duration)
            if !parsed.isEmpty { return parsed }
        }
        return nil
    }

    nonisolated static func fetchKpoe(track: Track) async -> CachedLyrics? {
        let title = cleanMetadata(track.title)
        let artist = cleanMetadata(track.artist)
        guard !title.isEmpty, !artist.isEmpty, !isUnknown(artist) else { return nil }

        let mirrors = [
            "https://lyrics.geeked.wtf",
            "https://lyricsplus.prjktla.workers.dev",
            "https://lyricsplus.binimum.org",
            "https://lyricsplus.atomix.one",
            "https://lyricsplus-seven.vercel.app",
            "https://lyrics-plus-backend.vercel.app",
        ]
        let sources = "lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word"

        // am-lyrics-style waterfall: the canonical backend gets the first chance.
        // Avoid a structured task group here: leaving a group waits for slow/limited
        // mirrors even after one has already returned good lyrics.
        for mirror in mirrors {
            for includeMetadata in [false, true] {
                    var components = URLComponents(string: "\(mirror)/v2/lyrics/get")!
                    var items = [
                        URLQueryItem(name: "title", value: title),
                        URLQueryItem(name: "artist", value: artist),
                        URLQueryItem(name: "source", value: sources),
                    ]
                    if includeMetadata, !track.album.isEmpty, !isUnknown(track.album) {
                        items.append(URLQueryItem(name: "album", value: cleanMetadata(track.album)))
                    }
                    if includeMetadata, track.duration > 0 {
                        items.append(URLQueryItem(name: "duration", value: String(Int(track.duration.rounded()))))
                    }
                    components.queryItems = items
                    guard let url = components.url,
                          let payload: KpoePayload = await requestJSON(url, timeout: mirror.contains("geeked.wtf") ? 6 : 8) else {
                        continue
                    }
                    let parsed = parseKpoe(payload, fallbackDuration: track.duration)
                    guard !parsed.isEmpty else { continue }
                    let provider = payload.metadata?.source?.trimmingCharacters(in: .whitespacesAndNewlines)
                    return CachedLyrics(
                        lines: parsed,
                        source: provider?.isEmpty == false ? provider!.uppercased() : "LYRICSPLUS",
                        savedAt: Date()
                    )
            }
        }
        return nil
    }

    nonisolated static func fetchLRCLIBExact(track: Track) async -> [LyricLine]? {
        let variants = metadataVariants(track)
        for variant in variants {
            var components = URLComponents(string: "https://lrclib.net/api/get")!
            var items = [
                URLQueryItem(name: "track_name", value: variant.title),
                URLQueryItem(name: "artist_name", value: variant.artist),
            ]
            if !variant.album.isEmpty { items.append(URLQueryItem(name: "album_name", value: variant.album)) }
            if variant.useDuration, track.duration > 0 {
                items.append(URLQueryItem(name: "duration", value: String(Int(track.duration.rounded()))))
            }
            components.queryItems = items
            guard let url = components.url,
                  let result: LRCLIBResult = await requestJSON(url, timeout: 8),
                  result.instrumental != true,
                  let synced = result.syncedLyrics else { continue }
            let parsed = parseLRC(synced, fallbackDuration: result.duration ?? track.duration)
            if !parsed.isEmpty { return parsed }
        }
        return nil
    }

    nonisolated static func fetchLRCLIBSearch(track: Track) async -> [LyricLine]? {
        let cleanTitle = cleanMetadata(track.title)
        let cleanArtist = cleanMetadata(track.artist)
        let queries = ["\(cleanTitle) \(cleanArtist)", cleanTitle, "\(track.title) \(track.artist)"]

        for query in Array(NSOrderedSet(array: queries)).compactMap({ $0 as? String }) where !query.isEmpty {
            var components = URLComponents(string: "https://lrclib.net/api/search")!
            components.queryItems = [URLQueryItem(name: "q", value: query)]
            guard let url = components.url,
                  let results: [LRCLIBResult] = await requestJSON(url, timeout: 9) else { continue }

            let candidates = results
                .filter { $0.instrumental != true && $0.syncedLyrics?.isEmpty == false }
                .sorted { score($0, for: track) > score($1, for: track) }
            for candidate in candidates.prefix(4) {
                guard let synced = candidate.syncedLyrics else { continue }
                let parsed = parseLRC(synced, fallbackDuration: candidate.duration ?? track.duration)
                if !parsed.isEmpty { return parsed }
            }
        }
        return nil
    }

    nonisolated static func requestJSON<Value: Decodable & Sendable>(_ url: URL, timeout: TimeInterval) async -> Value? {
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("StaySound/1.0 (macOS; lyrics@staysound.app)", forHTTPHeaderField: "User-Agent")
        request.cachePolicy = .reloadRevalidatingCacheData
        request.timeoutInterval = timeout
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            return try JSONDecoder().decode(Value.self, from: data)
        } catch {
            return nil
        }
    }

    nonisolated static func parseKpoe(_ payload: KpoePayload, fallbackDuration: Double) -> [LyricLine] {
        var raw: [(start: Double, end: Double, text: String, words: [LyricWord])] = []
        for line in payload.lyrics ?? [] {
            let syllables = (line.syllabus ?? []).filter { $0.isBackground != true }
            let text: String
            let start: Double
            let end: Double
            let words: [LyricWord]
            if !syllables.isEmpty {
                text = syllables.compactMap(\.text).joined().replacingOccurrences(of: "  ", with: " ")
                start = (syllables.compactMap(\.time).min() ?? line.time ?? 0) / 1000
                end = syllables.compactMap { syllable -> Double? in
                    guard let time = syllable.time else { return nil }
                    return (time + (syllable.duration ?? 0)) / 1000
                }.max() ?? start
                words = syllables.compactMap { syllable in
                    guard let rawText = syllable.text, !rawText.isEmpty, let time = syllable.time else { return nil }
                    let wordStart = time / 1000
                    let wordEnd = (time + max(1, syllable.duration ?? 1)) / 1000
                    return LyricWord(text: rawText, startTime: wordStart, endTime: wordEnd)
                }
            } else {
                text = line.text ?? ""
                start = (line.time ?? 0) / 1000
                end = ((line.time ?? 0) + (line.duration ?? 0)) / 1000
                words = []
            }
            let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !cleaned.isEmpty { raw.append((max(0, start), max(start, end), cleaned, words)) }
        }
        return finalize(raw, fallbackDuration: fallbackDuration)
    }

    nonisolated static func parseLRC(_ lrc: String, fallbackDuration: Double) -> [LyricLine] {
        let expression = try? NSRegularExpression(pattern: #"\[(\d{1,3}):(\d{2})(?:[\.:](\d{1,3}))?\]"#)
        var raw: [(start: Double, end: Double, text: String, words: [LyricWord])] = []

        for sourceLine in lrc.split(separator: "\n", omittingEmptySubsequences: false) {
            let string = String(sourceLine)
            let fullRange = NSRange(string.startIndex..., in: string)
            let matches = expression?.matches(in: string, range: fullRange) ?? []
            guard !matches.isEmpty else { continue }

            var textStart = string.startIndex
            if let last = matches.last, let range = Range(last.range, in: string) { textStart = range.upperBound }
            let text = String(string[textStart...]).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }

            for match in matches {
                guard let minuteRange = Range(match.range(at: 1), in: string),
                      let secondRange = Range(match.range(at: 2), in: string) else { continue }
                let minutes = Double(string[minuteRange]) ?? 0
                let seconds = Double(string[secondRange]) ?? 0
                var fraction = 0.0
                if match.range(at: 3).location != NSNotFound,
                   let fractionRange = Range(match.range(at: 3), in: string) {
                    let value = String(string[fractionRange])
                    fraction = (Double(value) ?? 0) / pow(10, Double(value.count))
                }
                raw.append((minutes * 60 + seconds + fraction, 0, text, []))
            }
        }
        return finalize(raw, fallbackDuration: fallbackDuration)
    }

    nonisolated static func finalize(
        _ input: [(start: Double, end: Double, text: String, words: [LyricWord])],
        fallbackDuration: Double
    ) -> [LyricLine] {
        let sorted = input.sorted { $0.start < $1.start }
        return sorted.enumerated().map { index, item in
            let nextStart = index + 1 < sorted.count ? sorted[index + 1].start : max(fallbackDuration, item.start + 5)
            let end = item.end > item.start ? min(item.end, max(nextStart, item.end)) : nextStart
            return LyricLine(
                id: index,
                timestamp: item.start,
                endTimestamp: end,
                text: item.text,
                words: item.words
            )
        }
    }

    nonisolated static func metadataVariants(_ track: Track) -> [(title: String, artist: String, album: String, useDuration: Bool)] {
        let cleaned = (cleanMetadata(track.title), cleanMetadata(track.artist), cleanMetadata(track.album))
        let raw = (track.title, track.artist, isUnknown(track.album) ? "" : track.album)
        return [
            (raw.0, raw.1, raw.2, true),
            (cleaned.0, cleaned.1, cleaned.2, true),
            (raw.0, raw.1, raw.2, false),
            (cleaned.0, cleaned.1, cleaned.2, false),
        ].filter { !$0.0.isEmpty && !$0.1.isEmpty && !isUnknown($0.1) }
    }

    nonisolated static func cleanMetadata(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"\s*[\(\[].*?[\)\]]"#, with: "", options: .regularExpression)
            .replacingOccurrences(
                of: #"\s*-\s*(Remastered|Original Mix|Single Version|Edit|Mix|Radio|Official|Lyric|Video).*$"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated static func isUnknown(_ value: String) -> Bool {
        let normalized = value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return normalized.contains("desconocido") || normalized.hasPrefix("unknown")
    }

    nonisolated static func score(_ result: LRCLIBResult, for track: Track) -> Double {
        let targetTitle = comparable(track.title)
        let targetArtist = comparable(track.artist)
        var value = 0.0
        if comparable(result.trackName ?? "") == targetTitle { value += 100 }
        else if comparable(result.trackName ?? "").contains(targetTitle) { value += 50 }
        if comparable(result.artistName ?? "") == targetArtist { value += 70 }
        else if comparable(result.artistName ?? "").contains(targetArtist) { value += 30 }
        if let duration = result.duration, track.duration > 0 {
            value += max(0, 30 - abs(duration - track.duration))
        }
        return value
    }

    nonisolated static func comparable(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated static func cacheKey(for track: Track) -> String {
        "v3-" + comparable("\(track.artist)|\(track.title)|\(Int(track.duration.rounded()))")
            .replacingOccurrences(of: " ", with: "-")
    }

    nonisolated static var cacheDirectory: URL? {
        guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let directory = base.appendingPathComponent("StaySoundNative/Lyrics", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    nonisolated static func cacheURL(key: String) -> URL? {
        let safe = key.isEmpty ? UUID().uuidString : String(key.prefix(180))
        return cacheDirectory?.appendingPathComponent(safe).appendingPathExtension("json")
    }

    nonisolated static func readCache(key: String) -> CachedLyrics? {
        guard let url = cacheURL(key: key),
              let data = try? Data(contentsOf: url),
              let cached = try? JSONDecoder().decode(CachedLyrics.self, from: data),
              Date().timeIntervalSince(cached.savedAt) < 60 * 60 * 24 * 30 else { return nil }
        return cached
    }

    nonisolated static func writeCache(_ cached: CachedLyrics, key: String) {
        guard let url = cacheURL(key: key), let data = try? JSONEncoder().encode(cached) else { return }
        try? data.write(to: url, options: .atomic)
    }

    nonisolated static func removeCache(key: String) {
        guard let url = cacheURL(key: key) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
