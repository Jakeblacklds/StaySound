package expo.modules.karaokeview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module exposing [KaraokeSpectrumView] as a standalone native view named
 * "KaraokeSpectrumView", so React Native can position the bottom audio spectrum
 * independently of the lyrics view.
 */
class KaraokeSpectrumModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("KaraokeSpectrumView")

        View(KaraokeSpectrumView::class) {
            Prop("enabled") { view: KaraokeSpectrumView, value: Boolean? ->
                view.setSpectrumEnabled(value ?: false)
            }

            Prop("isPlaying") { view: KaraokeSpectrumView, value: Boolean? ->
                view.setSpectrumPlaying(value ?: false)
            }

            Prop("audioSessionId") { view: KaraokeSpectrumView, value: Int? ->
                view.setAudioSessionId(value ?: 0)
            }

            Prop("renderDelayMs") { view: KaraokeSpectrumView, value: Int? ->
                value?.let { view.setRenderDelayMs(it) }
            }

            Prop("glowColor") { view: KaraokeSpectrumView, color: Int? ->
                color?.let { view.setGlowColor(it) }
            }

            Prop("anchorMode") { view: KaraokeSpectrumView, value: String? ->
                view.setAnchorMode(value ?: "lyrics")
            }

            Prop("spectrumTheme") { view: KaraokeSpectrumView, value: String? ->
                view.setSpectrumTheme(value ?: "aurora")
            }

            Prop("focusY") { view: KaraokeSpectrumView, value: Double? ->
                value?.let { view.setFocusY(it.toFloat()) }
            }

            Prop("artworkSize") { view: KaraokeSpectrumView, value: Double? ->
                value?.let { view.setArtworkSize(it.toFloat()) }
            }

            Prop("particleIntensity") { view: KaraokeSpectrumView, value: Double? ->
                view.setParticleIntensity((value ?: 1.0).toFloat())
            }
        }
    }
}
