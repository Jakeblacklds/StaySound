package expo.modules.androidshell

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.view.ContextThemeWrapper
import expo.modules.karaokeview.KaraokeView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject

/** Route chrome only. KaraokeView owns layout, timing, highlighting and scrolling. */
class ShellScreenView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val style = ShellStyle(ui)
    private val column = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
    private val header = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
    private val title = style.text("", 22f)
    private val artist = style.text("", 14f)
    private val controls = LinearLayout(ui)
    private val mode = style.button("KARAOKE") { emit("mode") }
    private val close = style.button("Cerrar") { emit("back") }
    private val stage = FrameLayout(ui)
    private val karaoke = KaraokeView(context, appContext)
    private val message = style.text("", 18f).apply { gravity = Gravity.CENTER }
    private val progress = ProgressBar(ui)
    private var model = JSONObject()
    private var active = false
    private var top = 0
    private var bottom = 0
    private var lastLyrics = ""
    init {
        addView(column, LayoutParams(-1, -1))
        column.addView(header, LinearLayout.LayoutParams(-1, -2))
        header.addView(title); header.addView(artist)
        controls.addView(mode, LinearLayout.LayoutParams(0, -2, 1f))
        controls.addView(close, LinearLayout.LayoutParams(-2, -2))
        header.addView(controls)
        column.addView(stage, LinearLayout.LayoutParams(-1, 0, 1f))
        stage.addView(karaoke, FrameLayout.LayoutParams(-1, -1))
        stage.addView(message, FrameLayout.LayoutParams(-1, -1))
        message.setPadding(style.dp(24), style.dp(24), style.dp(24), style.dp(24))
        stage.addView(progress, FrameLayout.LayoutParams(style.dp(48), style.dp(48), Gravity.CENTER))
        karaoke.setRenderingActive(false)
        karaoke.setSeekOnTapEnabled(true)
        karaoke.nativeSeekListener = { if (active) emit("seek", it) }
    }
    private fun emit(action: String, position: Double? = null) {
        if (!active) return
        val event = mutableMapOf<String, Any>("kind" to model.optString("kind"), "id" to model.optString("id"), "action" to action)
        if (position != null) event["position"] = position.toDouble()
        onAction(event)
    }
    fun setTopInset(value: Double) { top = style.dp(value.toInt()); insets() }
    fun setBottomInset(value: Double) { bottom = style.dp(value.toInt()); insets() }
    private fun insets() { column.setPadding(0, top, 0, bottom); header.setPadding(style.dp(24), style.dp(12), style.dp(24), 0) }
    fun setModel(raw: String) {
        model = JSONObject(raw)
        style.colors = model.optJSONObject("colors") ?: JSONObject()
        val lyrics = model.optString("kind") == "lyrics"
        column.setBackgroundColor(style.surface)
        title.text = model.optString("title"); title.setTextColor(style.text)
        artist.text = model.optString("artist"); artist.setTextColor(style.secondary)
        artist.visibility = if (lyrics) VISIBLE else GONE
        mode.visibility = if (lyrics) VISIBLE else GONE
        mode.text = if (model.optBoolean("karaoke", true)) "KARAOKE" else "STANDARD"
        mode.contentDescription = if (model.optBoolean("karaoke", true)) "Cambiar a letras estándar" else "Cambiar a karaoke"
        mode.setTextColor(style.primary); close.setTextColor(style.primary)
        val loading = model.optBoolean("loading")
        val hasLyrics = model.optBoolean("hasLyrics")
        message.text = if (lyrics) model.optString("message", "No hay lyrics para esta cancion") else "Tu música sigue contigo."
        message.setTextColor(style.text)
        message.visibility = if (!lyrics || (!loading && !hasLyrics)) VISIBLE else GONE
        progress.visibility = if (lyrics && loading) VISIBLE else GONE
        progress.contentDescription = "Cargando letras"
        karaoke.visibility = if (lyrics && hasLyrics && !loading) VISIBLE else GONE
        karaoke.setIsLineByLine(!model.optBoolean("karaoke", true))
        karaoke.setActiveColor(style.text); karaoke.setInactiveColor(style.secondary)
        karaoke.setGlowColor(style.primary); karaoke.setPlayerBackgroundColor(style.surface)
        karaoke.setIntroTitle(model.optString("title")); karaoke.setIntroSubtitle(model.optString("artist"))
        updateActive()
    }
    fun setLyrics(raw: String) {
        if (raw == lastLyrics) return
        lastLyrics = raw
        val array = JSONArray(raw)
        karaoke.setLyrics((0 until array.length()).map { i ->
            val value = array.getJSONObject(i)
            value.keys().asSequence().associateWith { value.get(it) }
        })
    }
    fun position(value: Long) { if (active) karaoke.updateTime((value + model.optLong("offset")).coerceAtLeast(0)) }
    fun setActive(value: Boolean) { active = value; updateActive() }
    private fun updateActive() {
        val render = active && isAttachedToWindow && windowVisibility == View.VISIBLE && karaoke.visibility == View.VISIBLE
        karaoke.setRenderingActive(render)
        karaoke.setIsPlaying(render && model.optBoolean("playing"))
        keepScreenOn = render
    }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); updateActive() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); updateActive() }
    override fun onDetachedFromWindow() { karaoke.setRenderingActive(false); karaoke.setIsPlaying(false); keepScreenOn = false; super.onDetachedFromWindow() }
}
