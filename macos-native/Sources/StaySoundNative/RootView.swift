import SwiftUI

struct RootView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var artwork: ArtworkStore
    @EnvironmentObject private var soulseek: SoulseekService
    @EnvironmentObject private var lyrics: LyricsService
    @State private var destination: SidebarDestination = .home
    @State private var showingPlayer = false
    @State private var showingQueue = false
    @State private var searchOpen = false
    @State private var showingSettings = false

    private var palette: ArtworkPalette { artwork.palette(for: player.currentTrack) }

    var body: some View {
        ZStack {
            AmbientBackground(palette: palette)

            HStack(spacing: 0) {
                StaySoundSidebar(selection: $destination)
                    .frame(width: 238)

                VStack(spacing: 0) {
                    EditorialToolbar(
                        destination: destination,
                        searchOpen: $searchOpen,
                        searchText: $library.searchText,
                        showingSettings: $showingSettings
                    )
                    content
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }

            if player.currentTrack != nil && !showingPlayer {
                VStack {
                    Spacer()
                    NativePlayerBar(showingFullPlayer: $showingPlayer, showingQueue: $showingQueue)
                        .padding(.horizontal, 14)
                        .padding(.bottom, 14)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if showingPlayer {
                FullPlayerView(isPresented: $showingPlayer, showingQueue: $showingQueue)
                    .transition(.opacity.combined(with: .scale(scale: 1.015)))
                    .zIndex(10)
            }

            if showingQueue {
                QueueDrawerView(isPresented: $showingQueue)
                    .zIndex(20)
                    .transition(.opacity)
            }

            if showingSettings {
                LibrarySettingsView(isPresented: $showingSettings)
                    .zIndex(30)
                    .transition(.opacity)
            }
        }
        .preferredColorScheme(.dark)
        .animation(.smooth(duration: 0.36), value: showingPlayer)
        .animation(.snappy(duration: 0.3), value: showingQueue)
        .onChange(of: soulseek.lastDownloadedURL) { _, url in
            if let url { library.importDownloadedFile(url) }
        }
        .onChange(of: player.currentTrack) { _, track in
            lyrics.load(for: track)
        }
        .onExitCommand {
            if showingQueue {
                showingQueue = false
            } else if showingSettings {
                showingSettings = false
            } else if showingPlayer {
                showingPlayer = false
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        NavigationStack {
            Group {
                switch destination {
                case .home: HomeView()
                case .songs: SongsView()
                case .albums: AlbumsView()
                case .artists: ArtistsView()
                case .playlists: PlaylistsView()
                case .downloads: DownloadsView()
                }
            }
            .toolbar(.hidden)
        }
        .id(destination)
    }
}

private struct StaySoundSidebar: View {
    @Binding var selection: SidebarDestination

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [ArtworkPalette.fallback.primary, ArtworkPalette.fallback.secondary],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    Text("S")
                        .font(StaySoundTheme.display(19, weight: .black))
                        .foregroundStyle(Color.black.opacity(0.78))
                }
                .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("StaySound")
                        .font(StaySoundTheme.display(17))
                    Text("Tu música, sin nube")
                        .font(.system(size: 10.5))
                        .foregroundStyle(StaySoundTheme.muted)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 22)
            .padding(.bottom, 32)

            Text("BIBLIOTECA")
                .font(.system(size: 9.5, weight: .bold))
                .tracking(2)
                .foregroundStyle(StaySoundTheme.muted)
                .padding(.horizontal, 22)
                .padding(.bottom, 10)

            VStack(spacing: 4) {
                ForEach(SidebarDestination.allCases) { item in
                    Button {
                        selection = item
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.systemImage)
                                .font(.system(size: 15, weight: .semibold))
                                .frame(width: 22)
                            Text(item.title)
                                .font(.system(size: 13.5, weight: selection == item ? .semibold : .medium))
                            Spacer()
                        }
                        .foregroundStyle(selection == item ? Color.white : StaySoundTheme.secondary)
                        .padding(.horizontal, 14)
                        .frame(height: 42)
                        .background(
                            selection == item ? ArtworkPalette.fallback.primary.opacity(0.13) : .clear,
                            in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                        )
                        .overlay(alignment: .leading) {
                            if selection == item {
                                Capsule()
                                    .fill(ArtworkPalette.fallback.primary)
                                    .frame(width: 2.5, height: 20)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)

            Spacer()

            VStack(alignment: .leading, spacing: 7) {
                Image(systemName: "internaldrive.fill")
                    .foregroundStyle(ArtworkPalette.fallback.primary)
                Text("Biblioteca local")
                    .font(.system(size: 11.5, weight: .semibold))
                Text("Sin nube · Sin anuncios")
                    .font(.system(size: 9.5))
                    .foregroundStyle(StaySoundTheme.muted)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .staySoundCard(radius: 14)
            .padding(14)
            .padding(.bottom, 108)
        }
        .background(.ultraThinMaterial)
        .overlay(alignment: .trailing) {
            Rectangle().fill(StaySoundTheme.line).frame(width: 1)
        }
    }
}

private struct EditorialToolbar: View {
    @EnvironmentObject private var library: LibraryStore
    let destination: SidebarDestination
    @Binding var searchOpen: Bool
    @Binding var searchText: String
    @Binding var showingSettings: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 18) {
            VStack(alignment: .leading, spacing: 7) {
                Text(destination == .downloads ? "ENCUENTRA MÚSICA" : "TU MÚSICA LOCAL")
                    .font(.system(size: 9.5, weight: .bold))
                    .tracking(2.4)
                    .foregroundStyle(StaySoundTheme.muted)
                HStack(alignment: .lastTextBaseline, spacing: 1) {
                    Text(destination.title.lowercased())
                        .font(StaySoundTheme.display(46, weight: .heavy))
                    Text(".")
                        .font(StaySoundTheme.display(46, weight: .heavy))
                        .foregroundStyle(ArtworkPalette.fallback.primary)
                }
            }

            Spacer()

            HStack(spacing: 7) {
                if library.isImporting {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small)
                        Text("Escaneando…")
                            .font(.system(size: 10.5, weight: .semibold))
                    }
                    .foregroundStyle(StaySoundTheme.secondary)
                    .padding(.horizontal, 10)
                }
                if searchOpen && destination != .downloads {
                    TextField("Buscar en biblioteca", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12.5))
                        .padding(.horizontal, 14)
                        .frame(width: 220, height: 38)
                        .background(StaySoundTheme.card, in: Capsule())
                        .overlay { Capsule().stroke(StaySoundTheme.line, lineWidth: 1) }
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
                if destination != .downloads {
                    RoundIconButton(systemName: searchOpen ? "xmark" : "magnifyingglass", size: 38) {
                        withAnimation(.snappy) {
                            searchOpen.toggle()
                            if !searchOpen { searchText = "" }
                        }
                    }
                }
                RoundIconButton(systemName: "arrow.clockwise", size: 38) {
                    library.rescanRememberedFolder()
                }
                RoundIconButton(systemName: "slider.horizontal.3", size: 38) {
                    showingSettings = true
                }
                Button {
                    library.chooseFolder()
                } label: {
                    Label("Importar", systemImage: "folder.badge.plus")
                        .font(.system(size: 12, weight: .bold))
                        .padding(.horizontal, 14)
                        .frame(height: 38)
                        .background(ArtworkPalette.fallback.primary, in: Capsule())
                        .foregroundStyle(Color.black.opacity(0.82))
                }
                .buttonStyle(.plain)
                .disabled(library.isImporting)
            }
            .padding(5)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay { Capsule().stroke(StaySoundTheme.line, lineWidth: 1) }
        }
        .padding(.horizontal, 30)
        .padding(.top, 24)
        .padding(.bottom, 20)
    }
}

