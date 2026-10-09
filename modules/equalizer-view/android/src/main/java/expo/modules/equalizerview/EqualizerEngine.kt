package expo.modules.equalizerview

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.media.audiofx.AudioEffect
import android.media.audiofx.Equalizer
import android.util.Log
import java.util.concurrent.Executors

/**
 * The one [Equalizer] bound to the playback service's ExoPlayer session.
 *
 * The service publishes its audio session id in SharedPreferences (MusicService
 * AUDIO_SESSION_PREFS_NAME / AUDIO_SESSION_KEY). The engine remembers what the user asked for
 * and re-creates the effect on whatever session is current, so a new player instance keeps the
 * same curve without JS having to notice. Band levels are in millibels, as audiofx reports them.
 */
internal object EqualizerEngine {
    private const val TAG = "StaySoundEqualizer"
    private const val SESSION_PREFS = "staysound_audio"
    private const val SESSION_KEY = "exo_audio_session_id"
    /** What every stock Android equalizer exposes; shown until a real session can be asked. */
    private val FALLBACK_HZ = intArrayOf(60, 230, 910, 3600, 14000)
    private const val FALLBACK_RANGE = 1500

    /** audiofx calls are binder round-trips; live drags go through here, off the UI thread. */
    val io = Executors.newSingleThreadExecutor { Thread(it, "staysound-eq").apply { isDaemon = true } }

    private var effect: Equalizer? = null
    private var sessionId = 0
    private var enabled = false
    private var reason: String? = null
    private val wanted = HashMap<Int, Int>()
    private var prefs: SharedPreferences? = null
    // SharedPreferences holds listeners weakly; this field is what keeps it alive.
    private var listener: SharedPreferences.OnSharedPreferenceChangeListener? = null

