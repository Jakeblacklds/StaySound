package expo.modules.karaokeview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Module definition for KaraokeView
 * Bridges JS <-> Kotlin with props and events
 */
class KaraokeViewModule : Module() {
    private val remoteDataSource = NoopRemoteLyricsDataSource()
    private var lyricsRepository: LyricsRepository? = null
    private val lrcLibDataSource = LrcLibDataSource()

    private fun repository(): LyricsRepository? {
        val existing = lyricsRepository
        if (existing != null) return existing

        val context = appContext.reactContext?.applicationContext ?: return null
        val repo = LyricsRepository(
            localStore = FileLyricsStore(context),
            remoteDataSource = remoteDataSource,
        )
        lyricsRepository = repo
        return repo
    }

    private fun toResultMap(record: LyricsPayload): Map<String, Any?> {
        return mapOf(
            "canonicalKey" to record.canonicalKey,
            "payloadJson" to record.payloadJson,
            "updatedAt" to record.updatedAt,
        )
    }

    override fun definition() = ModuleDefinition {
        Name("KaraokeView")

        Function("normalizeKeyPart") { value: String ->
            LyricsRepository.normalizeKeyPart(value)
        }

        Function("canonicalKey") { songTitle: String, artist: String ->
            LyricsRepository.canonicalKey(songTitle, artist)
        }

        AsyncFunction("getLyrics") { songTitle: String, artist: String ->
            repository()?.getLyrics(songTitle, artist)?.let { toResultMap(it) }
        }

        AsyncFunction("forceRefreshLyrics") { songTitle: String, artist: String ->
            repository()?.forceRefreshLyrics(songTitle, artist)?.let { toResultMap(it) }
        }

        AsyncFunction("getLrcLibLyrics") { songTitle: String, artist: String, durationSec: Double? ->
            lrcLibDataSource.fetchLyrics(songTitle, artist, durationSec)
        }

        View(KaraokeView::class) {
            Prop("lyrics") { view: KaraokeView, lyrics: List<Map<String, Any>>? ->
                lyrics?.let { view.setLyrics(it) }
            }

            Prop("currentTimeMs") { view: KaraokeView, timeMs: Double? ->
                timeMs?.let { view.updateTime(it.toLong()) }
            }

            Prop("isPlaying") { view: KaraokeView, value: Boolean? ->
                view.setIsPlaying(value ?: false)
            }

            Prop("fontSize") { view: KaraokeView, size: Double? ->
                size?.let { view.setFontSize(it.toFloat()) }
            }

            Prop("activeColor") { view: KaraokeView, color: Int? ->
                color?.let { view.setActiveColor(it) }
            }

            Prop("inactiveColor") { view: KaraokeView, color: Int? ->
                color?.let { view.setInactiveColor(it) }
            }

            Prop("glowColor") { view: KaraokeView, color: Int? ->
                color?.let { view.setGlowColor(it) }
            }

            Prop("backgroundColor") { view: KaraokeView, color: Int? ->
                color?.let { view.setPlayerBackgroundColor(it) }
            }

            Prop("enableAmbientBackground") { view: KaraokeView, value: Boolean? ->
                view.setEnableAmbientBackground(value ?: true)
            }

            Prop("isLineByLine") { view: KaraokeView, value: Boolean? ->
                view.setIsLineByLine(value ?: false)
            }

            Prop("enableSeekOnTap") { view: KaraokeView, value: Boolean? ->
                view.setSeekOnTapEnabled(value ?: false)
            }

            Prop("enableSpectralParticles") { view: KaraokeView, value: Boolean? ->
                view.setEnableSpectralParticles(value ?: true)
            }

            Prop("audioSessionId") { view: KaraokeView, value: Int? ->
                view.setAudioSessionId(value ?: 0)
            }

            Prop("enableBottomSpectrum") { view: KaraokeView, value: Boolean? ->
                view.setEnableBottomSpectrum(value ?: false)
            }

            Prop("displayMode") { view: KaraokeView, value: String? ->
                view.setDisplayMode(value)
            }

            Prop("motionProfile") { view: KaraokeView, value: String? ->
                view.setMotionProfile(value)
            }

            Prop("introTitle") { view: KaraokeView, value: String? ->
                view.setIntroTitle(value)
            }

            Prop("introSubtitle") { view: KaraokeView, value: String? ->
                view.setIntroSubtitle(value)
            }

            Events("onLineChange", "onWordChange", "onSeek")
        }
    }
}
