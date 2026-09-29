package expo.modules.playerchrome

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.view.ContextThemeWrapper
import com.google.android.material.bottomsheet.BottomSheetDialog
import expo.modules.kotlin.AppContext
import expo.modules.karaokeview.KaraokeView
import expo.modules.karaokeview.KaraokeSpectrumView
import org.json.JSONArray
import org.json.JSONObject

/** Hosts the existing Kotlin karaoke renderer; its geometry, fonts and shaders are unchanged. */
internal class PlayerLyricsPane(context: Context, appContext: AppContext,
    private val route: (String) -> Unit, private val send: (String, Map<String, Any>) -> Unit) : FrameLayout(context) {
    private val backdrop = PlayerBackdrop(context)
    private val spectrum = KaraokeSpectrumView(context, appContext)
    private val scrim = View(context)
    private val karaoke = KaraokeView(context, appContext)
    private val lyricStage = FrameLayout(context)
    private val topFade = View(context)
    private val bottomFade = View(context)
    private val art = PlayerArtwork(context).apply { discAmount = 1f }
    private val grabber = View(context)
    private val more = PlayerControl(context, "dots-horizontal", 25f, "Más opciones") { route("options") }
    private val title = context.playerText(24f, 800)
    private val artist = context.playerText(19f, 500)
    private val quality = context.playerText(11f, 800).apply { gravity = Gravity.CENTER; letterSpacing=.2f/11f }
    private val metadata = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL; isClickable = true; isFocusable = true; contentDescription = "Abrir álbum"; setOnClickListener { route("album") } }
    private val transport = PlayerTransport(context, route, true)
    private val progress = PlayerProgressView(context) { send("seek", mapOf("position" to it)) }
    private val fallback = context.playerText(18f, 600).apply { gravity = Gravity.CENTER }
    private val toolbar = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
    private val toolbarItems = mutableListOf<View>()
    private val toggle = PlayerControl(context, "water", 22f, "Controles de letras") { send("lyricsControls", emptyMap()) }
    private val caption = context.playerText(10f, 500).apply { gravity = Gravity.END }
    private val loading = PlayerLyricsSkeleton(context).apply { visibility = GONE }
    private var active = false
    private var playing = false
    private var model = JSONObject()
    private var state = JSONObject()
    private var palette = emptyMap<String, String>()
    private var topInset = 0f
    private var bottomInset = 0f
    private var offset = 0L
    private var lastLyrics = ""
    private var lastToolbar = ""
    private var lastFont = ""
    private var lastMotion = ""
    private var lastSuggestion = ""
    private var suggestedDialog: BottomSheetDialog? = null
    private var controlsExpanded = false
    private val toolbarMotion = ChromeMotion(0f) { updateToolbar() }
    private val trackFade = ChromeMotion(1f) { lyricStage.alpha = it; lyricStage.translationY = dp(24f) * (1f - it); lyricStage.scaleX = 0.96f + it * 0.04f; lyricStage.scaleY = lyricStage.scaleX }
    init {
        clipChildren=false;clipToPadding=false
        listOf(backdrop, spectrum, scrim, lyricStage, topFade, bottomFade, art, grabber, more, metadata, fallback, loading, toolbar, caption, progress, transport).forEach { addView(it) }
        lyricStage.addView(karaoke, LayoutParams(-1, -1))
        val titleRow = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        titleRow.addView(title, LinearLayout.LayoutParams(-2, px(29)))
        titleRow.addView(quality, LinearLayout.LayoutParams(-2, px(27)).apply { leftMargin = px(10) })
        quality.setPadding(px(8), 0, px(8), 0)
        metadata.addView(titleRow, LinearLayout.LayoutParams(-1, -2))
        metadata.addView(artist, LinearLayout.LayoutParams(-1, px(24)).apply { topMargin = px(4) })
        karaoke.setRenderingActive(false)
        karaoke.setFontSize(26f); karaoke.setIsLineByLine(false); karaoke.setSeekOnTapEnabled(true)
        karaoke.setEnableAmbientBackground(false); karaoke.setIntroTitle(""); karaoke.setIntroSubtitle("")
        karaoke.nativeSeekListener = { send("seek", mapOf("position" to it)) }
        spectrum.setAnchorMode("artwork"); spectrum.setSpectrumTheme("aurora"); spectrum.setParticleIntensity(0.42f)
        // The original grabber had no dismiss button; preserve its look and make the hit area usable.
        grabber.setOnClickListener { route("lyricsClose") }; grabber.contentDescription = "Cerrar letras"; grabber.isFocusable = true
        art.setOnClickListener { route("album") }
    }
    private fun c(key: String, fallbackKey: String = "text") = playerColor(palette[key] ?: palette[fallbackKey].orEmpty())
    fun setInsets(top: Float, bottom: Float) { if (topInset == top && bottomInset == bottom) return; topInset = top; bottomInset = bottom; requestLayout() }
    fun setPalette(value: Map<String, String>) {
        palette = value
        val text = c("lyricsText"); val accent = c("lyricsAccent", "accent"); val surface = c("lyricsSurface", "background"); val secondary = c("lyricsSecondary")
        setBackgroundColor(surface); backdrop.setBackgroundColor(surface); backdrop.colors(c("accent"),c("secondary"))
        title.setTextColor(text); artist.setTextColor(secondary); quality.setTextColor(secondary)
        quality.background = roundSurface(alphaColor(secondary, 0.08f), dp(6f)).apply { setStroke(px(1), alphaColor(secondary, 0.28f)) }
        art.colors(accent, text);art.lyricsStyle(surface); more.colors(text); more.background = roundSurface(c("lyricsChrome", "background"), dp(24f))
        grabber.background = roundSurface(alphaColor(text, 0.28f), dp(3f))
        topFade.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(alphaColor(surface, 0.78f), alphaColor(surface, 0.52f), Color.TRANSPARENT))
        bottomFade.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.TRANSPARENT, 0x6b000000))
        scrim.setBackgroundColor(if (model.optBoolean("dark", true)) 0x42000000 else 0x14000000)
        karaoke.setActiveColor(c("lyricsHighlight", "accent")); karaoke.setInactiveColor(c("lyricsInactive")); karaoke.setGlowColor(c("lyricsGlow", "accent")); karaoke.setPlayerBackgroundColor(surface)
        spectrum.setGlowColor(c("lyricsSpectrum", "spectrum"))
        transport.colors(accent, text, c("onPrimary")); progress.accent = accent; progress.ink = secondary; progress.invalidate()
        fallback.setTextColor(text); caption.setTextColor(secondary); toggle.colors(accent)
        loading.colors(text, c("lyricsHighlight", "accent"), model.optBoolean("dark", true))
        lastToolbar = ""; rebuildToolbar()
    }
    fun setModel(value: JSONObject) {
        model = value; state = value.optJSONObject("lyricsState") ?: JSONObject()
        val track = value.optJSONObject("track") ?: JSONObject()
        title.text = track.optString("title"); artist.text = track.optString("artist"); quality.text = track.optString("quality")
        val uri = track.optString("artwork"); art.load(uri); backdrop.load(uri, value.optBoolean("lite"))
        backdrop.setDark(value.optBoolean("dark", true))
        progress.durationMs = track.optLong("duration"); offset = state.optLong("offset")
        val font = state.optString("font", "classic"); val motion = state.optString("profile", "velvet")
        if (lastFont != font) { lastFont = font; karaoke.setLyricsFont(font) }
        if (lastMotion != motion) { lastMotion = motion; karaoke.setMotionProfile(motion) }
        spectrum.setRenderDelayMs(value.optInt("spectrumDelay"))
        val expanded = state.optBoolean("controlsExpanded")
        if (expanded != controlsExpanded) { controlsExpanded = expanded; toolbarMotion.spring(if (expanded) 1f else 0f, 18f, 220f, 0.6f) }
        rebuildToolbar(); updateState(); suggestions()
    }
    fun setPlaying(value: JSONObject, playing: Boolean) { this.playing = playing; transport.state(value, playing); updateState() }
    fun setActive(value: Boolean) { if(active==value) return; active = value; karaoke.setRenderingActive(value); keepScreenOn = value; updateState(); if (value) suggestions() else { suggestedDialog?.dismiss(); suggestedDialog = null } }
    private fun updateState() {
        karaoke.setIsPlaying(active && playing); karaoke.setEnableSpectralParticles(active && playing)
        spectrum.setSpectrumEnabled(active && model.optBoolean("effects")); spectrum.setSpectrumPlaying(active && playing)
        val loadingNow = state.optBoolean("loading") && !state.optBoolean("hasLyrics")
        loading.visibility = if (loadingNow) VISIBLE else GONE
        fallback.text = if (state.optBoolean("resolved") && !state.optBoolean("hasLyrics")) "No se encontraron letras" else ""
        fallback.visibility = if (fallback.text.isEmpty()) GONE else VISIBLE
        lyricStage.visibility = if (loadingNow || !state.optBoolean("hasLyrics")) INVISIBLE else VISIBLE
        toolbar.visibility = if (state.optBoolean("hasLyrics")) VISIBLE else GONE
    }
    fun resetPosition() { progress.reset(); art.image.rotation = 0f }
    fun advanceRotation(milliseconds: Float) { art.image.rotation = (art.image.rotation + milliseconds * 360f / 42000f) % 360f }
    fun position(value: Long) {
        progress.position(value)
        if (active) karaoke.updateTime((value + offset).coerceAtLeast(0))
    }
    fun setLyrics(data: JSONObject) {
        val raw = data.optJSONArray("lines")?.toString() ?: "[]"
        if (raw == lastLyrics) return
        lastLyrics = raw
        val lines = data.optJSONArray("lines") ?: JSONArray()
        karaoke.setLyrics((0 until lines.length()).map { jsonMap(lines.getJSONObject(it)) })
        trackFade.snap(0f); trackFade.timing(1f, 480, true)
    }
    private fun label(value: String, action: String, extra: Map<String, Any> = emptyMap()): TextView = context.playerText(11f, 700).apply {
        text = value; gravity = Gravity.CENTER; setTextColor(c("lyricsSecondary")); minimumHeight = px(40)
        setPadding(px(10), 0, px(10), 0); isFocusable = true; setOnClickListener { send(action, extra) }
    }
    private fun iconLabel(icon: String, text: String, action: String): View = LinearLayout(context).apply {
        gravity=Gravity.CENTER_VERTICAL;isFocusable=true;setPadding(px(10),0,px(6),0)
        addView(PlayerIcon(context,icon,18f).apply { ink=c("lyricsSecondary") },LinearLayout.LayoutParams(px(22),px(40)))
        addView(label(text,action));setOnClickListener { send(action,emptyMap()) }
    }
    private fun rebuildToolbar() {
        val key = listOf(state.optLong("offset"), state.optString("font"), state.optString("motionId"), state.optInt("choiceIndex"), state.optInt("choiceCount"), state.optString("choiceLabel")).joinToString("|")
        if (key == lastToolbar) { updateToolbar(); return }; lastToolbar = key
        toolbar.removeAllViews(); toolbarItems.clear()
        fun item(child: View) {
            val container = FrameLayout(context).apply {
                setPadding(px(6), px(6), px(6), px(6)); background = roundSurface(c("lyricsRail", "background"), dp(26f)).apply { setStroke(px(1), c("lyricsBorder", "text")) }
                addView(child, LayoutParams(-2, -2))
            }
            toolbar.addView(container, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = px(8) }); toolbarItems.add(container)
        }
        val timing = LinearLayout(context)
        timing.addView(label("−50", "lyricsOffset", mapOf("step" to -50)))
        timing.addView(label("${if (offset > 0) "+" else ""}${offset}ms", "lyricsReset"))
        timing.addView(label("+50", "lyricsOffset", mapOf("step" to 50))); item(timing)
        if (state.optInt("choiceCount") > 1) item(iconLabel("layers-outline","${state.optInt("choiceIndex") + 1}/${state.optInt("choiceCount")}", "lyricsVersion"))
        item(iconLabel("format-font",state.optString("fontLabel", "Clásica"), "lyricsFont"))
        val motions = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        listOf("stardust" to "star-four-points", "aurora" to "aurora", "neon" to "cricket", "ember" to "candle", "silk" to "water").forEach { (id, icon) ->
            val button = PlayerControl(context, icon, 18f, "Estilo de animación $id") { send("lyricsMotion", mapOf("id" to id)) }
            val selected = state.optString("motionId") == id
            button.colors(if (selected) c("lyricsAccent", "accent") else c("lyricsInactive"))
            if (selected) button.background = roundSurface(alphaColor(c("lyricsAccent", "accent"), 0.2f), dp(22f))
            motions.addView(button, LinearLayout.LayoutParams(px(42), px(42)).apply { bottomMargin = px(4) })
        }; item(motions)
        toolbar.addView(toggle, LinearLayout.LayoutParams(px(52), px(52)))
        toggle.background = roundSurface(c("lyricsRail", "background"), dp(26f)).apply { setStroke(px(1), c("lyricsBorder", "text")) }
        caption.text = if (state.optInt("choiceCount") > 1) state.optString("choiceLabel") else ""
        updateToolbar(); requestLayout()
    }
    private fun updateToolbar() {
        for ((index, view) in toolbarItems.withIndex()) {
            val p = FullPlayerMotion.range(toolbarMotion.value, index * 0.08f, index * 0.08f + 0.6f)
            view.alpha = p; view.translationX = dp(20f) * (1 - p); view.scaleX = 0.85f + p * 0.15f; view.scaleY = view.scaleX
            view.visibility = if (p <= 0 && !controlsExpanded) INVISIBLE else VISIBLE
            fun enabled(child: View) {
                child.isEnabled = controlsExpanded
                if (child is android.view.ViewGroup) for (i in 0 until child.childCount) enabled(child.getChildAt(i))
            }
            enabled(view)
            view.importantForAccessibility = if (controlsExpanded) IMPORTANT_FOR_ACCESSIBILITY_AUTO else IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        }
        toggle.icon.name = if (controlsExpanded) "close" else state.optString("motionIcon", "water")
    }
    private fun frame(view: View, x: Float, y: Float, w: Float, h: Float) {
        val wi = dp(w.coerceAtLeast(0f)).toInt(); val hi = dp(h.coerceAtLeast(0f)).toInt()
        view.measure(MeasureSpec.makeMeasureSpec(wi, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(hi, MeasureSpec.EXACTLY))
        view.layout(dp(x).toInt(), dp(y).toInt(), dp(x).toInt() + wi, dp(y).toInt() + hi)
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val w = width / resources.displayMetrics.density; val h = height / resources.displayMetrics.density
        listOf(backdrop, spectrum, scrim, fallback).forEach { frame(it, 0f, 0f, w, h) }
        frame(lyricStage, 0f, 176f, w, h - 332f)
        frame(topFade, 0f, 0f, w, 252f); frame(bottomFade, 0f, h - 300, w, 300f)
        val top = maxOf(topInset + 12, 34f)
        frame(grabber, (w - 46) / 2, top + 22, 46f, 5f); frame(more, w - 70, top, 48f, 48f)
        quality.measure(MeasureSpec.makeMeasureSpec(dp(w).toInt(),MeasureSpec.AT_MOST),MeasureSpec.makeMeasureSpec(px(27),MeasureSpec.EXACTLY))
        val maxTitleWidth=(dp(w-172-10)-quality.measuredWidth).toInt().coerceAtLeast(0)
        if(title.maxWidth!=maxTitleWidth) title.maxWidth=maxTitleWidth
        frame(art, 28f, top + 84, 96f, 96f); frame(metadata, 144f, top + 80, w - 172, 104f)
        val bottom = maxOf(bottomInset + 14, 22f)
        frame(transport, 28f, h - bottom - 82, w - 56, 82f)
        frame(progress, 28f, h - bottom - 88 - 46, w - 56, 46f)
        toolbar.measure(MeasureSpec.makeMeasureSpec(dp(240f).toInt(), MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(dp(h - top - 180).toInt().coerceAtLeast(0), MeasureSpec.AT_MOST))
        val tw = toolbar.measuredWidth / resources.displayMetrics.density; val th = toolbar.measuredHeight / resources.displayMetrics.density
        frame(toolbar, w - 14 - tw, h - bottom - 136 - th, tw, th)
        frame(caption, 28f, h - bottom - 136 - 68 - 16, w - 110, 16f)
        frame(loading, 0f, 176f, w, h - bottom - 146 - 176)
    }
    private fun suggestions() {
        val suggestions = state.optJSONArray("suggestions") ?: JSONArray()
        if (!active || !state.optBoolean("suggestionsVisible") || suggestions.length() == 0) {
            suggestedDialog?.dismiss(); suggestedDialog = null; return
        }
        val signature = suggestions.toString()
        if (signature == lastSuggestion && suggestedDialog?.isShowing == true) return
        lastSuggestion = signature; suggestedDialog?.dismiss()
        val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
        val dialog = BottomSheetDialog(ui); suggestedDialog = dialog
        val dark = model.optBoolean("dark", true)
        val ink = if (dark) Color.WHITE else 0xff19191d.toInt()
        val secondary = alphaColor(ink, .67f); val accent = c("lyricsAccent", "accent")
        fun copy(value: String, size: Float, weight: Int = 500, color: Int = ink) = ui.playerText(size, weight).apply { text = value; setTextColor(color) }
        val body = LinearLayout(ui).apply {
            orientation = LinearLayout.VERTICAL; clipToOutline = true
            background = GradientDrawable().apply { setColor(if (dark) 0xff151519.toInt() else 0xfff7f7f9.toInt()); cornerRadii = floatArrayOf(dp(24f),dp(24f),dp(24f),dp(24f),0f,0f,0f,0f) }
            setPadding(0,0,0,px(maxOf(bottomInset,16f).toInt()))
        }
        val handle = FrameLayout(ui)
        handle.addView(View(ui).apply { background = roundSurface(alphaColor(secondary,.34f),dp(2f)) }, LayoutParams(px(34),px(4),Gravity.CENTER))
        body.addView(handle, LinearLayout.LayoutParams(-1,px(24)))
        val header = LinearLayout(ui).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(px(20),0,px(20),px(16)) }
        val meta = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
        meta.addView(copy("Elige la letra correcta",20f,700))
        val track = model.optJSONObject("track") ?: JSONObject()
        meta.addView(copy("${track.optString("title")} / ${track.optString("artist")}",13f,400,secondary).apply { setSingleLine(false); maxLines=2 })
        header.addView(meta,LinearLayout.LayoutParams(0,-2,1f))
        header.addView(PlayerControl(ui,"close",22f,"Cerrar selector de letras") { send("suggestionClose",emptyMap()); dialog.dismiss() }.apply { colors(ink) },LinearLayout.LayoutParams(px(42),px(42)))
        body.addView(header)
        val list = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
        for (i in 0 until suggestions.length()) {
            val candidate = suggestions.getJSONObject(i)
            val row = LinearLayout(ui).apply { gravity=Gravity.CENTER_VERTICAL; minimumHeight=px(82); setPadding(px(20),px(12),px(20),px(12)); isFocusable=true }
            row.addView(copy("${i+1}",13f,700,accent).apply { gravity=Gravity.CENTER; background=roundSurface(alphaColor(accent,.1f),dp(18f)) },LinearLayout.LayoutParams(px(36),px(36)))
            val info = LinearLayout(ui).apply { orientation=LinearLayout.VERTICAL }
            info.addView(copy(candidate.optString("title"),16f,600))
            info.addView(copy(candidate.optString("artist"),13f,400,secondary))
            val provider = "${candidate.optString("provider")} · ${if(candidate.optBoolean("wordLevel")) "palabra" else "línea"}"
            info.addView(copy(provider,10.5f,600,accent).apply { setPadding(px(7),px(3),px(7),px(3)); background=roundSurface(alphaColor(accent,.12f),dp(6f)) },LinearLayout.LayoutParams(-2,-2).apply { topMargin=px(5) })
            val seconds = candidate.optDouble("duration",0.0).toInt()
            val requested = (track.optLong("duration")/1000).toInt()
            val duration = if (seconds>0) "${seconds/60}:${(seconds%60).toString().padStart(2,'0')}" else ""
            val delta = if(seconds>0 && requested>0) { val d=seconds-requested; if(d==0) "misma duracion" else "${if(d>0) "+" else ""}${d}s" } else ""
            val detail = listOf(candidate.optString("album").takeUnless { it=="null" }.orEmpty(),duration,delta).filter { it.isNotEmpty() }.joinToString(" / ")
            if(detail.isNotEmpty()) info.addView(copy(detail,11f,400,secondary),LinearLayout.LayoutParams(-1,-2).apply { topMargin=px(4) })
            row.addView(info,LinearLayout.LayoutParams(0,-2,1f).apply { leftMargin=px(12);rightMargin=px(8) })
            row.addView(PlayerIcon(ui,"chevron-right",22f).apply { this.ink=secondary },LinearLayout.LayoutParams(px(22),px(32)))
            row.setOnClickListener { send("suggestion",mapOf("id" to candidate.optString("id"))); dialog.dismiss() }
            list.addView(row)
            if(i<suggestions.length()-1) list.addView(View(ui).apply { setBackgroundColor(alphaColor(ink,.09f)) },LinearLayout.LayoutParams(-1,1).apply { leftMargin=px(68);rightMargin=px(20) })
        }
        val scroll = ScrollView(ui).apply { isVerticalScrollBarEnabled=false; addView(list) }
        body.addView(scroll,LinearLayout.LayoutParams(-1,0,1f))
        dialog.setContentView(body)
        dialog.setOnCancelListener { send("suggestionClose", emptyMap()) }
        dialog.setOnShowListener {
            val sheet = dialog.findViewById<FrameLayout>(com.google.android.material.R.id.design_bottom_sheet)
            sheet?.setBackgroundColor(Color.TRANSPARENT)
            sheet?.layoutParams = sheet?.layoutParams?.apply { height=(this@PlayerLyricsPane.height*.68f).toInt() }
            dialog.behavior.state = com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED
        }
        dialog.show()
    }

    override fun onDetachedFromWindow() {
        toolbarMotion.cancel(); trackFade.cancel(); suggestedDialog?.dismiss(); suggestedDialog = null
        spectrum.setSpectrumEnabled(false); karaoke.setRenderingActive(false); karaoke.setIsPlaying(false); super.onDetachedFromWindow()
    }
}

private fun jsonMap(value: JSONObject): Map<String, Any> = value.keys().asSequence().associateWith { key -> jsonValue(value.get(key)) }
private fun jsonValue(value: Any): Any = when (value) {
    is JSONObject -> jsonMap(value)
    is JSONArray -> (0 until value.length()).map { jsonValue(value.get(it)) }
    JSONObject.NULL -> ""
    else -> value
}
