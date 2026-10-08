package expo.modules.playerchrome

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.view.View

/**
 * A transport control drawn from the StaySound catalogue ([StayIcons]): play→pause is one
 * glyph ("play-pause") whose [morph] (0 play, 1 pause) is spring-driven and may overshoot.
 * [press] winds back and springs past rest, [flourish] runs 0→1 per tap and rests at 1.
 */
internal class TransportGlyph(context: Context, kind: String) : View(context) {
    var kind = kind
        set(value) { field = value; invalidate() }
    var ink = Color.WHITE
        set(value) { field = value; invalidate() }
    var press = 0f
        set(value) { field = value; invalidate() }
    var flourish = 1f
        set(value) { field = value; invalidate() }
    var morph = 0f
        set(value) { field = value; invalidate() }
    private val pen = CanvasPen()

    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val icon = when (kind) {
            "play", "pause" -> "play-pause"
            else -> StayIcons.resolve(kind) ?: return
        }
        pen.ink = ink
        pen.draw(canvas, icon, width.toFloat(), height.toFloat(), press, flourish, if (icon == "play-pause") morph else 0f)
    }

    companion object {
        val KINDS = setOf("play", "pause", "next", "skip-next", "previous", "skip-previous", "shuffle", "repeat", "repeat-one", "repeat-once")
    }
}
