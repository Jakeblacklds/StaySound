package expo.modules.karaokeview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module exposing [KaraokeRefractionView] as a native view named "KaraokeRefractionView" —
 * the Apple-style liquid-glass veil hugging the album cover's curved edge over an arc.
 */
class KaraokeRefractionModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("KaraokeRefractionView")

        View(KaraokeRefractionView::class) {
            Prop("enabled") { view: KaraokeRefractionView, value: Boolean? ->
                view.setRefractionEnabled(value ?: false)
            }

            Prop("isPlaying") { view: KaraokeRefractionView, value: Boolean? ->
                view.setRefractionPlaying(value ?: false)
            }

            Prop("artworkUri") { view: KaraokeRefractionView, value: String? ->
                view.setArtworkUri(value)
            }

            Prop("glowColor") { view: KaraokeRefractionView, color: Int? ->
                color?.let { view.setGlowColor(it) }
            }

            Prop("arcCenterDeg") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setArcCenterDeg(it.toFloat()) }
            }

            Prop("arcSweepDeg") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setArcSweepDeg(it.toFloat()) }
            }

            Prop("arcFeatherDeg") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setArcFeatherDeg(it.toFloat()) }
            }

            Prop("bandInnerFrac") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setBandInnerFrac(it.toFloat()) }
            }

            Prop("refractionStrength") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setRefractionStrength(it.toFloat()) }
            }

            Prop("chroma") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setChroma(it.toFloat()) }
            }

            Prop("blur") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setBlur(it.toFloat()) }
            }

            Prop("rimWidth") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setRimWidth(it.toFloat()) }
            }

            Prop("intensity") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setIntensity(it.toFloat()) }
            }

            Prop("coverFrac") { view: KaraokeRefractionView, value: Double? ->
                value?.let { view.setCoverFrac(it.toFloat()) }
            }
        }
    }
}
