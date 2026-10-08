package expo.modules.homeview

import expo.modules.playerchrome.StayIconView
import android.animation.ValueAnimator
import android.os.Build
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.PathParser
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import com.facebook.react.common.assets.ReactFontManager

/** The existing Home's type and shape tokens, in sp/dp rather than pixels. */
internal class HomeStyle(val context: Context) {
    var lightweight = false
    val motionEnabled get() = !lightweight && (Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled())
    var colors = emptyMap<String, String>()
    var labels = emptyMap<String, String>()
    fun dp(value: Float) = (value * context.resources.displayMetrics.density).toInt()
    fun dp(value: Int) = dp(value.toFloat())
    fun label(key: String) = labels[key].orEmpty()
    fun color(key: String, fallback: Int = Color.TRANSPARENT): Int =
        runCatching { Color.parseColor(colors[key]) }.getOrDefault(fallback)
    val primary get() = color("primary", Color.WHITE)
    val ink get() = color("onSurface", Color.WHITE)
    val secondary get() = color("onSurfaceVariant", Color.LTGRAY)
    val surface get() = color("surfaceVariant", Color.DKGRAY)
    val background get() = color("background", Color.BLACK)
    val panel get() = ColorUtils.blendARGB(background, surface, .55f)
    // Playback artwork supplies the accent; choose the matching readable play glyph.
    val onAccent: Int get() {
        val opaque = ColorUtils.setAlphaComponent(primary, 255)
        return if (ColorUtils.calculateContrast(Color.WHITE, opaque) >= ColorUtils.calculateContrast(Color.BLACK, opaque)) Color.WHITE else Color.BLACK
    }
    fun text(size: Float, weight: Int = 500) = TextView(context).apply {
        textSize = size
        includeFontPadding = false
        typeface = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, context.assets)
        setTextColor(ink)
        ellipsize = TextUtils.TruncateAt.END
    }
    fun shape(fill: Int, radius: Int) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat()
    }
    fun ripple(radius: Int = 12) = RippleDrawable(
        ColorStateList.valueOf(ColorUtils.setAlphaComponent(primary, 36)), null, shape(Color.WHITE, radius))
}

internal class HomeArtwork(private val style: HomeStyle, private val circle: Boolean) : FrameLayout(style.context) {
    private val image = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
    private val fallback = HomeGlyph(style, false)
    private val ring = object : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.style = Paint.Style.STROKE }
        override fun onDraw(canvas: Canvas) {
            if (hero) {
                paint.color = ColorUtils.setAlphaComponent(style.ink, 36)
                paint.strokeWidth = 1f
                canvas.drawCircle(width / 2f, height / 2f, width / 2f - paint.strokeWidth / 2, paint)
            } else if (circle) {
                paint.color = ColorUtils.setAlphaComponent(style.ink, 45); paint.strokeWidth = 1f
                canvas.drawCircle(width / 2f, height / 2f, width / 2f - .5f, paint)
            }
        }
    }
    var hero = false
    private var primaryUri = ""
    private var fallbackUri = ""
    private var imageSize = 0
    init {
        clipToOutline = true
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                if (circle) outline.setOval(0, 0, width, height)
                else outline.setRoundRect(0, 0, width, height, style.dp(16).toFloat())
            }
        }
        addView(fallback, LayoutParams(style.dp(36), style.dp(36), android.view.Gravity.CENTER))
        addView(image, LayoutParams(-1, -1))
        addView(ring, LayoutParams(-1, -1))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    fun bind(item: HomeItem, size: Int, large: Boolean = false) {
        hero = large
        val first = item.displayArtwork
        val second = item.fallbackThumbnail
        if (primaryUri != first || fallbackUri != second || imageSize != size) {
            primaryUri = first; fallbackUri = second; imageSize = size
            if (isAttachedToWindow) load()
        }
        paint()
    }
    fun paint() { setBackgroundColor(style.surface); fallback.tint = style.secondary; ring.invalidate() }
    private fun load() {
        val glide = Glide.with(context.applicationContext)
        val placeholder = android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)
        val request = glide.load(primaryUri.ifEmpty { null }).override(imageSize.coerceAtLeast(1))
            .centerCrop().placeholder(placeholder)
        if (style.motionEnabled) request.transition(DrawableTransitionOptions.withCrossFade(180))
        else request.dontAnimate()
        if (fallbackUri.isNotEmpty() && fallbackUri != primaryUri) {
            request.error(glide.load(fallbackUri).override(imageSize.coerceAtLeast(1)).centerCrop().dontAnimate())
        }
        request.into(image)
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); load() }
    override fun onDetachedFromWindow() { Glide.with(context.applicationContext).clear(image); super.onDetachedFromWindow() }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); invalidateOutline() }
}

/** Same filled Play silhouette as the app's SVG. Disc fallback stays vector-native. */
/** Catalogue icon (StayIcons): the play wedge, or the disc used as an artwork fallback. */
internal class HomeGlyph(style: HomeStyle, play: Boolean) : StayIconView(style.context, if (play) "play" else "disc") {
    var tint by this::ink
    init { ink = style.ink; interactive = play }
}
