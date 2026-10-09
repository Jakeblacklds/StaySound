package expo.modules.tidaldetailview

import expo.modules.playerchrome.StayIconView
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import com.bumptech.glide.Glide
import com.facebook.react.common.assets.ReactFontManager

internal class TidalStyle(val context: Context) {
    var colors = emptyMap<String, String>()
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun color(key: String, fallback: Int) = runCatching { Color.parseColor(colors[key]) }.getOrDefault(fallback)
    val background get() = color("background", Color.BLACK)
    val ink get() = color("text", Color.WHITE)
    val subtle get() = color("subtle", Color.LTGRAY)
    val primary get() = color("primary", Color.CYAN)
    val secondary get() = color("secondary", primary)
    val surface get() = color("surface", Color.DKGRAY)
    val variant get() = color("surfaceVariant", surface)
    val outline get() = color("outline", subtle)
    val onPrimary get() = color("onPrimary", Color.BLACK)
    val dark get() = colors["dark"] != "false"
    val lightweight get() = colors["lightweight"] == "true"
    fun alpha(color: Int, alpha: Int) = ColorUtils.setAlphaComponent(color, alpha)
    fun shape(fill: Int, radius: Int = 16, border: Int? = null) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat()
        if (border != null) setStroke(dp(1).coerceAtLeast(1), border)
    }
    fun ripple(radius: Int = 16) = RippleDrawable(ColorStateList.valueOf(alpha(primary, 40)), null, shape(Color.WHITE, radius))
    fun text(value: String, size: Float, weight: Int = 500, color: Int = ink) = TextView(context).apply {
        text = value; textSize = size; includeFontPadding = false; setTextColor(color)
        typeface = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, context.assets)
        ellipsize = TextUtils.TruncateAt.END
    }
}

internal class TidalArtwork(private val style: TidalStyle, radius: Int, private val backdrop: Boolean = false) : FrameLayout(style.context) {
    private val image = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
    private var uri = ""
    init {
        background = style.shape(style.variant, radius); clipToOutline = radius > 0
        if (!backdrop) addView(TidalGlyph(style, "album"), LayoutParams(style.dp(40), style.dp(40), Gravity.CENTER))
        addView(image, LayoutParams(-1, -1))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        if (backdrop && android.os.Build.VERSION.SDK_INT >= 31) image.setRenderEffect(RenderEffect.createBlurEffect(60f, 60f, Shader.TileMode.CLAMP))
    }
    fun bind(value: String) {
        if (uri == value) return
        uri = value
        if (isAttachedToWindow && width > 0) load()
    }
    private fun load() {
        // Tiny backdrop decode produces a soft wash on older Android; never blur list rows.
        Glide.with(context.applicationContext).load(uri.ifEmpty { null })
            .override(if (backdrop) 24 else maxOf(width, height, style.dp(52)))
            .centerCrop().dontAnimate().into(image)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); if (isAttachedToWindow && w > 0) load() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (width > 0) load() }
    override fun onDetachedFromWindow() { Glide.with(context.applicationContext).clear(image); super.onDetachedFromWindow() }
}

/** Catalogue icon (StayIcons). Status marks sit inside pressable rows, so they stay still. */
internal class TidalGlyph(style: TidalStyle, kind: String, tint: Int = style.ink) : StayIconView(style.context, glyphName(kind)) {
    init { ink = tint; interactive = kind !in STATIC }
    private companion object {
        val STATIC = setOf("done", "error", "playing", "pause", "playlist", "album")
        fun glyphName(kind: String) = when (kind) { "more" -> "more-vertical"; "album" -> "disc"; else -> kind }
    }
}

/** Same 32 dp rising-fill download affordance as the RN row, with TS-owned progress. */
internal class TidalDownloadIndicator(private val style: TidalStyle) : FrameLayout(style.context) {
    private val fill = View(context)
    private val mark = FrameLayout(context)
    private var fraction = 0.0
    private var appearanceKey = ""
    init {
        clipToOutline = true
        addView(fill, LayoutParams(-1, -1)); addView(mark, LayoutParams(-1, -1))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    fun bind(status: String, progress: Double) {
        val nextKey = "$status:${style.primary}:${style.subtle}:${style.onPrimary}"
        if (appearanceKey != nextKey) {
            appearanceKey = nextKey
            background = style.shape(0x1A7F7F7F, 9, style.alpha(style.outline, 80))
            fill.setBackgroundColor(if (status == "error") style.color("error", Color.RED) else style.primary)
            fill.visibility = if (status == "idle") GONE else VISIBLE
            mark.removeAllViews()
            mark.addView(TidalGlyph(style, when (status) { "done" -> "done"; "error" -> "error"; else -> "download" }, if (status == "idle") style.subtle else style.onPrimary), LayoutParams(style.dp(21), style.dp(21), Gravity.CENTER))
        }
        fraction = when (status) { "done" -> 1.0; "error" -> .35; "downloading" -> progress.coerceIn(.08, .94); else -> 0.0 }
        fill.translationY = ((1 - fraction) * height).toFloat()
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); fill.translationY = ((1 - fraction) * h).toFloat() }
}
