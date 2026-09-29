package expo.modules.playerchrome

import android.content.Context
import android.graphics.*
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.core.graphics.ColorUtils
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** One native surface, a travelling selection indicator and interruptible native press feedback. */
class NavigationBarView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    var nativeAction: ((String) -> Unit)? = null
    private val row = LinearLayout(context)
    private val surface = DockSurface(context)
    private val tabs = linkedMapOf<String, NativeTab>()
    private var items = emptyList<Map<String, String>>()
    private var activeKey = ""
    private var appearance = emptyMap<String, String>()
    private var motionEnabled = true

    init {
        clipChildren = false; clipToPadding = false
        val frame = FrameLayout(context).apply { clipChildren = false; clipToPadding = false }
        addView(frame, LayoutParams(-1, -1))
        frame.addView(surface, FrameLayout.LayoutParams(-1, -1))
        row.setPadding(px(8), 0, px(8), 0)
        row.clipChildren = false; row.clipToPadding = false
        frame.addView(row, FrameLayout.LayoutParams(-1, -1))
    }
    fun setItems(value: List<Map<String, String>>) {
        if (items == value) return
        items = value
        tabs.values.forEach { it.dispose() }; tabs.clear(); row.removeAllViews()
        surface.resetIndicator()
        value.forEach { item ->
            val key = item["key"] ?: return@forEach
            val tab = NativeTab(context, item["name"].orEmpty(), item["label"].orEmpty())
            tab.button.setOnClickListener {
                it.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                // Navigation owns selection. Do not optimistically select a prevented tabPress.
                nativeAction?.invoke(key) ?: onAction(mapOf("action" to "press", "key" to key))
            }
            tab.button.setOnLongClickListener {
                if (nativeAction == null) onAction(mapOf("action" to "longPress", "key" to key)); true
            }
            tabs[key] = tab
            row.addView(tab.button, LinearLayout.LayoutParams(0, -1, 1f))
            tab.motionEnabled = motionEnabled
            tab.setColors(color(appearance["muted"]), color(appearance["accent"]))
            tab.select(key == activeKey, false)
        }
        row.post { if (isAttachedToWindow) moveIndicator(false) }
    }
    fun setActiveKey(value: String) {
        if (activeKey == value) return
        val hadSelection = activeKey.isNotEmpty()
        activeKey = value
        tabs.forEach { (key, tab) -> tab.select(key == value, hadSelection) }
        moveIndicator(hadSelection)
    }
    fun setAppearance(value: Map<String, String>) {
        appearance = value
        val motionChanged = motionEnabled != (value["motion"] != "off")
        motionEnabled = value["motion"] != "off"
        surface.accent = color(value["accent"])
        tabs.values.forEach {
            it.motionEnabled = motionEnabled
            it.setColors(color(value["muted"]), color(value["accent"]))
            if (!motionEnabled) it.select(it.button.isSelected, false)
        }
        // Palette tweens call this every frame; only re-seat the indicator when motion changes.
        if (motionChanged) moveIndicator(false)
    }
    fun setSurfaceColor(value: Int) { surface.ink = value }
    fun setShadeOpacity(value: Float) { surface.shadeOpacity = value }
    fun setDark(value: Boolean) { surface.dark = value }
    private fun moveIndicator(animate: Boolean) {
        val tab = tabs[activeKey] ?: run { surface.resetIndicator(); return }
        if (tab.button.width == 0) return
        surface.select(row.left + tab.button.left + tab.button.width / 2f,
            tab.indicatorCenterY(), animate && motionEnabled)
    }
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (changed) moveIndicator(false)
    }
    override fun onDetachedFromWindow() { surface.stop(); tabs.values.forEach { it.dispose() }; super.onDetachedFromWindow() }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        tabs.forEach { (key, tab) -> tab.select(key == activeKey, false) }
    }
}

