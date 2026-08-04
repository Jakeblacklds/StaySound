import Combine
import SwiftUI

struct NativePlayerBar: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var clock: PlaybackClock
    @EnvironmentObject private var artwork: ArtworkStore
    @Binding var showingFullPlayer: Bool
    @Binding var showingQueue: Bool

    var body: some View {
        if let track = player.currentTrack {
            let palette = artwork.palette(for: track)
            HStack(spacing: 18) {
                Button { showingFullPlayer = true } label: {
                    HStack(spacing: 12) {
                        TrackArtwork(track: track, size: 62, cornerRadius: 12)
                            .shadow(color: palette.primary.opacity(0.22), radius: 10, y: 5)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(track.title)
                                .font(.system(size: 13.5, weight: .semibold))
                                .lineLimit(1)
                            Text("\(track.artist) · \(track.album)")
                                .font(.system(size: 10.5))
                                .foregroundStyle(StaySoundTheme.muted)
                                .lineLimit(1)
                        }
                    }
                    .frame(width: 300, alignment: .leading)
                }
                .buttonStyle(.plain)

                Spacer(minLength: 10)

                VStack(spacing: 7) {
                    HStack(spacing: 17) {
                        transportButton("shuffle", active: player.shuffleEnabled, tint: palette.primary) {
                            player.toggleShuffle()
                        }
                        transportButton("backward.fill", tint: palette.primary, action: player.previous)
                        Button(action: player.toggle) {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 16, weight: .black))
                                .frame(width: 44, height: 44)
                                .background(.white, in: Circle())
                                .foregroundStyle(Color(red: 0.04, green: 0.06, blue: 0.09))
                                .shadow(color: palette.primary.opacity(0.26), radius: 12)
                        }
                        .buttonStyle(.plain)
                        transportButton("forward.fill", tint: palette.primary, action: player.next)
                        transportButton(
                            player.repeatMode == .one ? "repeat.1" : "repeat",
                            active: player.repeatMode != .off,
                            tint: palette.primary,
                            action: player.cycleRepeat
                        )
                    }
                    HStack(spacing: 8) {
                        Text(clock.position.playbackTime)
                        Slider(
                            value: Binding(get: { clock.position }, set: { player.seek(to: $0) }),
                            in: 0...max(clock.duration, 1)
                        )
                        .tint(palette.primary)
                        Text(clock.duration.playbackTime)
                    }
                    .font(.system(size: 9.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(StaySoundTheme.muted)
                    .frame(maxWidth: 470)
                }

                Spacer(minLength: 10)

                HStack(spacing: 9) {
                    Image(systemName: player.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(StaySoundTheme.secondary)
                    Slider(value: $player.volume, in: 0...1)
                        .tint(palette.primary)
                        .frame(width: 100)
                    RoundIconButton(systemName: "list.bullet", size: 34) { showingQueue = true }
                }
                .frame(width: 190, alignment: .trailing)
            }
            .padding(.horizontal, 18)
            .frame(height: 92)
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(.ultraThinMaterial)
                    LinearGradient(
                        colors: [palette.primary.opacity(0.1), .clear, palette.secondary.opacity(0.07)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(.white.opacity(0.13), lineWidth: 1)
                }
            }
            .shadow(color: .black.opacity(0.46), radius: 28, y: 15)
        }
    }

    private func transportButton(
        _ systemName: String,
        active: Bool = false,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(active ? tint : StaySoundTheme.secondary)
                .frame(width: 25, height: 25)
        }
        .buttonStyle(.plain)
    }
}

struct FullPlayerView: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var artwork: ArtworkStore
    @EnvironmentObject private var lyrics: LyricsService
    @Binding var isPresented: Bool
    @Binding var showingQueue: Bool

    var body: some View {
        if let track = player.currentTrack {
            let palette = artwork.palette(for: track)
            ZStack {
                FullPlayerBackground(track: track, palette: palette)

                VStack(spacing: 0) {
                    FullPlayerHeader(
                        track: track,
                        isPresented: $isPresented,
                        showingQueue: $showingQueue,
                        palette: palette
                    )
                    GeometryReader { geometry in
                        HStack(spacing: max(42, geometry.size.width * 0.055)) {
                            FullPlayerTrackColumn(track: track, palette: palette)
                                .frame(width: min(470, geometry.size.width * 0.43))
                            SyncedLyricsNativeView(track: track, palette: palette)
                                .frame(maxWidth: 600, maxHeight: .infinity)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.horizontal, max(54, geometry.size.width * 0.075))
                        .padding(.bottom, 34)
                    }
                }
            }
            .task(id: track.id) {
                artwork.load(track)
                lyrics.load(for: track)
            }
        }
    }
}

