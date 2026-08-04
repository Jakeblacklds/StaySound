import AVFoundation
import Foundation
import QuartzCore
import SwiftUI

@MainActor
final class PlaybackClock: ObservableObject {
    @Published fileprivate(set) var position = 0.0
    @Published fileprivate(set) var duration = 0.0

    private var anchorPosition = 0.0
    private var anchorHostTime = CACurrentMediaTime()
    private var isAdvancing = false

    fileprivate func record(position: Double) {
        anchorPosition = position
        anchorHostTime = CACurrentMediaTime()
        self.position = position
    }

    fileprivate func setAdvancing(_ advancing: Bool) {
        let now = CACurrentMediaTime()
        if isAdvancing {
            anchorPosition = presentationPosition(at: now)
            position = anchorPosition
        }
        anchorHostTime = now
        isAdvancing = advancing
    }

    func presentationPosition(at hostTime: CFTimeInterval = CACurrentMediaTime()) -> Double {
        let interpolated = anchorPosition + (isAdvancing ? max(0, hostTime - anchorHostTime) : 0)
        return min(max(0, interpolated), duration > 0 ? duration : interpolated)
    }
}

private struct PlaybackClockReferenceKey: EnvironmentKey {
    static let defaultValue: PlaybackClock? = nil
}

extension EnvironmentValues {
    var playbackClockReference: PlaybackClock? {
        get { self[PlaybackClockReferenceKey.self] }
        set { self[PlaybackClockReferenceKey.self] = newValue }
    }
}

@MainActor
final class AudioPlayer: ObservableObject {
    enum RepeatMode: String {
        case off, all, one
    }

    @Published private(set) var currentTrack: Track?
    @Published private(set) var isPlaying = false {
        didSet { clock.setAdvancing(isPlaying) }
    }
    let clock = PlaybackClock()
    var position: Double { clock.position }
    var duration: Double { clock.duration }
    @Published var volume: Double = 0.9 {
        didSet { player.volume = Float(volume) }
    }
    @Published private(set) var repeatMode: RepeatMode = .off
    @Published private(set) var shuffleEnabled = false

    private let player = AVPlayer()
    @Published private(set) var queue: [Track] = []
    @Published private(set) var queueIndex = -1
    private var linearQueue: [Track] = []
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    init() {
        player.volume = Float(volume)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1.0 / 30.0, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                guard let self else { return }
                self.clock.record(position: max(0, time.seconds.isFinite ? time.seconds : 0))
                if let itemDuration = self.player.currentItem?.duration.seconds, itemDuration.isFinite {
                    self.clock.duration = itemDuration
                }
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.repeatMode == .one {
                    self.seek(to: 0)
                    self.player.play()
                    self.isPlaying = true
                } else {
                    self.next()
                }
            }
        }
    }

    func play(_ track: Track, in tracks: [Track]) {
        linearQueue = tracks
        queue = tracks
        queueIndex = max(0, tracks.firstIndex(of: track) ?? 0)
        load(track, autoplay: true)
    }

    func toggle() {
        guard currentTrack != nil else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }

    func seek(to seconds: Double) {
        let target = max(0, min(seconds, duration))
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        clock.record(position: target)
    }

    func next() {
        guard queueIndex + 1 < queue.count else {
            if repeatMode == .all, let first = queue.first {
                queueIndex = 0
                load(first, autoplay: true)
                return
            }
            player.pause()
            isPlaying = false
            return
        }
        queueIndex += 1
        load(queue[queueIndex], autoplay: true)
    }

    func previous() {
        if position > 3 {
            seek(to: 0)
            return
        }
        guard queueIndex > 0 else {
            seek(to: 0)
            return
        }
        queueIndex -= 1
        load(queue[queueIndex], autoplay: true)
    }

    func playAtIndex(_ index: Int) {
        guard queue.indices.contains(index) else { return }
        queueIndex = index
        load(queue[index], autoplay: true)
    }

    func cycleRepeat() {
        switch repeatMode {
        case .off: repeatMode = .all
        case .all: repeatMode = .one
        case .one: repeatMode = .off
        }
    }

    func toggleShuffle() {
        shuffleEnabled.toggle()
        guard let currentTrack else { return }
        if shuffleEnabled {
            let rest = queue.filter { $0.id != currentTrack.id }.shuffled()
            queue = [currentTrack] + rest
            queueIndex = 0
        } else {
            queue = linearQueue
            queueIndex = queue.firstIndex(of: currentTrack) ?? 0
        }
    }

    private func load(_ track: Track, autoplay: Bool) {
        currentTrack = track
        clock.record(position: 0)
        clock.duration = track.duration
        let item = AVPlayerItem(url: track.fileURL)
        player.replaceCurrentItem(with: item)
        if autoplay {
            player.play()
            isPlaying = true
        }
    }
}
