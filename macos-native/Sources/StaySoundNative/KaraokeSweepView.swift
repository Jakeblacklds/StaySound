import AppKit
import Combine
import QuartzCore
import SwiftUI

/// Native equivalent of am-lyrics' two-gradient syllable wipe.
/// Text layout is cached by NSTextKit; Core Animation composites the moving mask on the GPU.
struct KaraokeSweepText: NSViewRepresentable {
    let line: LyricLine
    let clock: PlaybackClock
    let fontSize: CGFloat
    let primary: Color
    let secondary: Color

    func makeNSView(context: Context) -> KaraokeSweepNSView {
        KaraokeSweepNSView()
    }

    func updateNSView(_ nsView: KaraokeSweepNSView, context: Context) {
        nsView.configure(
            line: line,
            clock: clock,
            fontSize: fontSize,
            primary: NSColor(primary),
            secondary: NSColor(secondary)
        )
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        nsView: KaraokeSweepNSView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return CGSize(width: width, height: nsView.fittingHeight(for: width))
    }
}

final class KaraokeSweepNSView: NSView {
    private let baseText = NSTextView(frame: .zero)
    private let highlightText = NSTextView(frame: .zero)
    private let pulseText = NSTextView(frame: .zero)
    private let maskRoot = CALayer()
    private var completedMasks: [CALayer] = []
    private let activeMask = CAGradientLayer()
    private let pulseMask = CAGradientLayer()
    private var displayLink: CADisplayLink?
    private weak var clock: PlaybackClock?

    private var line: LyricLine?
    private var position = 0.0
    private var configuredWidth: CGFloat = 0
    private var wordRects: [[CGRect]] = []
    private var attributedText = NSAttributedString()
    private var cachedPrimary: NSColor?
    private var cachedSecondary: NSColor?
    private var completedThrough = -2
    private var activeWordIndex = -1

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        configureTextView(baseText)
        configureTextView(highlightText)
        configureTextView(pulseText)
        addSubview(baseText)
        addSubview(highlightText)
        addSubview(pulseText)

        maskRoot.backgroundColor = NSColor.clear.cgColor
        configureGradient(activeMask)
        configureGradient(pulseMask)
        maskRoot.addSublayer(activeMask)
        highlightText.wantsLayer = true
        highlightText.layer?.mask = maskRoot
        pulseText.wantsLayer = true
        pulseText.layer?.mask = pulseMask
        pulseText.layer?.shadowRadius = 7
        pulseText.layer?.shadowOffset = .zero
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        displayLink?.invalidate()
        displayLink = nil
        guard window != nil else { return }
        let link = displayLink(target: self, selector: #selector(drawKaraokeFrame(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func configureGradient(_ layer: CAGradientLayer) {
        layer.startPoint = CGPoint(x: 0, y: 0.5)
        layer.endPoint = CGPoint(x: 1, y: 0.5)
        layer.colors = [
            NSColor.white.cgColor,
            NSColor.white.cgColor,
            NSColor.clear.cgColor,
        ]
        layer.actions = [
            "bounds": NSNull(), "position": NSNull(), "hidden": NSNull(),
            "locations": NSNull(), "transform": NSNull(),
        ]
    }

    @objc private func drawKaraokeFrame(_ sender: CADisplayLink) {
        guard let clock else { return }
        position = clock.presentationPosition(at: sender.targetTimestamp)
        updateMask()
    }

    private func configureTextView(_ textView: NSTextView) {
        textView.drawsBackground = false
        textView.isEditable = false
        textView.isSelectable = false
        textView.isRichText = true
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.heightTracksTextView = false
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
    }

    func configure(
        line: LyricLine,
        clock: PlaybackClock,
        fontSize: CGFloat,
        primary: NSColor,
        secondary: NSColor
    ) {
        let contentChanged = self.line != line
        self.line = line
        self.clock = clock
        self.position = clock.presentationPosition()

        let colorsChanged = cachedPrimary != primary || cachedSecondary != secondary
        if contentChanged || attributedText.length == 0 {
            let text = line.words.map(\.text).joined()
            let baseFont = NSFont.systemFont(ofSize: fontSize, weight: .bold)
            let font = baseFont.fontDescriptor.withDesign(.rounded)
                .flatMap { NSFont(descriptor: $0, size: fontSize) } ?? baseFont
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byWordWrapping
            paragraph.lineSpacing = 1
            attributedText = NSAttributedString(
                string: text,
                attributes: [
                    .font: font,
                    .kern: -0.6,
                    .paragraphStyle: paragraph,
                ]
            )
            cachedPrimary = primary
            cachedSecondary = secondary
            baseText.textStorage?.setAttributedString(attributedText.withColor(secondary))
            highlightText.textStorage?.setAttributedString(attributedText.withColor(primary))
            pulseText.textStorage?.setAttributedString(attributedText.withColor(primary))
            pulseText.layer?.shadowColor = primary.cgColor
            configuredWidth = 0
            completedThrough = -2
            activeWordIndex = -1
        } else if colorsChanged {
            cachedPrimary = primary
            cachedSecondary = secondary
            baseText.textStorage?.setAttributedString(attributedText.withColor(secondary))
            highlightText.textStorage?.setAttributedString(attributedText.withColor(primary))
            pulseText.textStorage?.setAttributedString(attributedText.withColor(primary))
            pulseText.layer?.shadowColor = primary.cgColor
        }

        if bounds.width > 0, abs(configuredWidth - bounds.width) > 0.5 {
            rebuildLayout(width: bounds.width)
        }
        updateMask()
    }

