import Foundation

@MainActor
final class PlaylistStore: ObservableObject {
    @Published private(set) var playlists: [LocalPlaylist] = []

    init() {
        load()
    }

    @discardableResult
    func create(name: String) -> LocalPlaylist? {
        let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        let playlist = LocalPlaylist(name: cleaned)
        playlists.append(playlist)
        save()
        return playlist
    }

    func rename(_ playlistID: UUID, to name: String) {
        let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, let index = playlists.firstIndex(where: { $0.id == playlistID }) else { return }
        playlists[index].name = cleaned
        save()
    }

    func delete(_ playlistID: UUID) {
        playlists.removeAll { $0.id == playlistID }
        save()
    }

    func add(trackID: String, to playlistID: UUID) {
        guard let index = playlists.firstIndex(where: { $0.id == playlistID }),
              !playlists[index].trackIDs.contains(trackID) else { return }
        playlists[index].trackIDs.append(trackID)
        save()
    }

    func remove(trackID: String, from playlistID: UUID) {
        guard let index = playlists.firstIndex(where: { $0.id == playlistID }) else { return }
        playlists[index].trackIDs.removeAll { $0 == trackID }
        save()
    }

    func tracks(for playlist: LocalPlaylist, in library: [Track]) -> [Track] {
        let byID = Dictionary(uniqueKeysWithValues: library.map { ($0.id, $0) })
        return playlist.trackIDs.compactMap { byID[$0] }
    }

    private var storageURL: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let folder = base.appendingPathComponent("StaySoundNative", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("playlists.json")
    }

    private func load() {
        guard let url = storageURL,
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([LocalPlaylist].self, from: data) else { return }
        playlists = decoded
    }

    private func save() {
        guard let url = storageURL, let data = try? JSONEncoder().encode(playlists) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
