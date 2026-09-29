package expo.modules.playerchrome

import android.content.Context
import android.graphics.*
import android.view.View
import androidx.core.graphics.PathParser

/** The same authored paths as TabBarIcons / MiniPlayerShell. No SVG tree per icon. */
internal class ChromeGlyph(context: Context, var kind: String) : View(context) {
    var ink = Color.WHITE
        set(value) { field = value; invalidate() }
    var wash = 0f
        set(value) { field = value; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val rect = RectF()
    private fun line(canvas: Canvas, path: Path, opacity: Float = 1f, stroke: Float = 1.85f) {
        paint.color = ink; paint.alpha = (Color.alpha(ink) * opacity).toInt()
        paint.style = Paint.Style.STROKE; paint.strokeWidth = stroke
        canvas.drawPath(path, paint)
    }
    private fun fill(canvas: Canvas, path: Path, opacity: Float = 1f) {
        paint.color = ink; paint.alpha = (Color.alpha(ink) * opacity).toInt()
        paint.style = Paint.Style.FILL
        canvas.drawPath(path, paint)
    }
    private fun circle(canvas: Canvas, x: Float, y: Float, radius: Float, dot: Boolean = false) {
        paint.color = ink; paint.style = Paint.Style.FILL
        paint.alpha = (Color.alpha(ink) * if (dot) 1f else wash * 0.22f).toInt()
        canvas.drawCircle(x, y, radius, paint)
        if (!dot) {
            paint.alpha = Color.alpha(ink); paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.85f
            canvas.drawCircle(x, y, radius, paint)
        }
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.save()
        if (kind == "play" || kind == "pause") {
            val sourceWidth = if (kind == "play") 224f else 148f
            val scale = minOf(width / sourceWidth, height / 215f)
            canvas.translate((width - sourceWidth * scale) / 2, (height - 215 * scale) / 2)
            canvas.scale(scale, scale)
            if (kind == "play") { fill(canvas, playOuter); fill(canvas, playInner, 0.61f) }
            else { fill(canvas, pauseRight, 0.96f); fill(canvas, pauseLeft, 0.38f) }
        } else {
            canvas.scale(width / 24f, height / 24f)
            when (kind) {
                "home", "index" -> { fill(canvas, home, wash * 0.22f); line(canvas, home); line(canvas, door) }
                "library" -> {
                    for (i in 0..2) {
                        val x = if (i == 1) 13f else 3.6f
                        val y = if (i == 2) 13f else 3.6f
                        rect.set(x, y, x + 7.4f, y + 7.4f)
                        paint.color = ink; paint.style = Paint.Style.FILL; paint.alpha = (255 * wash * 0.22f).toInt()
                        canvas.drawRoundRect(rect, 2.2f, 2.2f, paint)
                        paint.alpha = 255; paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.85f
                        canvas.drawRoundRect(rect, 2.2f, 2.2f, paint)
                    }
                    circle(canvas, 16.7f, 16.7f, 3.7f); circle(canvas, 16.7f, 16.7f, 1f, true)
                }
                "search", "tidal" -> { circle(canvas, 10.7f, 10.7f, 6.5f); line(canvas, search, stroke = 2.1f) }
                "playlists" -> { line(canvas, playlist); circle(canvas, 16.7f, 16f, 2.1f) }
                "previous", "next" -> {
                    if (kind == "previous") { canvas.translate(24f, 0f); canvas.scale(-1f, 1f) }
                    fill(canvas, trailing, 0.45f); line(canvas, trailing, 0.45f, 2.1f)
                    fill(canvas, leading); line(canvas, leading, stroke = 2.1f)
                }
            }
        }
        canvas.restore()
    }
    companion object {
        private fun path(data: String) = PathParser.createPathFromPathData(data)!!
        private val home = path("M4 10.5 12 4.3l8 6.2v8.4A2.1 2.1 0 0 1 17.9 21H6.1A2.1 2.1 0 0 1 4 18.9Z")
        private val door = path("M9.7 21v-4.7a2.3 2.3 0 0 1 4.6 0V21")
        private val search = path("M15.6 15.6 20.4 20.4")
        private val playlist = path("M4 7.2h11.4 M4 12h8.2 M4 16.8h6.4 M18.8 6.5q2.6.8 2.6 3 M18.8 6.5v9.5")
        private val leading = path("M12 7 19 12 12 17Z")
        private val trailing = path("M4.6 7 11.6 12 4.6 17Z")
        private val pauseRight = path("M95.518 164.687c.152-120.777-.034-120.754.069-131.718.198-21.27 38.605-33.499 38.375 6.618-.085 14.794.004 124.126-.076 126.75-.812 26.531-37.157 31.281-38.368-1.65")
        private val pauseLeft = path("M50.249 31.406c.04 11.053.476 133.203-.024 138.158-2.317 22.949-37.812 26.749-38.152-4.873C10.61 28.433 9.962 26.194 18.24 18.781c1.866-1.671 25.213-16.954 32.009 12.625")
        private val playOuter = path("M171.305 118.873c-9.445 8.201-14.814 14.094-86.253 58.175-18.123 11.183-39.022 21.23-39.95-11.035-.587-20.404-1.124-126.736-.338-133.094 4.291-34.686 24.394-19.638 79.494 14.577 57.752 35.862 57.865 44.237 56.429 55.086-.88 6.651-8.404 15.182-9.382 16.291")
        private val playInner = path("M156.707 112.975c-7.585 6.585-11.896 11.318-69.265 46.717-14.554 8.98-31.336 17.048-32.082-8.862-.472-16.386-.903-101.774-.271-106.88 3.446-27.854 19.589-15.77 63.837 11.706 46.377 28.799 46.468 35.524 45.315 44.236-.707 5.341-6.749 12.192-7.534 13.083")
    }
}
