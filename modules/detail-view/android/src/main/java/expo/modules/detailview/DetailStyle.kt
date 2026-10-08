package expo.modules.detailview

import expo.modules.playerchrome.StayIconView
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

/** Catalogue icon (StayIcons); "album" is the disc. */
internal class DetailGlyph(style: DetailStyle, kind: String) : StayIconView(style.context, glyphName(kind)) {
    var kind = kind
        set(value) { field = value; name = glyphName(value); interactive = value !in PLACEHOLDERS }
    var tint by this::ink
    init { ink = style.ink; interactive = kind !in PLACEHOLDERS }
    private companion object {
        val PLACEHOLDERS = setOf("album", "artist")
        fun glyphName(kind: String) = if (kind == "album") "disc" else kind
    }
}
