package expo.modules.detailview

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import com.bumptech.glide.Glide
import com.facebook.react.common.assets.ReactFontManager

internal class DetailStyle(val context: Context) {
    var colors = emptyMap<String, String>()
    var labels = emptyMap<String, String>()
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun label(key: String) = labels[key].orEmpty()
    fun color(key: String, fallback: Int) = runCatching { Color.parseColor(colors[key]) }.getOrDefault(fallback)
    val background get() = color("background", Color.BLACK)
    val ink get() = color("text", Color.WHITE)
    val subtle get() = ColorUtils.setAlphaComponent(ink, 170)
    val primary get() = color("primary", Color.LTGRAY)
    val surface get() = color("surface", Color.DKGRAY)
    val onPrimary get() = color("onPrimary", Color.BLACK)
    val lightweight get() = colors["lightweight"] == "true"
    fun shape(fill: Int, radius: Int) = GradientDrawable().apply { setColor(fill); cornerRadius = dp(radius).toFloat() }
    fun ripple(radius: Int = 16) = RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(primary, 40)), null, shape(Color.WHITE, radius))
    fun text(size: Float, weight: Int = 500) = TextView(context).apply {
        textSize = size; includeFontPadding = false; setTextColor(ink)
        typeface = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, context.assets)
        ellipsize = TextUtils.TruncateAt.END
    }
}

internal class DetailArtwork(private val style: DetailStyle, private val radius: Int) : FrameLayout(style.context) {
    private val fallback = DetailGlyph(style, "album")
    private val image = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
    private var first = ""
    private var second = ""
    init {
        background = style.shape(style.surface, radius); clipToOutline = true
        addView(fallback, LayoutParams(style.dp(48), style.dp(48), android.view.Gravity.CENTER))
        addView(image, LayoutParams(-1, -1))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    fun bind(artwork: String, thumbnail: String = "", artist: Boolean = false) {
        first = artwork.ifEmpty { thumbnail }; second = thumbnail
        background = style.shape(style.surface, if (artist) 32 else radius)
        fallback.kind = if (artist) "artist" else "album"
        fallback.tint = style.subtle
        if (isAttachedToWindow && width > 0) load()
    }
    private fun load() {
        val glide = Glide.with(context.applicationContext)
        val size = maxOf(width, height, style.dp(48))
        val request = glide.load(first.ifEmpty { null }).override(size).centerCrop().dontAnimate()
            .placeholder(ColorDrawable(Color.TRANSPARENT))
        if (second.isNotEmpty() && second != first) request.error(glide.load(second).override(size).centerCrop())
        request.into(image)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (isAttachedToWindow && w > 0 && h > 0) load()
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (width > 0) load() }
    override fun onDetachedFromWindow() { Glide.with(context.applicationContext).clear(image); super.onDetachedFromWindow() }
}

internal class DetailGlyph(style: DetailStyle, var kind: String) : View(style.context) {
    var tint = style.ink
        set(value) { field = value; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(canvas: Canvas) {
        canvas.save(); canvas.scale(width / 24f, height / 24f)
        paint.color = tint; paint.strokeWidth = 1.8f; paint.strokeCap = Paint.Cap.ROUND
        paint.style = Paint.Style.STROKE
        when (kind) {
            "back" -> { canvas.drawLine(15f, 5f, 8f, 12f, paint); canvas.drawLine(8f, 12f, 15f, 19f, paint) }
            "queue" -> {
                for (y in listOf(6f, 11f, 16f)) canvas.drawLine(3f, y, 13f, y, paint)
                canvas.drawLine(18f, 12f, 18f, 20f, paint); canvas.drawLine(14f, 16f, 22f, 16f, paint)
            }
            "play" -> { paint.style = Paint.Style.FILL; canvas.drawPath(Path().apply { moveTo(7f, 4f); lineTo(20f, 12f); lineTo(7f, 20f); close() }, paint) }
            "artist" -> {
                canvas.drawCircle(12f, 7f, 4f, paint)
                canvas.drawArc(4f, 13f, 20f, 29f, 180f, 180f, false, paint)
            }
            else -> { canvas.drawCircle(12f, 12f, 9f, paint); canvas.drawCircle(12f, 12f, 3f, paint) }
        }
        canvas.restore()
    }
}
