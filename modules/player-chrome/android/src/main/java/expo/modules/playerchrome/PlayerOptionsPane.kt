package expo.modules.playerchrome

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONObject

internal class PlayerOptionsPane(context: Context, private val send: (String, Map<String, Any>) -> Unit, private val close: () -> Unit) : FrameLayout(context) {
    private val scrim = View(context).apply { setBackgroundColor(0x85000000.toInt()); setOnClickListener { close() } }
    private val sheet = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; clipToOutline = true; elevation = dp(24f) }
    private val scroll = ScrollView(context).apply { isFillViewport = false; isVerticalScrollBarEnabled = false; overScrollMode = OVER_SCROLL_NEVER }
    private val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    private var model = JSONObject()
    private var palette = emptyMap<String, String>()
    private var lyricsOpen = false
    private var progress = 0f
    var bottomInset = 0f
    private var lastKey = ""
    private var downY = 0f
    private var velocity: android.view.VelocityTracker? = null
    private val drag = ChromeMotion(0f) { sheet.translationY = it }
    private var playlistDialog: android.app.Dialog? = null
    init {
        addView(scrim, LayoutParams(-1, -1)); addView(sheet)
        val handle = FrameLayout(context)
        handle.addView(View(context).apply { background = roundSurface(0x55ffffff, dp(2f)) }, LayoutParams(px(36), px(4), Gravity.CENTER))
        sheet.addView(handle, LinearLayout.LayoutParams(-1, px(26)))
        scroll.addView(body); sheet.addView(scroll, LinearLayout.LayoutParams(-1, -2))
        handle.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> { downY = event.rawY; drag.cancel(); velocity?.recycle(); velocity=android.view.VelocityTracker.obtain(); velocity?.addMovement(event) }
                android.view.MotionEvent.ACTION_MOVE -> { velocity?.addMovement(event); drag.snap((event.rawY - downY).coerceAtLeast(0f)) }
                android.view.MotionEvent.ACTION_UP -> {
                    velocity?.addMovement(event); velocity?.computeCurrentVelocity(1000)
                    if (event.rawY-downY>dp(80f) || (velocity?.yVelocity ?: 0f)>dp(500f)) close() else drag.spring(0f,22f,180f,.7f)
                    velocity?.recycle(); velocity=null
                }
                android.view.MotionEvent.ACTION_CANCEL -> { drag.spring(0f,22f,180f,.7f); velocity?.recycle(); velocity=null }
            }; true
        }
    }
    fun setModel(value: JSONObject) { model = value; rebuild() }
    fun setPalette(value: Map<String, String>) { palette = value; lastKey = ""; rebuild() }
    fun setLyricsOpen(value: Boolean) { lyricsOpen = value; rebuild() }
    private fun ink(key: String) = playerColor(palette[key].orEmpty())
    private fun text(value: String, size: Float = 14f, bold: Boolean = false) = context.playerText(size, if (bold) 700 else 500).apply { text = value; setTextColor(ink("text")) }
    private fun label(title: String, hint: String) {
        val row = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(px(20), px(18), px(20), px(10)) }
        row.addView(text(title, 14f, true)); row.addView(text(hint, 11f).apply { setTextColor(alphaColor(ink("text"), 0.67f)) }); body.addView(row)
    }
    private fun option(name: String, icon: String, action: String) {
        val row = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(px(20), 0, px(20), 0); minimumHeight = px(56); isFocusable = true }
        row.addView(PlayerIcon(context, icon, 22f).apply { ink = ink("accent"); background = roundSurface(alphaColor(ink, 0.08f), dp(12f)) }, LinearLayout.LayoutParams(px(40), px(40)))
        row.addView(text(name, 15f), LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = px(14) })
        row.setOnClickListener {
            val trackId = model.optJSONObject("track")?.optString("id").orEmpty()
            close()
            postDelayed({ if (action == "playlist") showPlaylists(trackId) else send(action, mapOf("trackId" to trackId)) }, 280)
        }
        body.addView(row)
    }
    private fun chip(label: String, selected: Boolean, icon: String? = null, action: () -> Unit): View = LinearLayout(context).apply {
        gravity = Gravity.CENTER; minimumHeight = px(40); setPadding(px(10), px(8), px(10), px(8)); isFocusable = true
        val color = if (selected) ink("accent") else alphaColor(ink("text"), 0.8f)
        if (icon != null) addView(PlayerIcon(context, icon, 18f).apply { this.ink=color }, LinearLayout.LayoutParams(px(20),px(24)).apply { rightMargin=px(6) })
        addView(text(label,12f,true).apply { setTextColor(color) })
        background = roundSurface(if (selected) alphaColor(ink("accent"), 0.12f) else Color.TRANSPARENT, dp(20f)).apply {
            setStroke(px(1), if (selected) ink("accent") else alphaColor(ink("text"), 0.14f))
        }
        isSelected = selected; setOnClickListener { action() }
    }
    private fun rebuild() {
        val track = model.optJSONObject("track") ?: JSONObject()
        val key = track.toString() + model.optString("spectrumTheme") + model.optInt("spectrumDelay") + model.optString("sources") + model.optBoolean("effects") + lyricsOpen + model.optBoolean("dark")
        if (lastKey == key) return
        lastKey = key
        val scrollY = scroll.scrollY; body.removeAllViews()
        sheet.background = GradientDrawable().apply {
            setColor(if (model.optBoolean("dark", true)) 0xeb18181e.toInt() else 0xf0f8f8fc.toInt())
            cornerRadii = floatArrayOf(dp(28f), dp(28f), dp(28f), dp(28f), 0f, 0f, 0f, 0f)
        }
        val header = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(px(20), 0, px(20), px(16)) }
        val image = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true; background = roundSurface(alphaColor(ink("accent"), 0.12f), dp(12f)) }
        header.addView(image, LinearLayout.LayoutParams(px(52), px(52)))
        com.bumptech.glide.Glide.with(context).load(track.optString("artwork").ifEmpty { null }).into(image)
        val meta = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        meta.addView(text(track.optString("title"), 16f, true)); meta.addView(text(track.optString("artist"), 13f).apply { alpha = 0.67f })
        header.addView(meta, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = px(14) }); body.addView(header)
        if (lyricsOpen) option("Buscar letras de nuevo", "magnify", "refreshLyrics")
        option("Ir al Artista", "account-music", "artist")
        option("Ir al Álbum", "album", "album")
        option("Añadir a Playlist", "playlist-plus", "playlist")
        option("Ecualizador", "equalizer", "equalizer")
        option("Compartir canción", "share-variant", "share")
        if (model.optBoolean("effects") && !lyricsOpen) {
            label("Estilo del espectro", "Capa de medios y agudos")
            val values = listOf("aurora" to "Psicodelia", "columns" to "Escenario", "caustics" to "Waveform", "refractionVeil" to "Refracción")
            values.chunked(2).forEach { pair ->
                val row = LinearLayout(context).apply { setPadding(px(20), px(4), px(20), px(4)) }
                pair.forEach { (id, title) -> row.addView(chip(title, model.optString("spectrumTheme") == id, mapOf("aurora" to "blur", "columns" to "spotlight-beam", "caustics" to "sine-wave", "refractionVeil" to "diamond-stone")[id]) { send("spectrumTheme", mapOf("value" to id)) }, LinearLayout.LayoutParams(0, -2, 1f).apply { setMargins(px(3), 0, px(3), 0) }) }
                body.addView(row)
            }
            label("Sincronía del espectro", "Ajusta el desfase del visualizador")
            val row = LinearLayout(context).apply { gravity = Gravity.CENTER }
            row.addView(chip("−", false) { send("spectrumDelay", mapOf("value" to (model.optInt("spectrumDelay") - 20).coerceAtLeast(0))) }, LinearLayout.LayoutParams(px(48), px(48)))
            row.addView(text("${model.optInt("spectrumDelay")} ms", 14f, true).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(px(100), px(48)))
            row.addView(chip("+", false) { send("spectrumDelay", mapOf("value" to (model.optInt("spectrumDelay") + 20).coerceAtMost(650))) }, LinearLayout.LayoutParams(px(48), px(48))); body.addView(row)
        }
        val sources = model.optJSONArray("sources") ?: org.json.JSONArray()
        label("Fuentes de letras", "${sources.length()} de 6 activas · toca para activar o quitar")
        listOf("lrc-red" to "lrc.red", "apple" to "Apple Music", "lyricsplus" to "LyricsPlus", "musixmatch" to "Musixmatch", "spotify" to "Spotify", "lrclib" to "LRCLIB").chunked(2).forEach { pair ->
            val row = LinearLayout(context).apply { setPadding(px(20), px(4), px(20), px(4)) }
            pair.forEach { (id, name) ->
                val selected = (0 until sources.length()).any { sources.optString(it) == id }
                row.addView(chip(name, selected, if(selected) "check-circle" else "circle-outline") { send("source", mapOf("id" to id, "enabled" to !selected)) }, LinearLayout.LayoutParams(0, -2, 1f).apply { setMargins(px(3), 0, px(3), 0) })
            }; body.addView(row)
        }
        body.setPadding(0, 0, 0, dp(maxOf(bottomInset + 16, 28f)).toInt())
        requestLayout(); scroll.post { scroll.scrollTo(0, scrollY) }
    }
    private fun showPlaylists(trackId: String) {
        val entries=model.optJSONArray("playlists") ?: org.json.JSONArray()
        val ui=androidx.appcompat.view.ContextThemeWrapper(context,com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
        val builder=com.google.android.material.dialog.MaterialAlertDialogBuilder(ui).setTitle("Añadir a playlist")
        if(entries.length()==0) builder.setMessage("Crea una playlist desde tu biblioteca para añadir canciones.").setPositiveButton("Entendido",null)
        else builder.setItems(Array(entries.length()) { entries.getJSONObject(it).optString("name") }) { _, index ->
            send("playlistAdd",mapOf("id" to entries.getJSONObject(index).optString("id"),"trackId" to trackId))
        }.setNegativeButton("Cancelar",null)
        playlistDialog=builder.show()
    }
    override fun onDetachedFromWindow() { drag.cancel(); velocity?.recycle(); velocity=null; playlistDialog?.dismiss(); playlistDialog=null; super.onDetachedFromWindow() }
    fun setProgress(value: Float) { progress = value; scrim.alpha = value.coerceIn(0f, 1f); sheet.translationY = height * 0.82f * (1 - value) }
    override fun onMeasure(w: Int, h: Int) {
        super.onMeasure(w, h)
        sheet.measure(MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec((measuredHeight * 0.82f).toInt(), MeasureSpec.AT_MOST))
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        scrim.layout(0, 0, width, height); sheet.layout(0, height - sheet.measuredHeight, width, height); setProgress(progress)
    }
}
