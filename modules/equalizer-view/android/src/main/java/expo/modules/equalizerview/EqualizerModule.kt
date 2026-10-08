package expo.modules.equalizerview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS surface of [EqualizerEngine]; androidEqualizerService.ts is its only caller. */
class EqualizerModule : Module() {
    private val context get() = checkNotNull(appContext.reactContext).applicationContext

    override fun definition() = ModuleDefinition {
        Name("StaySoundEqualizer")
        OnCreate { appContext.reactContext?.let(EqualizerEngine::start) }
        AsyncFunction("getCapabilities") { -> EqualizerEngine.capabilities(context) }
        AsyncFunction("getAudioSessionId") { -> EqualizerEngine.audioSessionId(context) }
        AsyncFunction("attachToCurrentSession") { ->
            EqualizerEngine.attach(context)
            EqualizerEngine.capabilities(context)
        }
        AsyncFunction("setEnabled") { enabled: Boolean -> EqualizerEngine.setEnabled(context, enabled) }
        AsyncFunction("setBandLevel") { band: Int, level: Double -> EqualizerEngine.setBandLevel(context, band, level.toInt()) }
        AsyncFunction("usePreset") { preset: String -> preset.toIntOrNull()?.let { EqualizerEngine.usePreset(context, it) } }
        AsyncFunction("resetToFlat") { -> EqualizerEngine.resetToFlat(context) }
        AsyncFunction("openSystemEqualizerPanel") { ->
            appContext.currentActivity?.let(EqualizerEngine::openSystemPanel) ?: false
        }
        AsyncFunction("release") { -> EqualizerEngine.release() }
    }
}
