package expo.modules.androidshell

import expo.modules.playerchrome.stayIcon
import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import android.content.res.ColorStateList
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.playerchrome.AppearanceTween
import expo.modules.playerchrome.NavigationBarView
import expo.modules.playerchrome.FullPlayerView

/** Android owns visibility, tab selection, Back and saved state; children only bind service data. */
class NavigationHostView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onState by EventDispatcher()
    val content = FrameLayout(context)
    private val stage = FrameLayout(context)
    private val bar = NavigationBarView(context, appContext)
    private val settings = ImageButton(context).apply {
        setImageDrawable(context.stayIcon("settings"))
        contentDescription = "Ajustes"
        val background = android.util.TypedValue()
        context.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, background, true)
        setBackgroundResource(background.resourceId)
        setOnClickListener { navigate("/settings", "navigate") }
    }
    private var model: NavigationModel? = null
    private var owner: ComponentActivity? = null
    private var ready = false
    private var required = false
    private var bottomInset = 0
    private var playerExpanded = false
    private var previewKey: String? = null
    private var pageColor = Color.BLACK
    private var motionEnabled = true
    private val appearance = AppearanceTween(this) { applyAppearance(it) }
    private val transitions = SlotTransitions(this)
    private val state get() = model?.state
    private val callback = NavigationBackCallback(
        state = { state },
        consumePanel = { findPlayer(owner?.window?.decorView)?.consumeNavigationBack() == true },
        changed = { publish() },
        preview = { key -> resetPreview(); previewKey = key; updateVisibility() },
        progress = { event ->
            activeSlot()?.apply {
                animate().cancel()
                val direction = if (event.swipeEdge == BackEventCompat.EDGE_LEFT) 1 else -1
                translationX = direction * width * .18f * event.progress
                scaleX = 1f - .06f * event.progress; scaleY = scaleX
                alpha = 1f - .15f * event.progress
            }
        },
    )
    init {
        addView(stage, LayoutParams(-1, -1))
        stage.addView(content, FrameLayout.LayoutParams(-1, -1))
        stage.addView(bar, FrameLayout.LayoutParams(-1, dp(62), android.view.Gravity.BOTTOM).apply {
            leftMargin = dp(20); rightMargin = dp(20); bottomMargin = dp(4)
        })
        stage.addView(settings, FrameLayout.LayoutParams(dp(48), dp(48), android.view.Gravity.TOP or android.view.Gravity.END).apply {
            rightMargin = dp(20)
        })
        bar.nativeAction = { key -> Destination.parse(key)?.let { target -> mutate { navigate(target, "navigate") } } }
        setLabels(mapOf("/" to "Inicio", "/library" to "Biblioteca", "/tidal" to "Buscar", "/playlists" to "Playlists"))
    }
    fun setLabels(labels: Map<String, String>) {
        settings.contentDescription = labels["/settings"] ?: "Ajustes"
        bar.setItems(listOf("/" to "index", "/library" to "library", "/tidal" to "tidal", "/playlists" to "playlists").map {
            mapOf("key" to it.first, "name" to it.second, "label" to (labels[it.first] ?: it.second))
        })
    }
    fun setAppearance(value: Map<String, String>) {
        motionEnabled = value["motion"] != "off"
        appearance.set(value)
    }
    private fun applyAppearance(value: Map<String, String>) {
        bar.setAppearance(mapOf("muted" to value["onSurfaceVariant"].orEmpty(), "accent" to value["primary"].orEmpty(), "motion" to value["motion"].orEmpty()))
        runCatching { bar.setSurfaceColor(Color.parseColor(value["surface"])); pageColor = Color.parseColor(value["background"]); stage.setBackgroundColor(pageColor); updateVisibility() }
        bar.setDark(value["dark"] != "false")
        runCatching { settings.imageTintList = ColorStateList.valueOf(Color.parseColor(value["onSurface"])) }
    }
    fun setSideInsets(value: Map<String, Double>) {
        val left = maxOf(dp(20), dp((value["left"] ?: 0.0).toInt()) + dp(8))
        val right = maxOf(dp(20), dp((value["right"] ?: 0.0).toInt()) + dp(8))
        (bar.layoutParams as FrameLayout.LayoutParams).apply { leftMargin = left; rightMargin = right }
        (settings.layoutParams as FrameLayout.LayoutParams).apply {
            topMargin = dp((value["top"] ?: 0.0).toInt()) + dp(8); rightMargin = right
        }
        stage.requestLayout()
    }
    fun setBottomInset(value: Double) {
        bottomInset = dp(value.toInt())
        (bar.layoutParams as FrameLayout.LayoutParams).apply { bottomMargin = bottomInset + dp(4) }
        bar.requestLayout()
    }
    fun setReady(value: Boolean) { ready = value; if (value) mutate { setOnboarding(required) }; updateVisibility() }
    fun setOnboarding(value: Boolean) { required = value; if (ready) mutate { setOnboarding(value) } }
    fun setPlayerExpanded(value: Boolean) { playerExpanded = value; updateVisibility() }
    fun navigate(raw: String, mode: String) { Destination.parse(raw)?.let { mutate { navigate(it, mode) } } }
    fun player(value: Boolean) = mutate { player(value) }
    fun back() = mutate { back() }
    fun publish() {
        val current = state ?: return
        updateVisibility()
        onState(mapOf("snapshot" to current.snapshot()))
    }
    private fun mutate(block: NavigationState.() -> Unit) {
        resetPreview(); state?.block(); publish()
    }
    private fun activeSlot(): NavigationSlotView? = slot(state?.contentKey)
    internal fun slot(key: String?): NavigationSlotView? = if (key == null) null else (0 until content.childCount)
        .map { content.getChildAt(it) }.filterIsInstance<NavigationSlotView>().find { it.entryKey == key }
    /** Roots sit at 0, pushed details above them, the onboarding gate on top. Drives push vs pop. */
    private fun depth(key: String?): Int {
        val current = state ?: return 0
        val index = current.entries.indexOfFirst { it.key == key }
        if (index < 0) return -1
        val entry = current.entries[index]
        return when {
            entry.destination.path == "/onboarding" && current.onboardingRequired -> 1000
            entry.destination.tab != null && current.entries.take(index + 1).all { it.destination.tab != null } -> 0
            else -> index + 1
        }
    }
    fun updateVisibility() {
        val current = state
        val key = if (ready) current?.contentKey else null
        // Keep the outgoing page on screen until the incoming slot has actually mounted.
        if (key != null && current != null && slot(key) != null) transitions.settle(key, depth(key), current.activeTab, motionEnabled)
        for (i in 0 until content.childCount) {
            val slot = content.getChildAt(i) as? NavigationSlotView ?: continue
            val active = ready && slot.entryKey == transitions.shownKey
            slot.show(active || (ready && slot.entryKey == previewKey) || transitions.isAnimating(slot.entryKey))
            slot.elevation = transitions.elevation(slot.entryKey, active)
            // Opaque pages: a back-gesture preview sits behind the active screen, not through it.
            slot.setBackgroundColor(pageColor)
            slot.importantForAccessibility = if (active) IMPORTANT_FOR_ACCESSIBILITY_AUTO else IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        }
        bar.visibility = if (ready && current?.showBar == true && !playerExpanded) VISIBLE else GONE
        current?.let { bar.setActiveKey(it.activeTab) }
        settings.visibility = if (ready && current?.current?.destination?.path == "/" && !playerExpanded) VISIBLE else GONE
        // At the root leave Back to the activity rather than consume it as a route pop.
        callback.isEnabled = ready && (current?.canGoBack == true || current?.onboardingRequired == true)
    }
    private fun resetPreview() {
        // A cancelled gesture eases back; a committed one is continued by the pop transition.
        if (previewKey != null) activeSlot()?.takeIf { !transitions.isAnimating(it.entryKey) }?.let { transitions.restore(it, motionEnabled) }
        previewKey?.let { key -> transitions.revealed = key; post { if (transitions.revealed == key) transitions.revealed = null } }
        previewKey = null
        updateVisibility()
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        val activity = appContext.currentActivity as? ComponentActivity ?: return
        owner = activity
        val holder = NavigationSession.attach(activity)
        model = holder
        activity.onBackPressedDispatcher.addCallback(activity, callback)
        NavigationHostRegistry.host = this
        NavigationHostRegistry.pendingLink?.let { navigate(it, "navigate") }
        NavigationHostRegistry.pendingLink = null
        if (ready) holder.state.setOnboarding(required)
        post { publish() }
    }
    override fun onDetachedFromWindow() {
        appearance.finish(); transitions.finish()
        callback.remove()
        owner?.let { NavigationSession.detach(it) }
        if (NavigationHostRegistry.host === this) NavigationHostRegistry.host = null
        owner = null
        super.onDetachedFromWindow()
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    companion object {
        private fun findPlayer(view: View?): FullPlayerView? {
            if (view is FullPlayerView && view.isShown) return view
            if (view is ViewGroup) for (i in 0 until view.childCount) findPlayer(view.getChildAt(i))?.let { return it }
            return null
        }
    }
}

class NavigationSlotView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    val content = FrameLayout(context)
    var entryKey = ""
        set(value) { field = value; NavigationHostRegistry.host?.updateVisibility() }
    private var shown = false
    init { addView(content, LayoutParams(-1, -1)); super.setVisibility(GONE) }
    // Fabric's updateLayout forces VISIBLE on every frame change; only the host decides this.
    override fun setVisibility(visibility: Int) = super.setVisibility(if (shown) visibility else GONE)
    fun show(value: Boolean) { shown = value; super.setVisibility(if (value) VISIBLE else GONE) }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); NavigationHostRegistry.host?.updateVisibility() }
}

internal object NavigationHostRegistry {
    var host: NavigationHostView? = null
    var pendingLink: String? = null
}
