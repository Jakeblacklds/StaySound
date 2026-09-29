package expo.modules.playerchrome

import android.animation.ValueAnimator
import android.os.Build
import android.view.View
import android.view.animation.PathInterpolator
import android.content.Context
import android.content.res.ColorStateList
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Native text, transport, pressed states and loading animation. Artwork belongs to the shared morph. */
class MiniPlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    internal var nativeAction: ((String) -> Unit)? = null
    private fun emit(action: String) { nativeAction?.invoke(action) ?: onAction(mapOf("action" to action)) }
    private val content = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
    private val title = context.chromeText(15f, 600).apply { letterSpacing = -0.15f / 15f }
    private val artist = context.chromeText(12.5f, 500).apply { alpha = 0.82f }
    private val metadata = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL }
    private val open = ChromeButton(context) {}
    private val previousGlyph = ChromeGlyph(context, "previous")
    private val nextGlyph = ChromeGlyph(context, "next")
    private val playGlyph = ChromeGlyph(context, "play")
    private val pill = FrameLayout(context)
    private val loadingIndicator = ProgressBar(context).apply { visibility = GONE }
    private var lightweight = false
    private val motionEnabled get() = !lightweight && (Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled())
    private val skipMotions = mutableListOf<ChromeMotion>()
    private val trackMotion = ChromeMotion(1f) { updateExpansion() }
    private val glyphMotion = ChromeMotion(1f) { updateExpansion() }
    private val pressMotion = ChromeMotion(0f) { updateExpansion() }
    private val previous = skip("previous", previousGlyph)
    private val play = ChromeButton(context) { held ->
        if (motionEnabled) pressMotion.curve(if (held) 1f else 0f, if (held) 100L else 240L, SETTLE)
        else pressMotion.snap(0f)
    }
    private val next = skip("next", nextGlyph)
    private var progress = 0f
    private var loading = false
    private var paused = true
    private var labels = emptyMap<String, String>()
    private var track = emptyMap<String, String>()
    /** +1 when the next title should arrive from the right (next/auto-advance), -1 for previous. */
    private var skipDirection = 1f
    private var trackShift = 0f
    private var swapping = false

    init {
        content.setPadding(px(10), 0, px(4), 0)
        addView(content, LayoutParams(-1, -1))
        metadata.addView(title, LinearLayout.LayoutParams(-1, -2))
        metadata.addView(artist, LinearLayout.LayoutParams(-1, -2).apply { topMargin = px(3) })
        // Reserve the same 48dp cover and 12dp gap as the expanding shared artwork.
        open.addView(metadata, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER_VERTICAL).apply {
            leftMargin = px(60); rightMargin = px(8)
        })
        open.setOnClickListener { emit("open") }
        content.addView(open, LinearLayout.LayoutParams(0, -1, 1f))
        content.addView(previous, LinearLayout.LayoutParams(px(48), px(48)))
        pill.addView(playGlyph, FrameLayout.LayoutParams(px(20), px(20), Gravity.CENTER))
        pill.addView(loadingIndicator, FrameLayout.LayoutParams(px(18), px(18), Gravity.CENTER))
        play.addView(pill, FrameLayout.LayoutParams(px(40), px(40), Gravity.CENTER))
        play.setOnClickListener { if (!loading) emit("toggle") }
        content.addView(play, LinearLayout.LayoutParams(px(48), px(48)))
        content.addView(next, LinearLayout.LayoutParams(px(48), px(48)))
        // Every transport control retains its own 48dp touch target.
        minimumHeight = px(48)
    }
    private fun skip(action: String, glyph: ChromeGlyph): ChromeButton {
        val motion = ChromeMotion(0f) { amount ->
            glyph.alpha = 1f - .18f * amount
            glyph.scaleX = 1f - .12f * amount; glyph.scaleY = glyph.scaleX
        }.also { skipMotions.add(it) }
        return ChromeButton(context) { held ->
            if (motionEnabled) motion.curve(if (held) 1f else 0f, if (held) 100L else 240L, SETTLE)
            else motion.snap(0f)
        }.apply {
            addView(glyph, FrameLayout.LayoutParams(px(22), px(22), Gravity.CENTER))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                skipDirection = if (action == "previous") -1f else 1f
                emit(action)
            }
        }
    }
    fun setTrack(value: Map<String, String>) {
        if (track == value) return
        val changed = track["id"] != value["id"] && !track["id"].isNullOrEmpty()
        track = value
        updateLabels()
        // Mid-swap, the pending swap simply picks up the newest title.
        if (swapping) return
        if (changed && progress < .18f && isAttachedToWindow && motionEnabled) {
            // The old title slips out against the skip, the new one glides in from the other side.
            val direction = skipDirection; skipDirection = 1f
            swapping = true; trackShift = -direction
            trackMotion.curve(0f, 120L, EXIT) {
                swapping = false; applyTrackText(); trackShift = direction
                trackMotion.curve(1f, 360L, SETTLE)
            }
        } else settleTrack()
    }
    private fun applyTrackText() { title.text = track["title"].orEmpty(); artist.text = track["artist"].orEmpty() }
    private fun settleTrack() { swapping = false; applyTrackText(); trackShift = 0f; trackMotion.snap(1f) }
    fun setLightweight(value: Boolean) {
        lightweight = value
        if (!motionEnabled) {
            settleTrack(); glyphMotion.snap(1f); pressMotion.snap(0f)
            skipMotions.forEach { it.snap(0f) }
        }
    }
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // At compact widths and large type, prioritise the title and primary controls.
        previous.visibility = if (View.MeasureSpec.getSize(widthMeasureSpec) >= dp(350f) &&
            resources.configuration.fontScale < 1.3f) VISIBLE else GONE
        artist.visibility = if (resources.configuration.fontScale >= 1.8f) GONE else VISIBLE
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }
    fun setLabels(value: Map<String, String>) { labels = value; updateLabels() }
    private fun updateLabels() {
        open.contentDescription = listOfNotNull(labels["open"], track["title"], track["artist"]).joinToString(", ")
        previous.contentDescription = labels["previous"]
        next.contentDescription = labels["next"]
        play.contentDescription = labels[if (loading) "loading" else if (paused) "play" else "pause"]
    }
    fun setAppearance(value: Map<String, String>) {
        if (value.containsKey("motion")) setLightweight(value["motion"] == "off")
        if (value.containsKey("playFill")) setColors(color(value["playInk"]), color(value["controlInk"]), color(value["playFill"]))
    }
    private val pillSurface = roundSurface(0, 0f)
    /** Called every frame while the album palette eases, so it only mutates existing paint. */
    fun setColors(playInk: Int, controlInk: Int, playFill: Int) {
        if (pill.background !== pillSurface) { pillSurface.cornerRadius = dp(20f); pill.background = pillSurface }
        pillSurface.setColor(playFill)
        if (playGlyph.ink != playInk) { playGlyph.ink = playInk; loadingIndicator.indeterminateTintList = ColorStateList.valueOf(playInk) }
        previousGlyph.ink = controlInk; nextGlyph.ink = controlInk
    }
    fun setTitleColor(value: Int) { title.setTextColor(value); artist.setTextColor(value) }
    fun setLoading(value: Boolean) {
        loading = value
        play.isEnabled = !value
        loadingIndicator.visibility = if (value) VISIBLE else GONE
        playGlyph.visibility = if (value) INVISIBLE else VISIBLE
        updateLabels()
    }
    fun setPaused(value: Boolean) {
        if (paused == value) return
        val changed = paused != value
        paused = value; playGlyph.kind = if (value) "play" else "pause"; playGlyph.invalidate(); updateLabels()
        if (changed && !loading && isAttachedToWindow && motionEnabled) {
            glyphMotion.snap(0f); glyphMotion.curve(1f, 180L, SETTLE)
        } else glyphMotion.snap(1f)
    }
    fun setExpansion(value: Float) { progress = value.coerceIn(0f, 1f); updateExpansion() }
    private fun updateExpansion() {
        val contentP = ChromeProgress.ramp(progress, 0f, 0.3f)
        content.alpha = ChromeProgress.contentAlpha(progress)
        content.scaleX = 1f - contentP * 0.015f; content.scaleY = content.scaleX
        content.translationY = -dp(2f) * contentP
        val controlsP = ChromeProgress.ramp(progress, 0f, 0.34f)
        metadata.alpha = ChromeProgress.controlsAlpha(progress) * trackMotion.value
        metadata.translationY = -dp(1f) * controlsP
        metadata.translationX = trackShift * dp(14f) * (1f - trackMotion.value)
        pill.alpha = ChromeProgress.controlsAlpha(progress)
        pill.translationY = -dp(1f) * controlsP
        playGlyph.alpha = .55f + .45f * glyphMotion.value
        playGlyph.scaleX = .88f + .12f * glyphMotion.value; playGlyph.scaleY = playGlyph.scaleX
        pill.scaleX = (1f - controlsP * 0.04f) * (1f - pressMotion.value * 0.06f)
        pill.scaleY = pill.scaleX
        importantForAccessibility = if (progress > 0.18f) IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else IMPORTANT_FOR_ACCESSIBILITY_AUTO
    }
    override fun onDetachedFromWindow() {
        settleTrack(); glyphMotion.snap(1f); pressMotion.snap(0f)
        skipMotions.forEach { it.snap(0f) }
        super.onDetachedFromWindow()
    }
    private companion object {
        val SETTLE = PathInterpolator(.16f, 1f, .3f, 1f)
        val EXIT = PathInterpolator(.3f, 0f, .8f, .15f)
    }
}
