import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var player: AudioPlayer

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                if library.tracks.isEmpty {
                    EmptyLibraryView()
                } else {
                    HomeSpotlight(track: player.currentTrack ?? library.tracks[0])

                    SectionHeading(title: "Álbumes recientes", count: library.albums.count)
                    ScrollView(.horizontal) {
                        LazyHStack(spacing: 16) {
                            ForEach(Array(library.albums.prefix(10))) { album in
                                AlbumCard(album: album, width: 168)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .scrollIndicators(.hidden)

                    SectionHeading(title: "Vuelve a escuchar", count: library.tracks.count)
                    LazyVStack(spacing: 3) {
                        ForEach(Array(library.filteredTracks.prefix(14).enumerated()), id: \.element.id) { index, track in
                            TrackRow(track: track, index: index + 1, queue: library.filteredTracks)
                        }
                    }
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 132)
        }
        .scrollIndicators(.hidden)
    }
}

private struct EmptyLibraryView: View {
    @EnvironmentObject private var library: LibraryStore

    var body: some View {
        HStack(spacing: 42) {
            ZStack {
                Circle()
                    .fill(ArtworkPalette.fallback.primary.opacity(0.12))
                    .frame(width: 210, height: 210)
                Circle()
                    .stroke(ArtworkPalette.fallback.primary.opacity(0.24), lineWidth: 1)
                    .frame(width: 164, height: 164)
                Image(systemName: "waveform.path")
                    .font(.system(size: 72, weight: .thin))
                    .foregroundStyle(ArtworkPalette.fallback.primary)
            }
            VStack(alignment: .leading, spacing: 13) {
                CapsuleTag(text: "BIBLIOTECA VACÍA", tint: ArtworkPalette.fallback.primary)
                Text("Tu música merece\nun lugar propio.")
                    .font(StaySoundTheme.display(42, weight: .heavy))
                    .tracking(-1.2)
                Text("Selecciona la carpeta raíz. StaySound encontrará canciones en todas sus subcarpetas, conservará sus metadatos y nunca subirá nada a la nube.")
                    .font(.system(size: 14))
                    .foregroundStyle(StaySoundTheme.secondary)
                    .lineSpacing(4)
                    .frame(maxWidth: 500, alignment: .leading)
                Button {
                    library.chooseFolder()
                } label: {
                    Label("Seleccionar carpeta", systemImage: "folder.fill")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 18)
                        .frame(height: 44)
                        .background(ArtworkPalette.fallback.primary, in: Capsule())
                        .foregroundStyle(Color.black.opacity(0.82))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(38)
        .frame(maxWidth: .infinity, minHeight: 410, alignment: .leading)
        .staySoundCard(radius: 24)
    }
}

private struct HomeSpotlight: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var artwork: ArtworkStore
    let track: Track

    private var palette: ArtworkPalette { artwork.palette(for: track) }

    var body: some View {
        HStack(spacing: 28) {
            TrackArtwork(track: track, size: 196, cornerRadius: 20)
                .shadow(color: palette.primary.opacity(0.32), radius: 26, y: 12)

            VStack(alignment: .leading, spacing: 10) {
                CapsuleTag(text: "DESTACADO", tint: palette.primary)
                Text(track.title)
                    .font(StaySoundTheme.display(34, weight: .heavy))
                    .tracking(-0.8)
                    .lineLimit(2)
                Text("\(track.artist) · \(track.album)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(StaySoundTheme.secondary)
                    .lineLimit(1)
                Button {
                    player.play(track, in: library.tracks)
                } label: {
                    Label("Reproducir", systemImage: "play.fill")
                        .font(.system(size: 12.5, weight: .bold))
                        .padding(.horizontal, 17)
                        .frame(height: 42)
                        .background(palette.primary, in: Capsule())
                        .foregroundStyle(Color.black.opacity(0.82))
                }
                .buttonStyle(.plain)
            }
            Spacer()
            Image(systemName: "waveform")
                .font(.system(size: 96, weight: .ultraLight))
                .foregroundStyle(palette.primary.opacity(0.13))
                .padding(.trailing, 24)
        }
        .padding(24)
        .background {
            ZStack {
                LinearGradient(
                    colors: [palette.primary.opacity(0.13), palette.background.opacity(0.5), StaySoundTheme.card],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(.white.opacity(0.09), lineWidth: 1)
            }
        }
    }
}

private struct SectionHeading: View {
    let title: String
    let count: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            Text(title)
                .font(StaySoundTheme.display(21, weight: .bold))
            Text("\(count)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(StaySoundTheme.muted)
            Spacer()
        }
    }
}

struct SongsView: View {
    @EnvironmentObject private var library: LibraryStore

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 3, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(Array(library.filteredTracks.enumerated()), id: \.element.id) { index, track in
                        TrackRow(track: track, index: index + 1, queue: library.filteredTracks)
                    }
                } header: {
                    HStack(spacing: 12) {
                        Text("#").frame(width: 30)
                        Color.clear.frame(width: 46)
                        Text("TÍTULO")
                        Spacer()
                        Text("DURACIÓN").frame(width: 72, alignment: .trailing)
                    }
                    .font(.system(size: 9.5, weight: .bold))
                    .tracking(1.4)
                    .foregroundStyle(StaySoundTheme.muted)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .background(.ultraThinMaterial)
                    .overlay(alignment: .bottom) { Rectangle().fill(StaySoundTheme.line).frame(height: 1) }
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 132)
        }
        .scrollIndicators(.hidden)
        .overlay {
            if library.filteredTracks.isEmpty && !library.tracks.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 32, weight: .light))
                    Text("No encontramos esa canción")
                        .font(StaySoundTheme.display(20))
                }
                .foregroundStyle(StaySoundTheme.muted)
            }
        }
    }
}

