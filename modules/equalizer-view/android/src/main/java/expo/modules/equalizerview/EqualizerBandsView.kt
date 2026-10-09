package expo.modules.equalizerview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import androidx.core.graphics.ColorUtils
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/** One equalizer band as drawn; [level] is in millibels. */
internal class EqBand(val index: Int, val hz: Double, val min: Float, val max: Float, var level: Float) {
    val label: String = if (hz >= 1000) String.format(Locale.US, "%.1fk", hz / 1000).replace(".0k", "k") else "${hz.roundToInt()}"
}

/**
 * The curve: a column per band, dragged vertically, joined by one smooth line. Drawn by hand
 * so a drag only repaints this view instead of rebuilding a list of sliders.
 */
internal class EqualizerBandsView(context: Context) : View(context) {
    var bands: List<EqBand> = emptyList()
        set(value) { field = value; invalidate() }
    var accent = 0xFFFFA31A.toInt()
    var ink = 0xFFFFFFFF.toInt()
    var muted = 0xFF9A9A9A.toInt()
    var typeface: Typeface? = null
    /** Called on every step of a drag, and once more with `done` when the finger lifts. */
    var onLevel: ((band: EqBand, done: Boolean) -> Unit)? = null
    /** The band under the finger; incoming snapshots must not move it. */
    var dragging = -1
        private set

    private val density = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val curve = Path()
    private val top get() = paddingTop + 34 * density
    private val bottom get() = height - paddingBottom - 30 * density
    private fun columnX(position: Int) = paddingLeft + (width - paddingLeft - paddingRight) * (position + 0.5f) / bands.size
    private fun levelY(band: EqBand) = bottom - (band.level - band.min) / (band.max - band.min) * (bottom - top)

    override fun onDraw(canvas: Canvas) {
        if (bands.isEmpty()) return
        text.typeface = typeface
        val middle = (top + bottom) / 2f
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = density
        paint.color = ColorUtils.setAlphaComponent(muted, 70)
        canvas.drawLine(paddingLeft.toFloat(), middle, (width - paddingRight).toFloat(), middle, paint)

        curve.reset()
        bands.forEachIndexed { position, band ->
            val x = columnX(position); val y = levelY(band)
            if (position == 0) curve.moveTo(x, y) else {
                val previousX = columnX(position - 1); val previousY = levelY(bands[position - 1])
                val bend = (x - previousX) / 2f
                curve.cubicTo(previousX + bend, previousY, x - bend, y, x, y)
            }
        }
        paint.strokeWidth = 2f * density
        paint.color = ColorUtils.setAlphaComponent(accent, 150)
        canvas.drawPath(curve, paint)

        bands.forEachIndexed { position, band ->
            val x = columnX(position); val y = levelY(band)
            val active = position == dragging
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2f * density
            paint.color = ColorUtils.setAlphaComponent(muted, 60)
            canvas.drawLine(x, top, x, bottom, paint)
            paint.strokeWidth = 4f * density
            paint.color = accent
            canvas.drawLine(x, middle, x, y, paint)
            paint.style = Paint.Style.FILL
            if (active) {
                paint.color = ColorUtils.setAlphaComponent(accent, 56)
                canvas.drawCircle(x, y, 20f * density, paint)
            }
            paint.color = accent
            canvas.drawCircle(x, y, (if (active) 11f else 9f) * density, paint)

            text.textSize = 12f * density
            text.color = if (active) accent else ink
            canvas.drawText(String.format(Locale.US, "%+.1f", band.level / 100f), x, top - 16f * density, text)
            text.color = muted
            canvas.drawText(band.label, x, bottom + 24f * density, text)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (bands.isEmpty() || !isEnabled) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                // The page scrolls vertically; a band drag must win that gesture.
                parent?.requestDisallowInterceptTouchEvent(true)
                val column = (width - paddingLeft - paddingRight).toFloat() / bands.size
                dragging = ((event.x - paddingLeft) / column).toInt().coerceIn(0, bands.size - 1)
                move(event.y, false)
            }
            MotionEvent.ACTION_MOVE -> if (dragging >= 0) move(event.y, false)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (dragging >= 0) {
                val band = bands[dragging]
                dragging = -1
                invalidate()
                onLevel?.invoke(band, true)
            }
        }
        return true
    }

    private fun move(y: Float, done: Boolean) {
        val band = bands[dragging]
        val fraction = ((bottom - y) / (bottom - top)).coerceIn(0f, 1f)
        // Half-decibel steps, with a small detent at zero so "flat" is easy to hit.
        var level = ((band.min + fraction * (band.max - band.min)) / 50f).roundToInt() * 50f
        if (abs(level) < 75f) level = 0f
        level = level.coerceIn(band.min, band.max)
        if (level == band.level && !done) { invalidate(); return }
        band.level = level
        invalidate()
        onLevel?.invoke(band, done)
    }
}
