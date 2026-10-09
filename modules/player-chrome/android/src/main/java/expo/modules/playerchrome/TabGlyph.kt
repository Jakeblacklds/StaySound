package expo.modules.playerchrome

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.view.View
import androidx.core.graphics.ColorUtils
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin

/**
 * One dock icon, drawn from the StaySound catalogue ([StayIcons] tab-home / tab-library /
 * tab-search / tab-playlists — the same marks the web's mobile nav uses).
 *  - [selection] 0..1 moves the ink from muted to accent (and washes the search lens);
 *  - [press] winds the icon back while held and swings past rest on the springy release;
 *  - [flourish] runs 0→1 once per tap and rests at 1.
 */
internal class TabGlyph(context: Context, kind: String) : View(context) {
    private val icon = when (kind) { "home", "index" -> "tab-home"; "library" -> "tab-library"; "search", "tidal" -> "tab-search"; else -> "tab-playlists" }
    var muted = Color.WHITE
        set(value) { field = value; invalidate() }
    var accent = Color.WHITE
        set(value) { field = value; invalidate() }
    var selection = 0f
        set(value) { field = value; invalidate() }
    var press = 0f
        set(value) { field = value; invalidate() }
    var flourish = 1f
        set(value) { field = value; invalidate() }
    private val pen = CanvasPen()

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val s = selection.coerceIn(0f, 1f)
        pen.ink = ColorUtils.blendARGB(muted, accent, (s + .35f * max(press, 0f)).coerceIn(0f, 1f))
        pen.draw(canvas, icon, width.toFloat(), height.toFloat(), press, flourish, s)
    }
}

/** Beats of the tap flourish. Pure, so the rest-at-both-ends rule is unit tested on the JVM. */
internal object TabBeats {
    /** Local 0..1 progress of a beat that starts at [start] and lasts [duration] of the flourish. */
    fun seg(f: Float, start: Float, duration: Float) = ((f - start) / duration).coerceIn(0f, 1f)
    /** One arc up and back down; zero outside its beat. */
    fun hop(f: Float, start: Float, duration: Float): Float {
        val u = seg(f, start, duration)
        return if (u <= 0f || u >= 1f) 0f else sin(PI * u).toFloat()
    }
    /** A decaying one-and-a-half swing; zero outside its beat. */
    fun wobble(f: Float, start: Float, duration: Float): Float {
        val u = seg(f, start, duration)
        return if (u <= 0f || u >= 1f) 0f else (exp(-4.2 * u) * sin(2 * PI * 1.6 * u)).toFloat()
    }
}