private struct LibrarySettingsView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var artwork: ArtworkStore
    @Binding var isPresented: Bool
    @State private var confirmingClear = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.56)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { isPresented = false }

            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("AJUSTES")
                            .font(.system(size: 9.5, weight: .bold))
                            .tracking(2.2)
                            .foregroundStyle(StaySoundTheme.muted)
                        Text("Biblioteca local")
                            .font(StaySoundTheme.display(26, weight: .heavy))
                    }
                    Spacer()
                    RoundIconButton(systemName: "xmark", size: 38) { isPresented = false }
                }

                VStack(alignment: .leading, spacing: 7) {
                    Text("CARPETA ACTUAL")
                        .font(.system(size: 9, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(StaySoundTheme.muted)
                    HStack(spacing: 10) {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(ArtworkPalette.fallback.primary)
                        Text(library.currentFolderPath ?? "Ninguna carpeta seleccionada")
                            .font(.system(size: 11.5, weight: .medium))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                    }
                    .padding(13)
                    .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 12))
                }

                settingAction(
                    title: "Sincronizar ahora",
                    subtitle: "Busca archivos nuevos o eliminados en todas las subcarpetas.",
                    icon: "arrow.triangle.2.circlepath",
                    tint: ArtworkPalette.fallback.primary
                ) { library.rescanRememberedFolder() }

                settingAction(
                    title: "Elegir otra carpeta",
                    subtitle: "Reemplaza el catálogo actual usando una nueva carpeta raíz.",
                    icon: "folder.badge.plus",
                    tint: ArtworkPalette.fallback.secondary
                ) { library.chooseFolder() }

                settingAction(
                    title: "Recuperar carátulas",
                    subtitle: "Revisa carátulas embebidas, cover.jpg y sidecars de las canciones.",
                    icon: "photo.stack",
                    tint: ArtworkPalette.fallback.accent
                ) { artwork.recoverArtwork(for: library.tracks) }

                settingAction(
                    title: "Vaciar biblioteca",
                    subtitle: "Elimina el catálogo de StaySound; no borra ningún archivo de música.",
                    icon: "trash",
                    tint: .red
                ) { confirmingClear = true }
            }
            .padding(24)
            .frame(width: 560)
            .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 24).stroke(StaySoundTheme.line, lineWidth: 1) }
            .shadow(color: .black.opacity(0.55), radius: 40, y: 18)
            .alert("¿Vaciar la biblioteca?", isPresented: $confirmingClear) {
                Button("Cancelar", role: .cancel) {}
                Button("Vaciar", role: .destructive) {
                    library.clearLibrary()
                    isPresented = false
                }
            } message: {
                Text("Tus archivos permanecerán intactos en el disco.")
            }
        }
    }

    private func settingAction(
        title: String,
        subtitle: String,
        icon: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 40, height: 40)
                    .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 12.5, weight: .bold))
                    Text(subtitle)
                        .font(.system(size: 10.5))
                        .foregroundStyle(StaySoundTheme.muted)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(StaySoundTheme.muted)
            }
            .padding(11)
            .background(StaySoundTheme.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).stroke(StaySoundTheme.line, lineWidth: 1) }
        }
        .buttonStyle(.plain)
    }
}