    override func layout() {
        super.layout()
        baseText.frame = bounds
        highlightText.frame = bounds
        pulseText.frame = bounds
        maskRoot.frame = highlightText.bounds
        pulseMask.frame = pulseText.bounds
        if abs(configuredWidth - bounds.width) > 0.5 {
            rebuildLayout(width: bounds.width)
        }
        updateMask()
    }

    func fittingHeight(for width: CGFloat) -> CGFloat {
        if abs(configuredWidth - width) > 0.5 { rebuildLayout(width: width) }
        guard let layoutManager = baseText.layoutManager,
              let textContainer = baseText.textContainer else { return 42 }
        layoutManager.ensureLayout(for: textContainer)
        return ceil(max(42, layoutManager.usedRect(for: textContainer).height + 2))
    }

    private func rebuildLayout(width: CGFloat) {
        guard width > 0, let line else { return }
        configuredWidth = width
        for view in [baseText, highlightText, pulseText] {
            view.frame = CGRect(x: 0, y: 0, width: width, height: 1_000)
            view.textContainer?.containerSize = CGSize(width: width, height: .greatestFiniteMagnitude)
            if let container = view.textContainer { view.layoutManager?.ensureLayout(for: container) }
        }

        wordRects = []
        guard let layoutManager = highlightText.layoutManager,
              let textContainer = highlightText.textContainer else { return }

        var characterOffset = 0
        for word in line.words {
            let length = (word.text as NSString).length
            let characterRange = NSRange(location: characterOffset, length: length)
            let glyphRange = layoutManager.glyphRange(forCharacterRange: characterRange, actualCharacterRange: nil)
            var rects: [CGRect] = []
            layoutManager.enumerateEnclosingRects(
                forGlyphRange: glyphRange,
                withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0),
                in: textContainer
            ) { rect, _ in
                if rect.width > 0, rect.height > 0 { rects.append(rect.integral) }
            }
            wordRects.append(rects)
            characterOffset += length
        }
        rebuildCompletedLayers(count: line.words.count)
        for index in line.words.indices where wordRects.indices.contains(index) {
            completedMasks[index].frame = wordRects[index].reduce(CGRect.null) { $0.union($1) }
            completedMasks[index].isHidden = true
        }
        completedThrough = -2
        activeWordIndex = -1
    }

    private func rebuildCompletedLayers(count: Int) {
        for layer in completedMasks { layer.removeFromSuperlayer() }
        completedMasks = (0..<count).map { _ in
            let layer = CALayer()
            layer.backgroundColor = NSColor.white.cgColor
            layer.actions = ["bounds": NSNull(), "position": NSNull(), "hidden": NSNull()]
            maskRoot.addSublayer(layer)
            return layer
        }
        maskRoot.addSublayer(activeMask)
    }

    private func updateMask() {
        guard let line, line.words.count == completedMasks.count else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)

        activeMask.isHidden = true
        pulseMask.isHidden = true

        let newCompletedThrough = line.words.lastIndex(where: { position >= $0.endTime }) ?? -1
        if newCompletedThrough != completedThrough {
            completedThrough = newCompletedThrough
            for index in line.words.indices {
                completedMasks[index].isHidden = index > newCompletedThrough
            }
        }

        guard let index = line.words.firstIndex(where: {
            position >= $0.startTime && position < $0.endTime
        }), wordRects.indices.contains(index) else {
            activeWordIndex = -1
            pulseText.layer?.setAffineTransform(.identity)
            pulseText.layer?.shadowOpacity = 0
            CATransaction.commit()
            return
        }

        let word = line.words[index]
        let rect = wordRects[index].reduce(CGRect.null) { $0.union($1) }
        guard rect.width > 0 else {
            CATransaction.commit()
            return
        }
        let duration = max(0.04, word.endTime - word.startTime)
        let progress = CGFloat(max(0, min(1, (position - word.startTime) / duration)))
        let feather = max(10, min(24, rect.height * 0.52))
        let sweptWidth = rect.width * progress
        let totalWidth = max(feather, sweptWidth + feather)
        let maskFrame = CGRect(
            x: rect.minX - feather,
            y: rect.minY,
            width: totalWidth,
            height: rect.height
        )
        let solidStop = NSNumber(value: Double(max(0, min(0.94, (totalWidth - feather) / totalWidth))))
        for mask in [activeMask, pulseMask] {
            mask.frame = maskFrame
            mask.locations = [0, solidStop, 1]
            mask.isHidden = false
        }

        if activeWordIndex != index {
            activeWordIndex = index
            movePulseAnchor(to: CGPoint(x: rect.midX, y: rect.midY))
        }
        let grow = sin(.pi * progress)
        let rise = sin(min(1, progress / 0.65) * .pi / 2)
        let scale = 1 + 0.072 * grow
        pulseText.layer?.setAffineTransform(
            CGAffineTransform(translationX: 0, y: -1.15 * rise).scaledBy(x: scale, y: scale)
        )
        pulseText.layer?.shadowOpacity = Float(0.34 * grow)
        CATransaction.commit()
    }

    private func movePulseAnchor(to point: CGPoint) {
        guard let layer = pulseText.layer, layer.bounds.width > 0, layer.bounds.height > 0 else { return }
        let anchor = CGPoint(
            x: max(0, min(1, point.x / layer.bounds.width)),
            y: max(0, min(1, point.y / layer.bounds.height))
        )
        let old = layer.anchorPoint
        layer.position.x += (anchor.x - old.x) * layer.bounds.width
        layer.position.y += (anchor.y - old.y) * layer.bounds.height
        layer.anchorPoint = anchor
    }
}

private extension NSAttributedString {
    func withColor(_ color: NSColor) -> NSAttributedString {
        let copy = NSMutableAttributedString(attributedString: self)
        copy.addAttribute(.foregroundColor, value: color, range: NSRange(location: 0, length: copy.length))
        return copy
    }
}