struct TrackRow: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var artwork: ArtworkStore
    @EnvironmentObject private var playlists: PlaylistStore
    let track: Track
    let index: Int
    let queue: [Track]
    @State private var hovering = false

    private var isActive: Bool { player.currentTrack?.id == track.id }
    private var tint: Color { artwork.color(for: track) }

    var body: some View {
        Button {
            player.play(track, in: queue)
        } label: {
            HStack(spacing: 12) {
                Group {
                    if isActive {
                        Image(systemName: player.isPlaying ? "waveform" : "pause.fill")
                            .symbolEffect(.variableColor.iterative, isActive: player.isPlaying)
                            .foregroundStyle(tint)
                    } else if hovering {
                        Image(systemName: "play.fill").foregroundStyle(.white)
                    } else {
                        Text("\(index)")
                            .monospacedDigit()
                            .foregroundStyle(StaySoundTheme.muted)
                    }
                }
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 30)

                TrackArtwork(track: track, size: 46, cornerRadius: 8)

                VStack(alignment: .leading, spacing: 3) {
                    Text(track.title)
                        .font(.system(size: 13.5, weight: isActive ? .semibold : .medium))
                        .foregroundStyle(isActive ? tint : .white)
                        .lineLimit(1)
                    Text("\(track.artist) · \(track.album)")
                        .font(.system(size: 10.5))
                        .foregroundStyle(StaySoundTheme.muted)
                        .lineLimit(1)
                }
                Spacer()
                Text(track.duration.playbackTime)
                    .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(StaySoundTheme.muted)
                    .frame(width: 72, alignment: .trailing)
            }
            .padding(.horizontal, 12)
            .frame(height: 60)
            .background(
                isActive ? tint.opacity(0.1) : hovering ? StaySoundTheme.cardHover : .clear,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay(alignment: .leading) {
                if isActive { Capsule().fill(tint).frame(width: 2.5, height: 26) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu {
            Button("Reproducir ahora", systemImage: "play.fill") {
                player.play(track, in: queue)
            }
            if !playlists.playlists.isEmpty {
                Menu("Agregar a playlist", systemImage: "text.badge.plus") {
                    ForEach(playlists.playlists) { playlist in
                        Button(playlist.name) {
                            playlists.add(trackID: track.id, to: playlist.id)
                        }
                    }
                }
            }
            Button("Mostrar en Finder", systemImage: "folder") {
                NSWorkspace.shared.activateFileViewerSelecting([track.fileURL])
            }
        }
    }
}

struct PlaylistsView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var playlists: PlaylistStore
    @State private var selectedID: UUID?
    @State private var newName = ""

    private var selected: LocalPlaylist? {
        playlists.playlists.first(where: { $0.id == selectedID }) ?? playlists.playlists.first
    }

    var body: some View {
        HStack(spacing: 18) {
            playlistRail
                .frame(width: 260)

            if let playlist = selected {
                playlistDetail(playlist)
            } else {
                emptyPlaylists
            }
        }
        .padding(.horizontal, 30)
        .padding(.bottom, 132)
        .onAppear {
            if selectedID == nil { selectedID = playlists.playlists.first?.id }
        }
        .onChange(of: playlists.playlists) { _, value in
            if let selectedID, !value.contains(where: { $0.id == selectedID }) {
                self.selectedID = value.first?.id
            }
        }
    }

    private var playlistRail: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 8) {
                TextField("Nueva playlist", text: $newName)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .onSubmit(createPlaylist)
                Button(action: createPlaylist) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold))
                        .frame(width: 30, height: 30)
                        .background(ArtworkPalette.fallback.primary, in: Circle())
                        .foregroundStyle(Color.black.opacity(0.8))
                }
                .buttonStyle(.plain)
                .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(10)
            .background(Color.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(StaySoundTheme.line, lineWidth: 1) }

            ScrollView {
                LazyVStack(spacing: 5) {
                    ForEach(playlists.playlists) { playlist in
                        Button {
                            selectedID = playlist.id
                        } label: {
                            HStack(spacing: 11) {
                                Image(systemName: "music.note.house.fill")
                                    .font(.system(size: 13))
                                    .frame(width: 36, height: 36)
                                    .background(ArtworkPalette.fallback.secondary.opacity(0.13), in: RoundedRectangle(cornerRadius: 10))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(playlist.name)
                                        .font(.system(size: 12.5, weight: .semibold))
                                        .lineLimit(1)
                                    Text("\(playlist.trackIDs.count) canciones")
                                        .font(.system(size: 9.5))
                                        .foregroundStyle(StaySoundTheme.muted)
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 9)
                            .frame(height: 54)
                            .background(
                                selected?.id == playlist.id ? ArtworkPalette.fallback.primary.opacity(0.11) : .clear,
                                in: RoundedRectangle(cornerRadius: 12)
                            )
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Eliminar", systemImage: "trash", role: .destructive) {
                                playlists.delete(playlist.id)
                            }
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(14)
        .staySoundCard(radius: 18)
    }

    private func playlistDetail(_ playlist: LocalPlaylist) -> some View {
        let tracks = playlists.tracks(for: playlist, in: library.tracks)
        return VStack(alignment: .leading, spacing: 17) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 7) {
                    CapsuleTag(text: "PLAYLIST LOCAL", tint: ArtworkPalette.fallback.primary)
                    Text(playlist.name)
                        .font(StaySoundTheme.display(31, weight: .heavy))
                    Text("\(tracks.count) canciones · guardada en esta Mac")
                        .font(.system(size: 11))
                        .foregroundStyle(StaySoundTheme.muted)
                }
                Spacer()
                Menu {
                    ForEach(library.tracks.filter { !playlist.trackIDs.contains($0.id) }) { track in
                        Button("\(track.title) — \(track.artist)") {
                            playlists.add(trackID: track.id, to: playlist.id)
                        }
                    }
                } label: {
                    Label("Agregar canciones", systemImage: "plus")
                        .font(.system(size: 11.5, weight: .bold))
                        .padding(.horizontal, 14)
                        .frame(height: 38)
                        .background(StaySoundTheme.card, in: Capsule())
                        .overlay { Capsule().stroke(StaySoundTheme.line, lineWidth: 1) }
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                Button {
                    if let first = tracks.first { player.play(first, in: tracks) }
                } label: {
                    Image(systemName: "play.fill")
                        .frame(width: 42, height: 42)
                        .background(ArtworkPalette.fallback.primary, in: Circle())
                        .foregroundStyle(Color.black.opacity(0.82))
                }
                .buttonStyle(.plain)
                .disabled(tracks.isEmpty)
            }

            Rectangle().fill(StaySoundTheme.line).frame(height: 1)

            if tracks.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 32, weight: .light))
                    Text("Agrega canciones desde aquí o con clic derecho en la biblioteca.")
                        .font(.system(size: 12))
                }
                .foregroundStyle(StaySoundTheme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 3) {
                        ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                            HStack(spacing: 0) {
                                TrackRow(track: track, index: index + 1, queue: tracks)
                                Button {
                                    playlists.remove(trackID: track.id, from: playlist.id)
                                } label: {
                                    Image(systemName: "minus.circle")
                                        .foregroundStyle(StaySoundTheme.muted)
                                        .frame(width: 34, height: 60)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .padding(22)
        .staySoundCard(radius: 20)
    }

    private var emptyPlaylists: some View {
        VStack(spacing: 14) {
            Image(systemName: "music.note.house")
                .font(.system(size: 42, weight: .light))
                .foregroundStyle(ArtworkPalette.fallback.primary)
            Text("Crea tu primera playlist")
                .font(StaySoundTheme.display(23, weight: .bold))
            Text("Vive en esta Mac y usa las canciones de tu biblioteca local.")
                .font(.system(size: 12))
                .foregroundStyle(StaySoundTheme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .staySoundCard(radius: 20)
    }

    private func createPlaylist() {
        if let playlist = playlists.create(name: newName) {
            selectedID = playlist.id
            newName = ""
        }
    }
}

struct AlbumsView: View {
    @EnvironmentObject private var library: LibraryStore
    private let columns = [GridItem(.adaptive(minimum: 164, maximum: 190), spacing: 18)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 24) {
                ForEach(library.albums) { album in
                    NavigationLink(value: album) {
                        AlbumCard(album: album, width: 166)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 132)
        }
        .scrollIndicators(.hidden)
        .navigationDestination(for: AlbumGroup.self) { AlbumDetailView(album: $0) }
    }
}

struct AlbumCard: View {
    @EnvironmentObject private var artwork: ArtworkStore
    let album: AlbumGroup
    let width: CGFloat
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ZStack(alignment: .bottomTrailing) {
                if let track = album.artworkTrack {
                    TrackArtwork(track: track, size: width, cornerRadius: 15)
                        .shadow(color: artwork.color(for: track).opacity(hovering ? 0.28 : 0.08), radius: 18, y: 9)
                }
                if hovering {
                    Image(systemName: "play.fill")
                        .font(.system(size: 13, weight: .bold))
                        .frame(width: 38, height: 38)
                        .background(artwork.color(for: album.artworkTrack), in: Circle())
                        .foregroundStyle(Color.black.opacity(0.78))
                        .padding(10)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            Text(album.name)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            Text(album.artist)
                .font(.system(size: 10.5))
                .foregroundStyle(StaySoundTheme.muted)
                .lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
        .scaleEffect(hovering ? 1.018 : 1)
        .animation(.snappy(duration: 0.22), value: hovering)
        .onHover { hovering = $0 }
    }
}

private struct AlbumDetailView: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var artwork: ArtworkStore
    @Environment(\.dismiss) private var dismiss
    let album: AlbumGroup

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Button { dismiss() } label: {
                    Label("Álbumes", systemImage: "chevron.left")
                        .font(.system(size: 12, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(StaySoundTheme.secondary)

                HStack(alignment: .bottom, spacing: 24) {
                    if let track = album.artworkTrack {
                        TrackArtwork(track: track, size: 210, cornerRadius: 20)
                            .shadow(color: artwork.color(for: track).opacity(0.26), radius: 28, y: 14)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        CapsuleTag(text: "ÁLBUM", tint: artwork.color(for: album.artworkTrack))
                        Text(album.name)
                            .font(StaySoundTheme.display(38, weight: .heavy))
                        Text(album.artist)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(StaySoundTheme.secondary)
                        Text("\(album.tracks.count) canciones")
                            .font(.system(size: 11))
                            .foregroundStyle(StaySoundTheme.muted)
                        Button {
                            if let first = album.tracks.first { player.play(first, in: album.tracks) }
                        } label: {
                            Label("Reproducir", systemImage: "play.fill")
                                .font(.system(size: 12.5, weight: .bold))
                                .padding(.horizontal, 16)
                                .frame(height: 40)
                                .background(artwork.color(for: album.artworkTrack), in: Capsule())
                                .foregroundStyle(Color.black.opacity(0.82))
                        }
                        .buttonStyle(.plain)
                    }
                }

                LazyVStack(spacing: 3) {
                    ForEach(Array(album.tracks.enumerated()), id: \.element.id) { index, track in
                        TrackRow(track: track, index: index + 1, queue: album.tracks)
                    }
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 132)
        }
        .scrollIndicators(.hidden)
    }
}

struct ArtistsView: View {
    @EnvironmentObject private var library: LibraryStore

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 5) {
                ForEach(library.artists) { artist in
                    NavigationLink(value: artist) {
                        HStack(spacing: 14) {
                            ZStack {
                                Circle().fill(ArtworkPalette.fallback.secondary.opacity(0.14))
                                Image(systemName: "person.fill")
                                    .font(.system(size: 20))
                                    .foregroundStyle(ArtworkPalette.fallback.secondary)
                            }
                            .frame(width: 48, height: 48)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(artist.name).font(.system(size: 14, weight: .semibold))
                                Text("\(artist.tracks.count) canciones")
                                    .font(.system(size: 10.5))
                                    .foregroundStyle(StaySoundTheme.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(StaySoundTheme.muted)
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 64)
                        .staySoundCard(radius: 13)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 132)
        }
        .scrollIndicators(.hidden)
        .navigationDestination(for: ArtistGroup.self) { artist in
            ScrollView {
                LazyVStack(spacing: 3) {
                    ForEach(Array(artist.tracks.enumerated()), id: \.element.id) { index, track in
                        TrackRow(track: track, index: index + 1, queue: artist.tracks)
                    }
                }
                .padding(30)
                .padding(.bottom, 110)
            }
            .scrollIndicators(.hidden)
        }
    }
}