private class DockSurface(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bounds = RectF()
    private val indicatorBounds = RectF()
    private val indicator = ChromeMotion(0f) { invalidate() }
    private var indicatorY = 0f
    private var indicatorReady = false
    var accent = Color.WHITE
        set(value) { field = value; invalidate() }
    fun select(center: Float, y: Float, animate: Boolean) {
        indicatorY = y
        if (animate && indicatorReady) indicator.curve(center, 320L, PathInterpolator(.16f, 1f, .3f, 1f))
        else indicator.snap(center)
        indicatorReady = true
        invalidate()
    }
    fun resetIndicator() { indicatorReady = false; indicator.cancel(); invalidate() }
    fun stop() { indicator.cancel() }
    private var shade: Shader? = null
    var ink = Color.TRANSPARENT
        set(value) { field = value; invalidate() }
    var shadeOpacity = 1f
        set(value) { field = value; invalidate() }
    var dark = true
        set(value) { field = value; updateShade(); invalidate() }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        bounds.set(0f, 0f, w.toFloat(), h.toFloat()); updateShade()
    }
    private fun updateShade() {
        if (height <= 0) return
        shade = LinearGradient(0f, height * 0.25f, 0f, height.toFloat(),
            Color.TRANSPARENT, if (dark) 0x0F000000 else 0x08000000, Shader.TileMode.CLAMP)
    }
    override fun onDraw(canvas: Canvas) {
        paint.shader = null; paint.color = ink
        canvas.drawRoundRect(bounds, dp(24f), dp(24f), paint)
        paint.shader = shade; paint.alpha = (255 * shadeOpacity.coerceIn(0f, 1f)).toInt()
        canvas.drawRoundRect(bounds, dp(24f), dp(24f), paint)
        paint.shader = null
        if (indicatorReady) {
            paint.color = ColorUtils.setAlphaComponent(accent, if (dark) 38 else 26)
            indicatorBounds.set(indicator.value - dp(27f), indicatorY - dp(16f),
                indicator.value + dp(27f), indicatorY + dp(16f))
            canvas.drawRoundRect(indicatorBounds, dp(16f), dp(16f), paint)
        }
    }
}

private class NativeTab(context: Context, name: String, label: String) {
    private val icon = FrameLayout(context).apply { clipChildren = false; clipToPadding = false }
    private val inactive = ChromeGlyph(context, name)
    private val active = ChromeGlyph(context, name).apply { wash = 1f }
    private val text = context.chromeText(12f, 600).apply {
        this.text = label; gravity = Gravity.CENTER; letterSpacing = 0f
    }
    private var muted = Color.WHITE
    private var accent = Color.WHITE
    private val selected = ChromeMotion(0f) { update() }
    var motionEnabled = true
    private val press = ChromeMotion(0f) { update() }
    val button = ChromeButton(context) { held ->
        if (!motionEnabled) press.snap(0f)
        else press.curve(if (held) 1f else 0f, if (held) 100L else 240L, PathInterpolator(.2f, 0f, 0f, 1f))
    }.apply { tab = true; contentDescription = label; clipChildren = false; clipToPadding = false }
    init {
        val stack = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false; clipToPadding = false
        }
        // Keep label baselines fixed while the shared selection surface travels beneath the icons.
        button.addView(stack, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        stack.addView(icon, LinearLayout.LayoutParams(button.px(26), button.px(26)))
        icon.addView(inactive, FrameLayout.LayoutParams(-1, -1))
        icon.addView(active, FrameLayout.LayoutParams(-1, -1))
        stack.addView(text, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = button.px(4); leftMargin = button.px(2); rightMargin = button.px(2)
        })
        update()
    }
    fun setColors(muted: Int, accent: Int) {
        this.muted = muted; this.accent = accent
        inactive.ink = muted; active.ink = accent; update()
    }
    fun select(value: Boolean, animate: Boolean) {
        button.isSelected = value
        val target = if (value) 1f else 0f
        if (!animate || !motionEnabled) { selected.snap(target); press.snap(0f); return }
        selected.curve(target, 240L, PathInterpolator(.2f, 0f, 0f, 1f))
    }
    private fun update() {
        val s = selected.value; val p = press.value
        icon.translationY = -button.dp(.5f) * s
        icon.scaleX = 1f - p * .08f; icon.scaleY = icon.scaleX
        active.alpha = s.coerceIn(0f, 1f); inactive.alpha = (1f - s).coerceIn(0f, 1f)
        text.setTextColor(ColorUtils.blendARGB(muted, accent, s.coerceIn(0f, 1f)))
        text.alpha = 1f
    }
    fun indicatorCenterY() = (icon.parent as View).top + icon.top + icon.height / 2f
    fun dispose() { selected.cancel(); press.snap(0f) }
}

