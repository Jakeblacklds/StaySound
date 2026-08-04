import SwiftUI

struct DownloadsView: View {
    @EnvironmentObject private var soulseek: SoulseekService
    @State private var query = ""
    @State private var showingCredentials = false

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 22) {
                searchHero

                if showingCredentials {
                    credentialsPanel
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                if soulseek.isSearching {
                    searchingState
                } else if soulseek.results.isEmpty {
                    emptyState
                } else {
                    resultsHeader
                    LazyVStack(spacing: 7) {
                        ForEach(soulseek.results) { match in
                            SoulseekResultRow(match: match)
                        }
                    }
                }
            }
            .padding(.horizontal, 30)
            .padding(.top, 2)
            .padding(.bottom, 132)
        }
        .animation(.snappy(duration: 0.3), value: showingCredentials)
    }

    private var searchHero: some View {
        HStack(spacing: 24) {
            VStack(alignment: .leading, spacing: 9) {
                CapsuleTag(text: "RED SOULSEEK", tint: ArtworkPalette.fallback.primary)
                Text("Busca esa canción\nque no aparece en ningún lado.")
                    .font(StaySoundTheme.display(28, weight: .bold))
                    .lineSpacing(-1)
                Text("La descarga queda en tu carpeta local y se suma a StaySound en el siguiente escaneo.")
                    .font(.system(size: 12.5))
                    .foregroundStyle(StaySoundTheme.secondary)
                    .frame(maxWidth: 510, alignment: .leading)
            }

            Spacer(minLength: 20)

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(StaySoundTheme.muted)
                    TextField("Canción, artista o álbum", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium))
                        .onSubmit(search)
                    if !query.isEmpty {
                        Button { query = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(StaySoundTheme.muted)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 15)
                .frame(width: 390, height: 46)
                .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 13).stroke(StaySoundTheme.line, lineWidth: 1) }

                HStack(spacing: 9) {
                    Button {
                        withAnimation { showingCredentials.toggle() }
                    } label: {
                        Label(showingCredentials ? "Ocultar cuenta" : "Cuenta", systemImage: "person.crop.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SoulseekSecondaryButtonStyle())

                    Button(action: search) {
                        Label(soulseek.isSearching ? "Buscando" : "Buscar", systemImage: "sparkle.magnifyingglass")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SoulseekPrimaryButtonStyle())
                    .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || soulseek.isSearching)
                }
            }
        }
        .padding(24)
        .staySoundCard(radius: 22)
    }

    private var credentialsPanel: some View {
        HStack(spacing: 12) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 22))
                .foregroundStyle(ArtworkPalette.fallback.primary)
                .frame(width: 46, height: 46)
                .background(ArtworkPalette.fallback.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 13))

            VStack(alignment: .leading, spacing: 4) {
                Text("Cuenta Soulseek")
                    .font(.system(size: 13, weight: .bold))
                Text("Se guarda únicamente en esta Mac.")
                    .font(.system(size: 10.5))
                    .foregroundStyle(StaySoundTheme.muted)
            }

            Spacer()

            TextField("Usuario", text: $soulseek.credentials.username)
                .soulseekField(width: 190)
            SecureField("Contraseña", text: $soulseek.credentials.password)
                .soulseekField(width: 190)
            Button("Guardar") {
                soulseek.saveCredentials()
                withAnimation { showingCredentials = false }
            }
            .buttonStyle(SoulseekPrimaryButtonStyle())
        }
        .padding(16)
        .staySoundCard(radius: 17)
    }

    private var searchingState: some View {
        VStack(spacing: 15) {
            ProgressView()
                .controlSize(.large)
                .tint(ArtworkPalette.fallback.primary)
            Text("Recorriendo la red Soulseek…")
                .font(StaySoundTheme.display(16))
            Text("Puede tardar unos segundos mientras llegan resultados de distintos usuarios.")
                .font(.system(size: 11.5))
                .foregroundStyle(StaySoundTheme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 72)
    }

    private var emptyState: some View {
        VStack(spacing: 13) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(ArtworkPalette.fallback.primary)
            Text("Tu próxima rareza vive aquí")
                .font(StaySoundTheme.display(19))
            Text(soulseek.message.isEmpty ? "Escribe una búsqueda para explorar Soulseek." : soulseek.message)
                .font(.system(size: 12))
                .foregroundStyle(StaySoundTheme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 68)
        .staySoundCard(radius: 20)
    }

    private var resultsHeader: some View {
        HStack {
            Text("RESULTADOS")
                .font(.system(size: 10, weight: .bold))
                .tracking(2)
                .foregroundStyle(StaySoundTheme.muted)
            Spacer()
            Text(soulseek.message)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(StaySoundTheme.secondary)
        }
    }

    private func search() {
        soulseek.search(query)
    }
}

private struct SoulseekResultRow: View {
    @EnvironmentObject private var soulseek: SoulseekService
    let match: SoulseekMatch
    @State private var hovering = false

    private var filename: String { URL(fileURLWithPath: match.filename).lastPathComponent }
    private var details: String {
        [
            match.username,
            match.bitRate.map { "\($0) kbps" },
            match.size.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }
        ]
        .compactMap { $0 }
        .joined(separator: "  ·  ")
    }

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: "waveform")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(ArtworkPalette.fallback.primary)
                .frame(width: 42, height: 42)
                .background(ArtworkPalette.fallback.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 5) {
                Text(filename)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(details)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(StaySoundTheme.muted)
                    .lineLimit(1)
            }

            Spacer()

            if match.slots == true {
                CapsuleTag(text: "LIBRE", tint: .green)
            }

            Button {
                soulseek.download(match)
            } label: {
                Group {
                    if soulseek.downloadingIDs.contains(match.id) {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.down")
                    }
                }
                .frame(width: 38, height: 38)
                .background(ArtworkPalette.fallback.primary, in: Circle())
                .foregroundStyle(Color.black.opacity(0.82))
            }
            .buttonStyle(.plain)
            .disabled(soulseek.downloadingIDs.contains(match.id))
        }
        .padding(.horizontal, 14)
        .frame(height: 68)
        .background(hovering ? StaySoundTheme.cardHover : StaySoundTheme.card, in: RoundedRectangle(cornerRadius: 15))
        .overlay { RoundedRectangle(cornerRadius: 15).stroke(StaySoundTheme.line, lineWidth: 1) }
        .onHover { hovering = $0 }
    }
}

private struct SoulseekPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11.5, weight: .bold))
            .padding(.horizontal, 15)
            .frame(height: 38)
            .background(ArtworkPalette.fallback.primary.opacity(configuration.isPressed ? 0.72 : 1), in: Capsule())
            .foregroundStyle(Color.black.opacity(0.82))
    }
}

private struct SoulseekSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11.5, weight: .semibold))
            .padding(.horizontal, 15)
            .frame(height: 38)
            .background(Color.white.opacity(configuration.isPressed ? 0.13 : 0.07), in: Capsule())
            .overlay { Capsule().stroke(StaySoundTheme.line, lineWidth: 1) }
    }
}

private extension View {
    func soulseekField(width: CGFloat) -> some View {
        textFieldStyle(.plain)
            .font(.system(size: 12))
            .padding(.horizontal, 12)
            .frame(width: width, height: 38)
            .background(Color.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(StaySoundTheme.line, lineWidth: 1) }
    }
}
