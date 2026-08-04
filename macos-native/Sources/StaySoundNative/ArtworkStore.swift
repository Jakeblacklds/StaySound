import AppKit
import AVFoundation
import CoreImage
import SwiftUI

@MainActor
final class ArtworkStore: ObservableObject {
    @Published private(set) var images: [String: NSImage] = [:]
    @Published private(set) var palettes: [String: ArtworkPalette] = [:]
    private var loading = Set<String>()

    func image(for track: Track) -> NSImage? {
        images[track.id]
    }

    func color(for track: Track?) -> Color {
        palette(for: track).primary
    }

    func palette(for track: Track?) -> ArtworkPalette {
        guard let track else { return .fallback }
        return palettes[track.id] ?? .fallback
    }

    func load(_ track: Track) {
        guard images[track.id] == nil, !loading.contains(track.id) else { return }
        loading.insert(track.id)
        let id = track.id
        let url = track.fileURL

        Task {
            let image = await Task.detached(priority: .utility) {
                Self.extractArtwork(from: url)
            }.value
            loading.remove(id)
            guard let image else { return }
            images[id] = image
            palettes[id] = Self.makePalette(from: image)
        }
    }

    func recoverArtwork(for tracks: [Track]) {
        for track in tracks { load(track) }
    }

    nonisolated private static func extractArtwork(from url: URL) -> NSImage? {
        let base = url.deletingPathExtension()
        for ext in ["jpg", "jpeg", "png", "webp"] {
            if let image = NSImage(contentsOf: base.appendingPathExtension(ext)) { return image }
        }
        let directory = url.deletingLastPathComponent()
        for name in ["cover", "folder", "front", "album"] {
            for ext in ["jpg", "jpeg", "png", "webp"] {
                if let image = NSImage(contentsOf: directory.appendingPathComponent(name).appendingPathExtension(ext)) {
                    return image
                }
            }
        }
        let asset = AVURLAsset(url: url)
        for item in asset.commonMetadata where item.commonKey == .commonKeyArtwork {
            if let data = item.dataValue, let image = NSImage(data: data) { return image }
        }
        let metadataURL = base.appendingPathExtension("json")
        if let data = try? Data(contentsOf: metadataURL),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let artwork = object["artwork"] as? String,
           let remoteURL = URL(string: artwork),
           let remoteData = try? Data(contentsOf: remoteURL),
           let image = NSImage(data: remoteData) {
            return image
        }
        return nil
    }

    nonisolated private static func averageColor(from image: NSImage) -> NSColor? {
        guard let data = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: data),
              let ciImage = CIImage(bitmapImageRep: bitmap) else { return nil }

        let extent = ciImage.extent
        guard let filter = CIFilter(name: "CIAreaAverage") else { return nil }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        filter.setValue(CIVector(cgRect: extent), forKey: kCIInputExtentKey)
        guard let output = filter.outputImage else { return nil }

        var pixel = [UInt8](repeating: 0, count: 4)
        CIContext(options: [.workingColorSpace: NSNull()]).render(
            output,
            toBitmap: &pixel,
            rowBytes: 4,
            bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
            format: .RGBA8,
            colorSpace: nil
        )
        return NSColor(
            red: CGFloat(pixel[0]) / 255,
            green: CGFloat(pixel[1]) / 255,
            blue: CGFloat(pixel[2]) / 255,
            alpha: 1
        )
    }

    nonisolated private static func makePalette(from image: NSImage) -> ArtworkPalette {
        guard let average = averageColor(from: image)?.usingColorSpace(.deviceRGB) else { return .fallback }
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        var alpha: CGFloat = 0
        average.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        let vividSaturation = max(0.58, min(0.92, saturation * 1.55))
        let primary = NSColor(
            hue: hue,
            saturation: vividSaturation,
            brightness: max(0.72, min(0.98, brightness * 1.35)),
            alpha: 1
        )
        let secondary = NSColor(
            hue: (hue + 0.11).truncatingRemainder(dividingBy: 1),
            saturation: max(0.5, vividSaturation * 0.82),
            brightness: max(0.58, min(0.9, brightness * 1.15)),
            alpha: 1
        )
        let accent = NSColor(
            hue: (hue + 0.88).truncatingRemainder(dividingBy: 1),
            saturation: max(0.48, vividSaturation * 0.74),
            brightness: 0.88,
            alpha: 1
        )
        let background = NSColor(
            hue: hue,
            saturation: min(0.62, vividSaturation * 0.66),
            brightness: 0.13,
            alpha: 1
        )
        return ArtworkPalette(
            primary: Color(nsColor: primary),
            secondary: Color(nsColor: secondary),
            accent: Color(nsColor: accent),
            background: Color(nsColor: background)
        )
    }
}

struct ArtworkPalette: Sendable {
    let primary: Color
    let secondary: Color
    let accent: Color
    let background: Color

    static let fallback = ArtworkPalette(
        primary: Color(red: 0.24, green: 0.82, blue: 0.96),
        secondary: Color(red: 0.28, green: 0.48, blue: 0.92),
        accent: Color(red: 0.72, green: 0.35, blue: 0.94),
        background: Color(red: 0.035, green: 0.055, blue: 0.09)
    )
}

struct TrackArtwork: View {
    @EnvironmentObject private var artwork: ArtworkStore
    let track: Track
    var size: CGFloat
    var cornerRadius: CGFloat = 10

    var body: some View {
        Group {
            if let image = artwork.image(for: track) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    LinearGradient(
                        colors: [.accentColor.opacity(0.7), .purple.opacity(0.55)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "music.note")
                        .font(.system(size: size * 0.34, weight: .bold))
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .contentShape(Rectangle())
        .task(id: track.id) { artwork.load(track) }
    }
}
