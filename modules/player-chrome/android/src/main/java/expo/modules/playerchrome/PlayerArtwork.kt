package expo.modules.playerchrome

import android.content.Context
import android.graphics.*
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.graphics.drawable.Drawable
import android.view.animation.PathInterpolator
import android.widget.ImageView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import jp.wasabeef.glide.transformations.BlurTransformation

internal class PlayerArtwork(context: Context) : FrameLayout(context) {
    // Two layers so a new cover can dissolve over the old one once it has actually decoded.
    private val layers = Array(2) { ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP } }
    private var front = 0
    private var generation = 0
    private var swapping = false
    /** The layer that should spin: the incoming cover as soon as a swap starts. */
    val image: ImageView get() = layers[front]
    private val rings = DiscRings(context)
    private var uri = ""
    var discAmount = 0f
        set(value) { if (field == value) return; field = value; rings.alpha = value; invalidateOutline() }
    init {
        clipToOutline = true
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                val radius = dp(10f) + (width / 2f - dp(10f)) * discAmount.coerceIn(0f, 1f)
                outline.setRoundRect(0, 0, width, height, radius)
            }
        }
        layers.forEach { addView(it, LayoutParams(-1, -1)) }
        addView(rings, LayoutParams(-1, -1)); rings.alpha = 0f; rings.z = 2f
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    /** [animate] dissolves the new cover in with a small settle instead of swapping it in place. */
    fun load(value: String, animate: Boolean = false) {
        if (uri == value) return
        val hadCover = uri.isNotEmpty() && image.drawable != null
        uri = value
        finishSwap()
        if (!animate || !hadCover || !isAttachedToWindow) { image.rotation = 0f; loadInto(image, null); return }
        val outgoing = layers[front]
        front = 1 - front
        val incoming = layers[front]
        val token = ++generation
        swapping = true
        incoming.animate().cancel()
        incoming.alpha = 0f; incoming.rotation = 0f; incoming.scaleX = 1.08f; incoming.scaleY = 1.08f
        incoming.z = 1f; outgoing.z = 0f
        loadInto(incoming) {
            if (token != generation) return@loadInto
            outgoing.animate().scaleX(.96f).scaleY(.96f).setDuration(420).setInterpolator(SETTLE).start()
            incoming.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(420).setInterpolator(SETTLE)
                .withEndAction { if (token == generation) finishSwap() }.start()
        }
    }
    private fun finishSwap() {
        if (!swapping) return
        swapping = false; generation++
        val back = layers[1 - front]
        back.animate().cancel(); Glide.with(context).clear(back)
        back.scaleX = 1f; back.scaleY = 1f; back.alpha = 1f; back.z = 0f
        image.animate().cancel(); image.alpha = 1f; image.scaleX = 1f; image.scaleY = 1f; image.z = 1f
    }
    private fun loadInto(target: ImageView, ready: (() -> Unit)?) {
        var request = Glide.with(context).load(uri.ifEmpty { null })
            .override(resources.displayMetrics.widthPixels, resources.displayMetrics.widthPixels).centerCrop().dontAnimate()
        if (ready != null) request = request.listener(object : RequestListener<Drawable> {
            override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>, isFirstResource: Boolean): Boolean {
                post(ready); return false
            }
            override fun onResourceReady(resource: Drawable, model: Any, target: Target<Drawable>?, dataSource: DataSource, isFirstResource: Boolean): Boolean {
                post(ready); return false
            }
        })
        request.into(target)
    }
    fun lyricsStyle(surface: Int) { discAmount = 1f; rings.lyrics=true; rings.hole=surface; rings.invalidate() }
    fun colors(accent: Int, ink: Int) { rings.accent = accent; rings.ink = ink; rings.invalidate() }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); invalidateOutline() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (uri.isNotEmpty()) loadInto(image, null) }
    override fun onDetachedFromWindow() { finishSwap(); layers.forEach { Glide.with(context).clear(it) }; super.onDetachedFromWindow() }
    private companion object { val SETTLE = PathInterpolator(.16f, 1f, .3f, 1f) }
}
private class DiscRings(context: Context) : View(context) {
    var lyrics=false
    var hole=Color.BLACK
    var accent = Color.WHITE
    var ink = Color.WHITE
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private fun ring(canvas: Canvas, fraction: Float, stroke: Float, color: Int) {
        paint.style = Paint.Style.STROKE; paint.strokeWidth = dp(stroke); paint.color = color
        canvas.drawCircle(width / 2f, height / 2f, width * fraction / 2f - paint.strokeWidth / 2, paint)
    }
    override fun onDraw(canvas: Canvas) {
        if(lyrics) {
            ring(canvas,94f/96,2f,alphaColor(Color.WHITE,.42f*.9f))
            ring(canvas,88f/96,1f,alphaColor(Color.BLACK,.34f*.72f))
            ring(canvas,66f/96,1f,alphaColor(ink,.26f*.74f))
            ring(canvas,34f/96,1.6f,alphaColor(ink,.52f*.86f))
            paint.style=Paint.Style.FILL;paint.color=hole
            canvas.drawCircle(width/2f,height/2f,width*9f/96,paint)
            ring(canvas,18f/96,1.2f,alphaColor(ink,.48f))
            return
        }
        ring(canvas, 0.976f, 2.4f, alphaColor(accent, 0.62f * 0.9f))
        ring(canvas, 0.932f, 1.2f, alphaColor(Color.BLACK, 0.34f * 0.72f))
        ring(canvas, 0.72f, 1.2f, alphaColor(ink, 0.18f * 0.74f))
        ring(canvas, 0.29f, 2f, alphaColor(ink, 0.42f * 0.86f))
        paint.style = Paint.Style.FILL; paint.color = alphaColor(accent, 0.34f)
        canvas.drawCircle(width / 2f, height / 2f, width * 0.07f, paint)
        ring(canvas, 0.14f, 1.4f, alphaColor(ink, 0.48f))
    }
}

