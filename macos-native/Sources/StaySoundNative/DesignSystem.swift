import AppKit
import SwiftUI

enum StaySoundTheme {
    static let root = Color(red: 0.023, green: 0.035, blue: 0.059)
    static let rootRaised = Color(red: 0.04, green: 0.062, blue: 0.098)
    static let card = Color.white.opacity(0.055)
    static let cardHover = Color.white.opacity(0.1)
    static let line = Color.white.opacity(0.085)
    static let muted = Color.white.opacity(0.48)
    static let secondary = Color.white.opacity(0.68)

    static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}

struct AmbientBackground: View {
    var palette: ArtworkPalette = .fallback

    var body: some View {
        ZStack {
            StaySoundTheme.root
            RadialGradient(
                colors: [palette.primary.opacity(0.16), .clear],
                center: UnitPoint(x: 0.08, y: 0.02),
                startRadius: 0,
                endRadius: 760
            )
            RadialGradient(
                colors: [palette.secondary.opacity(0.12), .clear],
                center: UnitPoint(x: 0.92, y: 0.86),
                startRadius: 0,
                endRadius: 680
            )
            LinearGradient(
                colors: [.clear, palette.background.opacity(0.56), StaySoundTheme.root.opacity(0.8)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .ignoresSafeArea()
    }
}

struct RoundIconButton: View {
    let systemName: String
    var size: CGFloat = 40
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: size, height: size)
                .background(.thinMaterial, in: Circle())
                .overlay { Circle().stroke(.white.opacity(0.1), lineWidth: 1) }
        }
        .buttonStyle(.plain)
    }
}

struct CapsuleTag: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .bold))
            .tracking(1.15)
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(tint.opacity(0.08), in: Capsule())
            .overlay { Capsule().stroke(tint.opacity(0.55), lineWidth: 1) }
    }
}

extension View {
    func staySoundCard(radius: CGFloat = 18) -> some View {
        background(StaySoundTheme.card, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(StaySoundTheme.line, lineWidth: 1)
            }
    }
}