    @Synchronized fun start(context: Context) {
        if (prefs != null) return
        val app = context.applicationContext
        prefs = app.getSharedPreferences(SESSION_PREFS, Context.MODE_PRIVATE)
        listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == SESSION_KEY) io.execute { synchronized(this) { if (enabled) attach(app) } }
        }.also { prefs?.registerOnSharedPreferenceChangeListener(it) }
    }

    private fun currentSession(context: Context): Int {
        start(context)
        return prefs?.getInt(SESSION_KEY, 0) ?: 0
    }

    /** Binds to the current session and replays the wanted curve. False when nothing is playing yet. */
    @Synchronized fun attach(context: Context): Boolean {
        val id = currentSession(context)
        if (id <= 0) { reason = "no-session"; return false }
        if (effect != null && sessionId == id) return true
        dropEffect()
        return try {
            val next = Equalizer(0, id)
            effect = next; sessionId = id; reason = null
            val range = next.bandLevelRange
            for ((band, level) in wanted) {
                if (band in 0 until next.numberOfBands) {
                    next.setBandLevel(band.toShort(), level.coerceIn(range[0].toInt(), range[1].toInt()).toShort())
                }
            }
            next.enabled = enabled
            true
        } catch (error: Throwable) {
            Log.w(TAG, "attach failed for session $id", error)
            dropEffect(); reason = error.message ?: error.javaClass.simpleName
            false
        }
    }

    @Synchronized fun setEnabled(context: Context, value: Boolean) {
        enabled = value
        if (value) attach(context)
        guarded(context) { it.enabled = value }
    }

    @Synchronized fun setBandLevel(context: Context, band: Int, level: Int) {
        wanted[band] = level
        if (!enabled) return
        attach(context)
        guarded(context) {
            if (band in 0 until it.numberOfBands) {
                val range = it.bandLevelRange
                it.setBandLevel(band.toShort(), level.coerceIn(range[0].toInt(), range[1].toInt()).toShort())
            }
        }
    }

    @Synchronized fun usePreset(context: Context, preset: Int) {
        attach(context)
        guarded(context) {
            if (preset !in 0 until it.numberOfPresets) return@guarded
            it.usePreset(preset.toShort())
            for (band in 0 until it.numberOfBands) wanted[band] = it.getBandLevel(band.toShort()).toInt()
        }
    }

    @Synchronized fun resetToFlat(context: Context) {
        val count = effect?.numberOfBands?.toInt() ?: FALLBACK_HZ.size
        for (band in 0 until count) wanted[band] = 0
        guarded(context) { for (band in 0 until it.numberOfBands) it.setBandLevel(band.toShort(), 0) }
    }

    /** Turns the effect off and lets go of the session; the wanted curve is kept for next time. */
    @Synchronized fun release() { enabled = false; dropEffect() }

    private fun dropEffect() {
        runCatching { effect?.release() }
        effect = null; sessionId = 0
    }

    /** One retry on a fresh effect: audiofx throws when the session it was bound to has gone away. */
    private fun guarded(context: Context, block: (Equalizer) -> Unit) {
        val first = effect ?: return
        try { block(first) } catch (error: Throwable) {
            Log.w(TAG, "effect call failed, re-attaching", error)
            dropEffect()
            if (!attach(context)) return
            try { effect?.let(block) } catch (again: Throwable) {
                dropEffect(); reason = again.message ?: again.javaClass.simpleName
            }
        }
    }

    @Synchronized fun capabilities(context: Context): Map<String, Any?> {
        val current = effect
        val bands = ArrayList<Map<String, Any>>()
        val presets = ArrayList<Map<String, Any>>()
        var min = -FALLBACK_RANGE
        var max = FALLBACK_RANGE
        var live = false
        if (current != null) try {
            val range = current.bandLevelRange
            min = range[0].toInt(); max = range[1].toInt()
            for (band in 0 until current.numberOfBands) {
                val index = band.toShort()
                val span = current.getBandFreqRange(index)
                bands += mapOf(
                    "index" to band, "centerHz" to current.getCenterFreq(index) / 1000.0,
                    "lowerHz" to span[0] / 1000.0, "upperHz" to span[1] / 1000.0,
                    "level" to current.getBandLevel(index).toInt(), "minLevel" to min, "maxLevel" to max,
                )
            }
            for (preset in 0 until current.numberOfPresets) {
                presets += mapOf("index" to preset, "name" to current.getPresetName(preset.toShort()))
            }
            live = true
        } catch (error: Throwable) {
            Log.w(TAG, "could not read the effect", error)
            dropEffect(); bands.clear(); presets.clear(); reason = error.message ?: error.javaClass.simpleName
        }
        if (!live) FALLBACK_HZ.forEachIndexed { band, hz ->
            bands += mapOf(
                "index" to band, "centerHz" to hz.toDouble(), "lowerHz" to hz * 0.5, "upperHz" to hz * 2.0,
                "level" to (wanted[band] ?: 0), "minLevel" to -FALLBACK_RANGE, "maxLevel" to FALLBACK_RANGE,
            )
        }
        return mapOf(
            "available" to true, "attached" to live, "audioSessionId" to if (live) sessionId else currentSession(context),
            "minLevel" to min, "maxLevel" to max, "bands" to bands, "nativePresets" to presets,
            "canOpenSystemPanel" to (panelIntent(context).resolveActivity(context.packageManager) != null),
            "reason" to reason,
        )
    }

    fun audioSessionId(context: Context) = currentSession(context)

    private fun panelIntent(context: Context) = Intent(AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL)
        .putExtra(AudioEffect.EXTRA_AUDIO_SESSION, currentSession(context))
        .putExtra(AudioEffect.EXTRA_PACKAGE_NAME, context.packageName)
        .putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)

    /** Hands the session to the device's own equalizer and shows its panel. */
    fun openSystemPanel(activity: Activity): Boolean {
        val intent = panelIntent(activity)
        if (intent.resolveActivity(activity.packageManager) == null) return false
        return try {
            activity.sendBroadcast(Intent(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION).putExtras(intent))
            // The panel contract is startActivityForResult; plain startActivity is rejected by some OEM panels.
            activity.startActivityForResult(intent, 0)
            true
        } catch (error: Throwable) {
            Log.w(TAG, "system panel refused to open", error)
            false
        }
    }
}
