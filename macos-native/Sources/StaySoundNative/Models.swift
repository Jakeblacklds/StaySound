import Foundation

struct Track: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let fileURL: URL
    var title: String
    var artist: String
    var album: String
    var duration: Double
    var trackNumber: Int?

    init(
        fileURL: URL,
        title: String,
        artist: String,
        album: String,
        duration: Double,
        trackNumber: Int? = nil
    ) {
        self.id = fileURL.standardizedFileURL.path
        self.fileURL = fileURL
        self.title = title
        self.artist = artist
        self.album = album
        self.duration = duration
        self.trackNumber = trackNumber
    }
}

struct AlbumGroup: Identifiable, Hashable {
    let name: String
    let artist: String
    let tracks: [Track]

    var id: String { "\(artist)\u{0}\(name)" }
    var artworkTrack: Track? { tracks.first }
}

struct ArtistGroup: Identifiable, Hashable {
    let name: String
    let tracks: [Track]

    var id: String { name }
}

struct LocalPlaylist: Identifiable, Codable, Hashable, Sendable {
    let id: UUID
    var name: String
    var trackIDs: [String]
    let createdAt: Date

    init(id: UUID = UUID(), name: String, trackIDs: [String] = [], createdAt: Date = Date()) {
        self.id = id
        self.name = name
        self.trackIDs = trackIDs
        self.createdAt = createdAt
    }
}

struct LyricWord: Codable, Hashable, Sendable {
    let text: String
    let startTime: Double
    let endTime: Double
}

struct LyricLine: Identifiable, Codable, Hashable, Sendable {
    let id: Int
    let timestamp: Double
    let endTimestamp: Double
    let text: String
    let words: [LyricWord]

    init(id: Int, timestamp: Double, endTimestamp: Double = 0, text: String, words: [LyricWord] = []) {
        self.id = id
        self.timestamp = timestamp
        self.endTimestamp = endTimestamp
        self.text = text
        self.words = words
    }

    private enum CodingKeys: String, CodingKey {
        case id, timestamp, endTimestamp, text, words
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        timestamp = try container.decode(Double.self, forKey: .timestamp)
        endTimestamp = try container.decodeIfPresent(Double.self, forKey: .endTimestamp) ?? 0
        text = try container.decode(String.self, forKey: .text)
        words = try container.decodeIfPresent([LyricWord].self, forKey: .words) ?? []
    }
}

struct SoulseekCredentials: Codable, Sendable {
    var username = ""
    var password = ""
}

struct SoulseekMatch: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let username: String
    let filename: String
    let size: Int?
    let extensionName: String?
    let bitRate: Int?
    let speed: Int?
    let slots: Bool?

    enum CodingKeys: String, CodingKey {
        case id, username, filename, size, bitRate, speed, slots
        case extensionName = "extension"
    }
}

enum SidebarDestination: String, CaseIterable, Identifiable {
    case home
    case songs
    case albums
    case artists
    case playlists
    case downloads

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Inicio"
        case .songs: "Canciones"
        case .albums: "Álbumes"
        case .artists: "Artistas"
        case .playlists: "Playlists"
        case .downloads: "Descargas"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house.fill"
        case .songs: "music.note.list"
        case .albums: "square.stack.fill"
        case .artists: "person.2.fill"
        case .playlists: "music.note.house.fill"
        case .downloads: "arrow.down.circle.fill"
        }
    }
}

extension Double {
    var playbackTime: String {
        guard isFinite, self >= 0 else { return "0:00" }
        let total = Int(self.rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