internal class PlayerBackdrop(context: Context) : FrameLayout(context) {
    private val artwork = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP; scaleX = 1.86f; scaleY = 1.86f }
    private val wash = View(context)
    private val fog = ColorFog(context)
    private var dark = true
    private var uri = ""
    init {
        clipChildren = true
        addView(fog, LayoutParams(-1, -1)); addView(artwork, LayoutParams(-1, -1)); addView(wash, LayoutParams(-1, -1))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        wash.setBackgroundColor(alphaColor(Color.BLACK, 0.57f)) // 50% cover wash + 14% fog scrim.
    }
    fun load(value: String, lite: Boolean) {
        artwork.scaleX = if (lite) 1.84f else 1.86f; artwork.scaleY = artwork.scaleX
        artwork.translationX = if (lite) 0f else dp(4f); artwork.translationY = if (lite) 0f else -dp(2f)
        fog.lite = lite
        if (uri == value) return
        uri = value; fog.visibility = if(value.isEmpty()) VISIBLE else GONE
        setDark(dark); loadImage()
    }
    fun colors(primary: Int, secondary: Int) { fog.primary=primary; fog.secondary=secondary; fog.invalidate() }
    fun setDark(dark: Boolean) {
        this.dark=dark; fog.dark=dark; fog.invalidate()
        wash.setBackgroundColor(if(dark) alphaColor(Color.BLACK,if(uri.isEmpty()) .14f else .57f) else alphaColor(Color.WHITE,if(uri.isEmpty()) .08f else .4848f))
    }
    private fun loadImage() {
        // Identical to Expo Image's blurRadius=72: radius is capped to 25, sampling=4.
        Glide.with(context).load(uri.ifEmpty { null }).transform(BlurTransformation(25, 4))
            .transition(DrawableTransitionOptions.withCrossFade(1400)).into(artwork)
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (uri.isNotEmpty()) loadImage() }
    override fun onDetachedFromWindow() { Glide.with(context).clear(artwork); super.onDetachedFromWindow() }
}

private class ColorFog(context: Context): View(context) {
    var primary=Color.TRANSPARENT; var secondary=Color.TRANSPARENT; var dark=true; var lite=false
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private val path=Path()
    override fun onDraw(canvas: Canvas) {
        fun blob(rect:RectF, radii:FloatArray, color:Int, opacity:Float, x:Float,y:Float,scale:Float) {
            canvas.save(); canvas.translate(dp(x),dp(y));canvas.scale(scale,scale,rect.centerX(),rect.centerY())
            path.reset();path.addRoundRect(rect,radii,Path.Direction.CW);paint.color=alphaColor(color,opacity);canvas.drawPath(path,paint);canvas.restore()
        }
        blob(RectF(-width*.2f,-height*.1f,width*.8f,height*.6f),floatArrayOf(0f,0f,0f,0f,dp(999f),dp(999f),dp(400f),dp(400f)),primary,if(dark) .4f else .45f,if(lite)-4f else -8f,if(lite)4f else 8f,if(lite)1.02f else 1.04f)
        blob(RectF(width*.3f,height*.45f,width*1.2f,height*1.1f),floatArrayOf(dp(999f),dp(999f),dp(400f),dp(400f),0f,0f,0f,0f),secondary,if(dark).3f else .32f,if(lite)4f else 10f,if(lite)-4f else -8f,if(lite)1.01f else 1.03f)
    }
}
