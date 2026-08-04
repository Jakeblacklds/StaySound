import SwiftUI

@main
struct StaySoundNativeApp: App {
    @StateObject private var library = LibraryStore()
    @StateObject private var player = AudioPlayer()
    @StateObject private var artwork = ArtworkStore()
    @StateObject private var lyrics = LyricsService()
    @StateObject private var soulseek = SoulseekService()
    @StateObject private var playlists = PlaylistStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(player)
                .environmentObject(player.clock)
                .environment(\.playbackClockReference, player.clock)
                .environmentObject(artwork)
                .environmentObject(lyrics)
                .environmentObject(soulseek)
                .environmentObject(playlists)
                .frame(minWidth: 980, minHeight: 680)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Importar carpeta…") { library.chooseFolder() }
                    .keyboardShortcut("o", modifiers: [.command, .shift])
                Button("Sincronizar biblioteca") { library.rescanRememberedFolder() }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
            }
            CommandGroup(after: .textEditing) {
                Divider()
                Button(player.isPlaying ? "Pausar" : "Reproducir") { player.toggle() }
                    .keyboardShortcut(.space, modifiers: [])
            }
        }
    }
}
