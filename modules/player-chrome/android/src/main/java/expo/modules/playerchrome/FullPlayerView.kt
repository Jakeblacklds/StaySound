package expo.modules.playerchrome

import android.content.Context
import android.graphics.Color
import android.graphics.Outline
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.*
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.core.graphics.ColorUtils
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.karaokeview.KaraokeSpectrumView
import expo.modules.karaokeview.KaraokeRefractionView
import org.json.JSONObject
import kotlin.math.abs

/** Android owns the full scene. Only playback/navigation/settings intentions reach JS. */
class FullPlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext), Choreographer.FrameCallback {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val onTransition by EventDispatcher()
    private val stage = FrameLayout(context).apply { clipChildren = false }
    private val base = View(context)
    private val sheen = View(context)
    private val backdrop = PlayerBackdrop(context)
    private val mesh = if (android.os.Build.VERSION.SDK_INT < 33) PlayerMeshBackground(context) else null
    private val spectrum = KaraokeSpectrumView(context, appContext)
    private val scrim = View(context)
    private val artwork = PlayerArtwork(context)
    private val refraction = KaraokeRefractionView(context, appContext)
    private val content = FrameLayout(context).apply { clipChildren = false }
    private val header = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    private val close = PlayerControl(context, "chevron-down", 34f, "Cerrar reproductor") { closePlayer() }
    private val contextTitle = context.playerText(10f, 600).apply { gravity = Gravity.CENTER; letterSpacing = 0.32f; alpha = 0.42f }
    private val lower = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false }
    private val title = context.playerText(27f, 800).apply { letterSpacing = -0.7f / 27f }
    private val artist = context.playerText(17f, 600).apply { alpha = 0.9f; setOnClickListener { action("artist") }; isFocusable = true }
    private val tech = context.playerText(11f, 400).apply { alpha = 0.46f; letterSpacing = 0.05f }
    private val favorite = PlayerControl(context, "heart-outline", 26f, "Añadir a favoritos") { action("favorite") }.apply { favoriteControl = true }
    private val preview = PlayerPreview(context) { openLyrics() }
    private val progressView = PlayerProgressView(context) { action("seek", mapOf("position" to it)) }
    private val transport = PlayerTransport(context, ::routeAction)
    private val footer = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
    private val footerButtons = listOf(
        PlayerControl(context, "playlist-play", 24f, "Ver cola de reproducción") { openQueue() },
        PlayerControl(context, "playlist-music", 24f, "Mostrar letras") { openLyrics() },
        PlayerControl(context, "dots-horizontal", 24f, "Más opciones") { openOptions() })
    private val mini = MiniPlayerView(context, appContext)
    private val queue = PlayerQueueView(context, ::action) { closeQueue() }.apply { visibility = GONE }
    private val lyrics = PlayerLyricsPane(context, appContext, ::routeAction, ::action).apply { visibility = GONE; elevation = dp(20f) }
    private val options = PlayerOptionsPane(context, ::action) { closeOptions() }.apply { visibility = GONE; elevation = dp(30f) }
    private var model = JSONObject()
    private var palette = emptyMap<String, String>()
    private var renderedColors = emptyMap<String, Int>()
    private var fromColors = emptyMap<String, Int>()
    private var toColors = emptyMap<String, Int>()
    private val colorMotion = ChromeMotion(1f) { progress ->
        renderedColors = toColors.mapValues { (key, color) -> gammaColor(fromColors[key] ?: color, color, progress) }
        applyMainColors()
    }
    private var spectrumArtSize = -1f
    private var screenW = 400f
    private var screenH = 840f
    private var topInset = 24f
    private var bottomInset = 24f
    private var miniH = 66f
    private var miniBottom = 98f
    private var miniRadius = 24f
    private var p = 0f
    private var expanded = false
    private var lyricsOpen = false
    private var queueOpen = false
    private var optionsOpen = false
    private var blocked = false
    private var lite = false
    private var playing = false
    private var visualPlaying = false
    private var trackId = ""
    private var holdUntil = 0L
    private var spin = 0f
    private var lastFrame = 0L
    private var frameRunning = false
    private var lastBackRequest = 0
    private var touchDownX = 0f
    private var touchDownY = 0f
    private var gestureStart = 0f
    private var dragging = false
    private var velocity: VelocityTracker? = null
    private var rejectingGesture = false
    private var initialized = false
    private var previewLines = org.json.JSONArray()
    private var previewIndex = -2
    private var positionMs = 0L
    private val transition = ChromeMotion(0f) { p = it.coerceIn(0f, 1f); renderTransition(); onTransition(mapOf("progress" to p)) }
    private val coverScale = ChromeMotion(1f) { renderTransition() }
    private val lyricsMotion = ChromeMotion(0f) { updateLayers() }
    private val queueMotion = ChromeMotion(0f) { updateLayers() }
    private val optionsMotion = ChromeMotion(0f) { updateLayers() }
    private val finishHold = Runnable { updatePlaying() }

    init {
        addView(stage, LayoutParams(-1, -1))
        listOfNotNull(base, backdrop, mesh, spectrum, scrim, sheen, artwork, refraction, content, mini, queue, lyrics, options).forEach { stage.addView(it) }
        clipToOutline = true
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                val radius = if (p < 0.55f) miniRadius * (1 - 0.14f * p / 0.55f) else miniRadius * 0.86f * (1 - (p - 0.55f) / 0.45f)
                outline.setRoundRect(0, 0, width, height, dp(radius.coerceAtLeast(0f)))
            }
        }
        header.addView(close, LinearLayout.LayoutParams(-1, px(28)))
        header.addView(contextTitle, LinearLayout.LayoutParams(-1, px(30)))
        content.addView(header); content.addView(lower)
        val titleRow = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL; clipChildren = false }
        val copy = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(title, LinearLayout.LayoutParams(-1, px(31)))
        copy.addView(artist, LinearLayout.LayoutParams(-1, px(22)).apply { topMargin = px(2) })
        copy.addView(tech, LinearLayout.LayoutParams(-1, px(14)).apply { topMargin = px(3) })
        titleRow.addView(copy, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = px(14) })
        titleRow.addView(favorite, LinearLayout.LayoutParams(px(48), px(48)))
        lower.addView(titleRow, LinearLayout.LayoutParams(-1, -2))
        lower.addView(preview, LinearLayout.LayoutParams(-1, px(105)).apply { topMargin = px(12) })
        lower.addView(progressView, LinearLayout.LayoutParams(-1, px(46)).apply { topMargin = px(5) })
        lower.addView(transport, LinearLayout.LayoutParams(-1, px(76)).apply { topMargin = px(2); leftMargin = px(4); rightMargin = px(4) })
        footerButtons.forEach { footer.addView(it, LinearLayout.LayoutParams(0, px(52), 1f)) }
        footer.setPadding(px(8), px(6), px(8), 0)
        footer.background = object : android.graphics.drawable.Drawable() {
            private val paint = android.graphics.Paint().apply { color=0x1affffff }
            override fun draw(canvas: android.graphics.Canvas) { canvas.drawRect(0f,0f,bounds.width().toFloat(),1f,paint) }
            override fun setAlpha(alpha:Int) { paint.alpha=alpha }
            override fun setColorFilter(filter:android.graphics.ColorFilter?) { paint.colorFilter=filter }
            @Suppress("DEPRECATION") override fun getOpacity()=android.graphics.PixelFormat.TRANSLUCENT
        }
        lower.addView(footer, LinearLayout.LayoutParams(-1, px(59)).apply { topMargin = px(8) })
        mini.nativeAction = ::routeAction
        mini.setLabels(mapOf("open" to "Abrir reproductor", "previous" to "Canción anterior", "next" to "Siguiente canción", "play" to "Reproducir", "pause" to "Pausar", "loading" to "Cargando canción"))
        spectrum.setAnchorMode("artwork")
        refraction.setCoverFrac(1f / 1.06f); refraction.setBlur(0.06f)
        sheen.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x14ffffff, 0x00ffffff))
        initialized = true
    }
    private fun action(name: String, extra: Map<String, Any> = emptyMap()) {
        onAction(mapOf("action" to name, "trackId" to trackId) + extra)
    }
    private fun routeAction(name: String) {
        when (name) {
            "open" -> { setExpanded(true); action("open") }
            "close" -> closePlayer()
            "lyricsClose" -> closeLyrics()
            "options" -> openOptions()
            else -> action(name)
        }
    }
    fun setGeometry(value: Map<String, Double>) {
        screenW = value["width"]?.toFloat() ?: screenW; screenH = value["height"]?.toFloat() ?: screenH
        topInset = value["top"]?.toFloat() ?: 0f; bottomInset = value["bottom"]?.toFloat() ?: 0f
        miniH = value["miniHeight"]?.toFloat() ?: 66f; miniBottom = value["miniBottom"]?.toFloat() ?: 98f
        miniRadius = value["miniRadius"]?.toFloat() ?: 24f
        requestLayout(); renderTransition()
    }
    fun setModel(value: String) {
        val next = JSONObject(value); model = next
        val track = next.optJSONObject("track") ?: JSONObject()
        val id = track.optString("id")
        if (id != trackId) {
            trackId = id; spin = 0f; holdUntil = SystemClock.uptimeMillis() + 800
            progressView.reset(); lyrics.resetPosition()
            coverScale.snap(if (expanded && !lite) 0.94f else 1f)
            if (expanded && !lite) coverScale.spring(1f, 12f, 100f, 0.5f)
            removeCallbacks(finishHold); postDelayed(finishHold, 800)
        }
        lite = next.optBoolean("lite"); playing = next.optBoolean("playing")
        mini.setLightweight(lite)
        title.text = track.optString("title"); contextTitle.text = title.text.toString().uppercase()
        artist.text = track.optString("artist"); artist.contentDescription = "Ver artista ${artist.text}"
        tech.text = track.optString("tech"); tech.visibility = if (tech.text.isEmpty()) GONE else VISIBLE
        favorite.selected(next.optBoolean("favorite")); favorite.setLabel(if (next.optBoolean("favorite")) "Quitar de favoritos" else "Añadir a favoritos")
        val uri = track.optString("artwork")
        // A new song dissolves its cover in; lightweight mode keeps the plain swap.
        artwork.load(if(expanded) uri else next.optJSONObject("miniTrack")?.optString("artwork",uri) ?: uri, animate = !lite); backdrop.load(uri, lite); refraction.setArtworkUri(uri)
        progressView.durationMs = track.optLong("duration")
        val miniTrack = next.optJSONObject("miniTrack") ?: track
        mini.setTrack(mapOf("id" to miniTrack.optString("id"), "title" to miniTrack.optString("title"), "artist" to miniTrack.optString("artist")))
        mini.setLoading(next.optBoolean("miniLoading"))
        lyrics.setModel(next); options.setModel(next)
        updatePlaying(); updateEffects(); renderTransition()
    }
    private fun updatePlaying() {
        visualPlaying = playing || model.optBoolean("loading") || SystemClock.uptimeMillis() < holdUntil
        mini.setPaused(!visualPlaying); transport.state(model, visualPlaying)
        lyrics.setPlaying(model, playing)
        updateClock()
    }
    fun setPalette(value: Map<String, String>) {
        if (palette == value) return
        val first = palette.isEmpty()
        palette = value
        fromColors = renderedColors
        toColors = value.mapValues { playerColor(it.value) }
        // The album palette uses the same 1200 ms ease-out as useDynamicColors.
        if (first) colorMotion.snap(1f) else { colorMotion.snap(0f); colorMotion.timing(1f, 1200, true) }
        queue.colors(playerColor(value["accent"].orEmpty()), playerColor(value["text"].orEmpty()), playerColor(value["background"].orEmpty()))
        lyrics.setPalette(value); options.setPalette(value)
    }
    private fun applyMainColors() {
        val accent = c("accent"); val ink = c("text")
        title.setTextColor(ink); artist.setTextColor(accent); contextTitle.setTextColor(ink); tech.setTextColor(ink)
        close.colors(alphaColor(ink, .44f)); favorite.colors(ink, accent)
        preview.colors(accent, ink); progressView.accent = accent; progressView.ink = ink; progressView.invalidate()
        transport.colors(accent, ink, c("onPrimary")); footerButtons.forEach { it.colors(alphaColor(ink, .66f)) }
        artwork.colors(accent, ink); spectrum.setGlowColor(c("spectrum")); refraction.setGlowColor(c("spectrum"))
        backdrop.setBackgroundColor(c("background")); backdrop.colors(accent,c("secondary"));mesh?.palette(c("background"),accent,c("secondary"),c("meshAccent"))
        mini.setTitleColor(ink); mini.setColors(c("miniInk"), c("miniControl"), c("miniFill"))
        base.setBackgroundColor(gammaColor(c("surface"),c("background"),FullPlayerMotion.range(p,0f,.12f)))
    }
    private fun c(key: String) = renderedColors[key] ?: playerColor(palette[key].orEmpty())
    fun setPosition(value: Long) { positionMs = value; progressView.position(value); lyrics.position(value); updatePreview() }
    fun setQueue(value: String) { queue.setQueue(JSONObject(value)) }
    fun setLyrics(value: String) {
        val data = JSONObject(value); lyrics.setLyrics(data)
        previewLines = data.optJSONArray("previewLines") ?: org.json.JSONArray(); previewIndex = -2; updatePreview()
    }
    private fun updatePreview() {
        val time = positionMs + (model.optJSONObject("lyricsState")?.optLong("offset") ?: 0)
        var lo = 0; var hi = previewLines.length() - 1; var index = if (previewLines.length() > 0) 0 else -1
        while (lo <= hi) {
            val middle = (lo + hi) / 2
            if (previewLines.getJSONObject(middle).optLong("startMs") <= time) { index = middle; lo = middle + 1 } else hi = middle - 1
        }
        if (index == previewIndex) return
        previewIndex = index
        fun text(at: Int) = previewLines.optJSONObject(at)?.optString("text").orEmpty()
        preview.phrase(text(index), if (index >= 0) text(index + 1) else "", if (index >= 0) text(index + 2) else "")
    }
    fun setBlocked(value: Boolean) { blocked = value; mini.visibility = if (value) INVISIBLE else VISIBLE }
    fun setExpanded(value: Boolean) {
        if (value == expanded) return
        expanded = value
        val track = model.optJSONObject("track")
        artwork.load(if(value) track?.optString("artwork").orEmpty() else model.optJSONObject("miniTrack")?.optString("artwork",track?.optString("artwork").orEmpty()).orEmpty())
        transition.curve(if (value) 1f else 0f, if (value) 280 else 320, FullPlayerMotion.emphasized)
        if (value && !lite) { coverScale.snap(0.94f); coverScale.spring(1f, 12f, 100f, 0.5f) }
        if (!value) { closeQueue(true); closeLyrics(true); closeOptions(true) }
        updateEffects(); updateClock()
    }
    private fun closePlayer() { setExpanded(false); action("close") }
    private fun openQueue() { queueOpen = true; queue.visibility = VISIBLE; if (lite) queueMotion.timing(1f, 180) else queueMotion.spring(1f, 22f, 200f, 0.6f); updateEffects() }
    private fun closeQueue(immediate: Boolean = false) {
        queueOpen = false
        if (immediate) queueMotion.snap(0f) else queueMotion.curve(0f, 220, FullPlayerMotion.accelerated)
        updateEffects()
    }
    private fun openLyrics() {
        lyricsOpen = true; lyrics.visibility = VISIBLE; lyrics.keepScreenOn = true
        lyricsMotion.spring(1f, 18f, 120f, 1f); action("lyricsState", mapOf("visible" to true)); updateEffects()
    }
    private fun closeLyrics(immediate: Boolean = false) {
        if (!lyricsOpen && lyricsMotion.value == 0f) return
        lyricsOpen = false; lyrics.keepScreenOn = false
        if (immediate) lyricsMotion.snap(0f) else lyricsMotion.curve(0f, if (lite) 160 else 200, FullPlayerMotion.accelerated)
        action("lyricsState", mapOf("visible" to false)); updateEffects()
    }
    private fun openOptions() {
        optionsOpen = true; options.visibility = VISIBLE; options.setLyricsOpen(lyricsOpen)
        optionsMotion.spring(1f, 22f, 180f, 0.7f)
    }
    private fun closeOptions(immediate: Boolean = false) {
        optionsOpen = false
        if (immediate) optionsMotion.snap(0f) else optionsMotion.timing(0f, 240)
    }
    /** Navigation owns closing the route; nested player panels consume Back first. */
    fun consumeNavigationBack(): Boolean = when {
        optionsOpen -> { closeOptions(); true }
        lyricsOpen -> { closeLyrics(); true }
        queueOpen -> { closeQueue(); true }
        else -> false
    }
    fun handleBack(value: Int) {
        if (value == lastBackRequest) return; lastBackRequest = value
        when { optionsOpen -> closeOptions(); lyricsOpen -> closeLyrics(); queueOpen -> closeQueue(); expanded -> closePlayer() }
    }
    private fun updateEffects() {
        val enabled = isAttachedToWindow && windowVisibility == VISIBLE && expanded && !lyricsOpen && !queueOpen && model.optBoolean("effects") && !lite
        val meshEnabled = enabled && mesh != null && model.optString("spectrumTheme") == "aurora"
        mesh?.visibility = if (meshEnabled) VISIBLE else INVISIBLE
        mesh?.state(meshEnabled, playing)
        spectrum.setSpectrumTheme(model.optString("spectrumTheme", "aurora")); spectrum.setSpectrumEnabled(enabled && !meshEnabled)
        spectrum.setSpectrumPlaying(playing); spectrum.setRenderDelayMs(model.optInt("spectrumDelay"))
        spectrum.setParticleIntensity(if (model.optString("spectrumTheme") == "aurora") 0.42f else 0.62f)
        refraction.setRefractionEnabled(enabled && model.optString("spectrumTheme") == "refractionVeil")
        refraction.setRefractionPlaying(playing)
        lyrics.setActive(isAttachedToWindow && windowVisibility == VISIBLE && expanded && lyricsOpen)
    }
    private fun frame(view: View, x: Float, y: Float, w: Float, h: Float) {
        val wi = dp(w.coerceAtLeast(0f)).toInt(); val hi = dp(h.coerceAtLeast(0f)).toInt()
        if (view.measuredWidth != wi || view.measuredHeight != hi || view.isLayoutRequested)
            view.measure(MeasureSpec.makeMeasureSpec(wi, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(hi, MeasureSpec.EXACTLY))
        val left = dp(x).toInt(); val top = dp(y).toInt(); view.layout(left, top, left + wi, top + hi)
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) { super.onLayout(changed, l, t, r, b); renderTransition() }
    private fun renderTransition() {
        if (width == 0 || height == 0) return
        val w = width / resources.displayMetrics.density; val h = height / resources.displayMetrics.density
        listOfNotNull(base, backdrop, mesh, spectrum, scrim, sheen, content, lyrics, options).forEach { frame(it, 0f, 0f, w, h) }
        val tint = ColorUtils.blendARGB(c("surface"), c("background"), FullPlayerMotion.range(p, 0f, 0.12f))
        base.setBackgroundColor(tint)
        sheen.alpha = 1f - FullPlayerMotion.range(p, 0f, 0.18f)
        val dark = model.optBoolean("dark", true)
        val bgP = when { p < 0.64f -> 0f; p < 0.9f -> FullPlayerMotion.range(p, 0.64f, 0.9f) * if (dark) 0.68f else 0.54f; else -> FullPlayerMotion.mix(if (dark) 0.68f else 0.54f, 1f, FullPlayerMotion.range(p, 0.9f, 1f)) }
        backdrop.alpha = bgP * if (p < 0.35f) p / 0.35f * 0.2f else 0.2f + (p - 0.35f) / 0.65f * 0.8f
        spectrum.alpha = bgP; mesh?.alpha = bgP
        val psychedelic = model.optString("spectrumTheme") == "aurora"
        val scrimMid = if (psychedelic) { if (dark) 0.44f else 0.31f } else { if (dark) 0.32f else 0.22f }
        val scrimEnd = if (psychedelic) { if (dark) 0.60f else 0.44f } else { if (dark) 0.46f else 0.32f }
        scrim.setBackgroundColor(0xff05040b.toInt())
        scrim.alpha = if (p < 0.9f) FullPlayerMotion.range(p, 0.64f, 0.9f) * scrimMid else FullPlayerMotion.mix(scrimMid, scrimEnd, FullPlayerMotion.range(p, 0.9f, 1f))
        val size = FullPlayerMotion.artworkSize(screenW, screenH, topInset, bottomInset)
        val artTop = maxOf(topInset + 10, 30f) + 58f
        val artP = FullPlayerMotion.artworkProgress(p)
        val s = FullPlayerMotion.mix(48f, size, artP)
        val collapsedH = if (p == 0f) h else miniH
        frame(artwork, FullPlayerMotion.mix(10f, (screenW - size) / 2f, artP), FullPlayerMotion.mix((collapsedH - 48) / 2f, artTop, artP), s, s)
        artwork.discAmount = FullPlayerMotion.range(p, 0.55f, 1f)
        val settle = when { p < 0.9f -> 1f; p < 0.97f -> 1f + FullPlayerMotion.range(p, 0.9f, 0.97f) * 0.018f; else -> 1.018f - FullPlayerMotion.range(p, 0.97f, 1f) * 0.018f }
        artwork.scaleX = settle * if (p > 0.9f) coverScale.value else 1f; artwork.scaleY = artwork.scaleX
        frame(refraction, (screenW - size * 1.06f) / 2f, artTop - size * 0.03f, size * 1.06f, size * 1.06f)
        refraction.alpha = artwork.discAmount
        if (spectrumArtSize != size) { spectrumArtSize = size; spectrum.setFocusY(((artTop + size * .5f) / screenH).coerceIn(.24f,.78f)); spectrum.setArtworkSize(size) }
        frame(header, 34f, maxOf(topInset + 22, 42f) - 10, (w - 68).coerceAtLeast(0f), 58f)
        val lowerWidth = dp((w - 68).coerceAtLeast(0f)).toInt()
        lower.measure(MeasureSpec.makeMeasureSpec(lowerWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
        val lowerH = lower.measuredHeight / resources.displayMetrics.density
        frame(lower, 34f, h - maxOf(bottomInset + 8, 26f) - lowerH, w - 68, lowerH)
        frame(mini, 0f, 0f, w, collapsedH); mini.setExpansion(p)
        mini.visibility = if (blocked || p >= 0.38f) INVISIBLE else VISIBLE
        mini.isEnabled = !expanded
        frame(queue, 0f, 56f, w, h - 56)
        lyrics.setInsets(topInset, bottomInset); options.bottomInset = bottomInset
        invalidateOutline(); updateLayers()
    }
    private fun updateLayers() {
        content.alpha = FullPlayerMotion.range(p, 0.75f, 1f) * (1f - lyricsMotion.value).coerceIn(0f, 1f)
        content.translationY = dp(24f) * (1 - FullPlayerMotion.range(p, 0.75f, 1f))
        content.visibility = if (p <= 0.75f || lyricsOpen) INVISIBLE else VISIBLE
        artwork.visibility = if (lyricsOpen || queueOpen) INVISIBLE else VISIBLE
        refraction.visibility = artwork.visibility
        queue.alpha = FullPlayerMotion.range(queueMotion.value, 0f, 0.4f); queue.translationY = dp(30f) * (1 - queueMotion.value)
        queue.visibility = if (queueOpen || queueMotion.value > 0.001f) VISIBLE else GONE
        lyrics.alpha = lyricsMotion.value.coerceIn(0f, 1f); lyrics.translationY = dp(32f) * (1 - lyricsMotion.value)
        lyrics.scaleX = 0.94f + lyricsMotion.value * 0.06f; lyrics.scaleY = lyrics.scaleX
        lyrics.visibility = if (lyricsOpen || lyricsMotion.value > 0.001f) VISIBLE else GONE
        options.visibility = if (optionsOpen || optionsMotion.value > 0.001f) VISIBLE else GONE
        options.setProgress(optionsMotion.value)
    }
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (optionsOpen || lyricsOpen || queueOpen || blocked) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchDownX = event.rawX; touchDownY = event.rawY; gestureStart = p; dragging = false; rejectingGesture = false
                velocity?.recycle(); velocity = VelocityTracker.obtain(); velocity?.addMovement(event)
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = (event.rawX - touchDownX) / resources.displayMetrics.density
                val dy = (event.rawY - touchDownY) / resources.displayMetrics.density
                if (abs(dx) > 20f) rejectingGesture = true
                if (!rejectingGesture && abs(dy) > 10f && abs(dy) >= abs(dx) && (if (expanded) dy > 0 else dy < 0)) {
                    dragging = true; transition.cancel(); parent.requestDisallowInterceptTouchEvent(true); return true
                }
            }
            MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_UP -> { velocity?.recycle(); velocity = null }
        }
        return false
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (optionsOpen || lyricsOpen || queueOpen || blocked) return super.onTouchEvent(event)
        if (!dragging) {
            // Blank artwork/background also owns a stream, so its swipe can dismiss.
            if (event.actionMasked == MotionEvent.ACTION_MOVE) onInterceptTouchEvent(event)
            if (!dragging) {
                if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
                    velocity?.recycle(); velocity = null
                }
                return true
            }
        }
        velocity?.addMovement(event)
        val dy = (event.rawY - touchDownY) / resources.displayMetrics.density
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> {
                val travel = if (expanded) screenH - miniBottom else maxOf(240f, screenH - miniBottom - miniH)
                transition.snap((gestureStart - dy / travel).coerceIn(0f, 1f))
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                velocity?.computeCurrentVelocity(1000)
                val speed = (velocity?.yVelocity ?: 0f) / resources.displayMetrics.density
                val target = if (event.actionMasked == MotionEvent.ACTION_CANCEL) expanded else
                    if (expanded) !FullPlayerMotion.dismiss(dy, speed) else FullPlayerMotion.expand(dy, speed)
                dragging = false; velocity?.recycle(); velocity = null; parent.requestDisallowInterceptTouchEvent(false)
                if (target == expanded) {
                    if (target) transition.spring(1f, 26f, 340f, 0.5f)
                    else transition.curve(0f, 320, FullPlayerMotion.decelerated)
                } else { setExpanded(target); action(if (target) "open" else "close") }
            }
        }
        return true
    }
    private fun updateClock() {
        val shouldRun = isAttachedToWindow && windowVisibility == VISIBLE && visualPlaying && !lite
        if (shouldRun && !frameRunning) { frameRunning = true; lastFrame = 0; Choreographer.getInstance().postFrameCallback(this) }
        else if (!shouldRun) { frameRunning = false; lastFrame = 0; Choreographer.getInstance().removeFrameCallback(this) }
    }
    override fun doFrame(time: Long) {
        if (!frameRunning) return
        if (lastFrame > 0) spin = (spin + (time - lastFrame) / 1_000_000f * 360f / 60000f) % 360f
        if (lastFrame > 0 && lyricsOpen && playing) lyrics.advanceRotation((time - lastFrame) / 1_000_000f)
        lastFrame = time; artwork.image.rotation = spin
        Choreographer.getInstance().postFrameCallback(this)
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); updateClock(); updateEffects() }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); if (initialized) { updateClock();updateEffects() } }
    override fun onDetachedFromWindow() {
        frameRunning = false; Choreographer.getInstance().removeFrameCallback(this); removeCallbacks(finishHold)
        listOf(transition, coverScale, lyricsMotion, queueMotion, optionsMotion, colorMotion).forEach { it.cancel() }
        velocity?.recycle(); velocity = null; mesh?.state(false,false);lyrics.setActive(false);spectrum.setSpectrumEnabled(false); refraction.setRefractionEnabled(false)
        super.onDetachedFromWindow()
    }
}