private struct FullPlayerBackground: View {
    @EnvironmentObject private var artwork: ArtworkStore
    let track: Track
    let palette: ArtworkPalette

    var body: some View {
        ZStack {
            palette.background
            if let image = artwork.image(for: track) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .blur(radius: 76)
                    .scaleEffect(1.24)
                    .opacity(0.24)
                    .saturation(1.35)
            }
            RadialGradient(
                colors: [palette.primary.opacity(0.34), .clear],
                center: UnitPoint(x: 0.12, y: 0.08),
                startRadius: 10,
                endRadius: 720
            )
            RadialGradient(
                colors: [palette.secondary.opacity(0.22), .clear],
                center: UnitPoint(x: 0.84, y: 0.88),
                startRadius: 10,
                endRadius: 620
            )
            LinearGradient(
                colors: [Color.black.opacity(0.06), StaySoundTheme.root.opacity(0.42), Color.black.opacity(0.64)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
    }
}

private struct FullPlayerHeader: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var lyrics: LyricsService
    let track: Track
    @Binding var isPresented: Bool
    @Binding var showingQueue: Bool
    let palette: ArtworkPalette

    var body: some View {
        HStack {
            Button { isPresented = false } label: {
                Label("Cerrar", systemImage: "chevron.down")
                    .font(.system(size: 11.5, weight: .bold))
                    .padding(.horizontal, 14)
                    .frame(height: 42)
                    .background(.thinMaterial, in: Capsule())
                    .overlay { Capsule().stroke(.white.opacity(0.11), lineWidth: 1) }
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.escape, modifiers: [])
            Spacer()
            Text("REPRODUCIENDO")
                .font(.system(size: 10, weight: .bold))
                .tracking(2.1)
                .foregroundStyle(StaySoundTheme.secondary)
            Spacer()
            HStack(spacing: 9) {
                Menu {
                    Text(lyrics.source.isEmpty ? "Buscando proveedor…" : "Fuente: \(lyrics.source)")
                    Divider()
                    Button("Recargar letra", systemImage: "arrow.clockwise") {
                        lyrics.reload(for: track)
                    }
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 42, height: 42)
                        .background(.thinMaterial, in: Circle())
                        .overlay { Circle().stroke(.white.opacity(0.1), lineWidth: 1) }
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                RoundIconButton(systemName: "list.bullet", size: 42) { showingQueue = true }
            }
        }
        .padding(.horizontal, 28)
        .padding(.top, 42)
        .frame(height: 106)
        .zIndex(50)
    }
}

struct QueueDrawerView: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var artwork: ArtworkStore
    @Binding var isPresented: Bool

    var body: some View {
        ZStack(alignment: .trailing) {
            Color.black.opacity(0.48)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { isPresented = false }

            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("COLA ACTUAL")
                            .font(.system(size: 9.5, weight: .bold))
                            .tracking(2)
                            .foregroundStyle(StaySoundTheme.muted)
                        Text("A continuación")
                            .font(StaySoundTheme.display(25, weight: .heavy))
                    }
                    Spacer()
                    RoundIconButton(systemName: "xmark", size: 38) { isPresented = false }
                }
                .padding(22)

                Rectangle().fill(StaySoundTheme.line).frame(height: 1)

                if player.queue.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "text.line.first.and.arrowtriangle.forward")
                            .font(.system(size: 30, weight: .light))
                        Text("La cola está vacía")
                            .font(StaySoundTheme.display(17))
                    }
                    .foregroundStyle(StaySoundTheme.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 5) {
                            ForEach(Array(player.queue.enumerated()), id: \.element.id) { index, track in
                                Button {
                                    player.playAtIndex(index)
                                } label: {
                                    HStack(spacing: 11) {
                                        TrackArtwork(track: track, size: 46, cornerRadius: 9)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(track.title)
                                                .font(.system(size: 12.5, weight: index == player.queueIndex ? .bold : .medium))
                                                .foregroundStyle(index == player.queueIndex ? artwork.color(for: track) : .white)
                                                .lineLimit(1)
                                            Text(track.artist)
                                                .font(.system(size: 10.5))
                                                .foregroundStyle(StaySoundTheme.muted)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        if index == player.queueIndex {
                                            Image(systemName: player.isPlaying ? "waveform" : "pause.fill")
                                                .symbolEffect(.variableColor.iterative, isActive: player.isPlaying)
                                                .foregroundStyle(artwork.color(for: track))
                                        } else {
                                            Text(track.duration.playbackTime)
                                                .font(.system(size: 9.5).monospacedDigit())
                                                .foregroundStyle(StaySoundTheme.muted)
                                        }
                                    }
                                    .padding(.horizontal, 10)
                                    .frame(height: 62)
                                    .background(
                                        index == player.queueIndex ? artwork.color(for: track).opacity(0.1) : .clear,
                                        in: RoundedRectangle(cornerRadius: 12)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(12)
                    }
                    .scrollIndicators(.hidden)
                }
            }
            .frame(width: 390)
            .frame(maxHeight: .infinity)
            .background(.ultraThickMaterial)
            .overlay(alignment: .leading) { Rectangle().fill(StaySoundTheme.line).frame(width: 1) }
            .shadow(color: .black.opacity(0.5), radius: 34, x: -15)
            .transition(.move(edge: .trailing))
        }
    }
}

private struct FullPlayerTrackColumn: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var clock: PlaybackClock
    let track: Track
    let palette: ArtworkPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            Spacer(minLength: 0)
            TrackArtwork(track: track, size: 312, cornerRadius: 24)
                .shadow(color: palette.primary.opacity(0.34), radius: 34, y: 16)
                .frame(maxWidth: .infinity)

            CapsuleTag(text: "SONANDO AHORA", tint: palette.primary)
                .padding(.top, 2)
            Text(track.title)
                .font(StaySoundTheme.display(34, weight: .heavy))
                .tracking(-0.9)
                .lineLimit(3)
                .minimumScaleFactor(0.74)
            Text("\(track.artist) · \(track.album)")
                .font(.system(size: 14.5, weight: .medium))
                .foregroundStyle(StaySoundTheme.secondary)
                .lineLimit(1)

            HStack(spacing: 9) {
                Text(clock.position.playbackTime)
                Slider(
                    value: Binding(get: { clock.position }, set: { player.seek(to: $0) }),
                    in: 0...max(clock.duration, 1)
                )
                .tint(palette.primary)
                Text(clock.duration.playbackTime)
            }
            .font(.system(size: 9.5, weight: .medium).monospacedDigit())
            .foregroundStyle(StaySoundTheme.muted)

            HStack(spacing: 26) {
                iconButton("shuffle", active: player.shuffleEnabled) { player.toggleShuffle() }
                iconButton("backward.fill") { player.previous() }
                Button(action: player.toggle) {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 20, weight: .black))
                        .frame(width: 58, height: 58)
                        .background(.white, in: Circle())
                        .foregroundStyle(Color(red: 0.035, green: 0.055, blue: 0.09))
                }
                .buttonStyle(.plain)
                iconButton("forward.fill") { player.next() }
                iconButton(player.repeatMode == .one ? "repeat.1" : "repeat", active: player.repeatMode != .off) {
                    player.cycleRepeat()
                }
            }
            .frame(maxWidth: .infinity)

            HStack(spacing: 10) {
                Image(systemName: player.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(StaySoundTheme.secondary)
                Slider(value: $player.volume, in: 0...1)
                    .tint(palette.primary)
                    .frame(maxWidth: 240)
            }
            Spacer(minLength: 0)
        }
    }

    private func iconButton(_ systemName: String, active: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(active ? palette.primary : StaySoundTheme.secondary)
                .frame(width: 24, height: 40)
        }
        .buttonStyle(.plain)
    }
}

private struct SyncedLyricsNativeView: View {
    @EnvironmentObject private var player: AudioPlayer
    @Environment(\.playbackClockReference) private var clock
    @EnvironmentObject private var lyrics: LyricsService
    @State private var activeLineID: Int?
    @State private var scrollTargetID: Int?
    let track: Track
    let palette: ArtworkPalette

    private var clockPublisher: AnyPublisher<Double, Never> {
        clock?.$position.eraseToAnyPublisher() ?? Empty().eraseToAnyPublisher()
    }

    private func activeLine(at position: Double) -> Int? {
        lyrics.lines.last(where: { $0.timestamp <= position + 0.08 })?.id
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if lyrics.isLoading {
                    VStack(spacing: 12) {
                        ProgressView().controlSize(.small)
                        Text("Buscando letra sincronizada…")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(StaySoundTheme.muted)
                    }
                    .frame(maxWidth: .infinity, minHeight: 460)
                } else if lyrics.lines.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "quote.bubble")
                            .font(.system(size: 34, weight: .light))
                        Text("Sin letra sincronizada")
                            .font(StaySoundTheme.display(21))
                        Text(lyrics.message)
                            .font(.system(size: 11))
                    }
                    .foregroundStyle(StaySoundTheme.muted)
                    .frame(maxWidth: .infinity, minHeight: 460)
                } else {
                    LazyVStack(alignment: .leading, spacing: 21) {
                        Color.clear.frame(height: 230)
                        ForEach(lyrics.lines) { line in
                            let active = line.id == activeLineID
                            let distance = abs(line.id - (activeLineID ?? line.id))
                            Button {
                                if line.timestamp > 0 { player.seek(to: line.timestamp) }
                            } label: {
                                KaraokeLyricText(
                                    line: line,
                                    active: active,
                                    passed: line.id < (activeLineID ?? -1),
                                    clock: clock,
                                    palette: palette
                                )
                                    .tracking(-0.6)
                                    .opacity(active ? 1 : max(0.48, 0.82 - Double(distance) * 0.055))
                                    .blur(radius: distance > 3 ? min(1.25, CGFloat(distance - 3) * 0.32) : 0)
                                    .scaleEffect(active ? 1.018 : 0.985, anchor: .leading)
                                    .offset(y: active ? -1.2 : 0)
                                    .animation(.spring(duration: 0.48, bounce: 0.1), value: active)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .id(line.id)
                        }
                        Color.clear.frame(height: 280)
                    }
                    .padding(.horizontal, 10)
                }
            }
            .scrollIndicators(.hidden)
            .onChange(of: scrollTargetID) { _, next in
                guard let next else { return }
                withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.54)) {
                    proxy.scrollTo(next, anchor: .center)
                }
            }
            .onAppear {
                let position = clock?.position ?? 0
                activeLineID = activeLine(at: position)
                scrollTargetID = activeLine(at: position + 0.22)
            }
            .onReceive(clockPublisher) { position in
                let next = activeLine(at: position)
                if next != activeLineID {
                    activeLineID = next
                }
                let predicted = activeLine(at: position + 0.22)
                if predicted != scrollTargetID {
                    scrollTargetID = predicted
                }
            }
            .onChange(of: lyrics.lines.count) {
                let position = clock?.position ?? 0
                activeLineID = activeLine(at: position)
                scrollTargetID = activeLine(at: position + 0.22)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if !lyrics.source.isEmpty {
                Text("\(lyrics.lines.contains(where: { !$0.words.isEmpty }) ? "PALABRA" : "LÍNEA") · \(lyrics.source.uppercased())")
                    .font(.system(size: 8.5, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(StaySoundTheme.muted)
                    .padding(8)
            }
        }
    }
}

private struct KaraokeLyricText: View {
    let line: LyricLine
    let active: Bool
    let passed: Bool
    let clock: PlaybackClock?
    let palette: ArtworkPalette

    var body: some View {
        Group {
            if line.words.isEmpty {
                Text(line.text)
                    .foregroundStyle(active ? palette.primary : palette.primary.opacity(0.46))
                    .font(StaySoundTheme.display(active ? 32 : 29, weight: .bold))
            } else if active {
                if let clock {
                    LiveKaraokeSweepText(clock: clock, line: line, palette: palette)
                } else {
                    Text(line.text)
                        .font(StaySoundTheme.display(32, weight: .bold))
                        .foregroundStyle(palette.primary)
                }
            } else {
                Text(line.text)
                    .font(StaySoundTheme.display(29, weight: .bold))
                    .foregroundStyle(palette.primary.opacity(passed ? 0.3 : 0.44))
            }
        }
        .shadow(color: active ? palette.primary.opacity(0.18) : .clear, radius: 11)
        .contentTransition(.interpolate)
    }
}

private struct LiveKaraokeSweepText: View {
    let clock: PlaybackClock
    let line: LyricLine
    let palette: ArtworkPalette

    var body: some View {
        KaraokeSweepText(
            line: line,
            clock: clock,
            fontSize: 32,
            primary: palette.primary,
            secondary: palette.primary.opacity(0.38)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
