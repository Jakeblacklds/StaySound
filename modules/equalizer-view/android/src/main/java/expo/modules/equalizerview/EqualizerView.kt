package expo.modules.equalizerview

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.slider.Slider
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class EqualizerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val scroll = ScrollView(ui)
    private val body = LinearLayout(ui)
    private var snapshot = JSONObject()
    private var appearance = emptyMap<String, String>()
    private var topInset = 0
    private var bottomInset = 0
    init {
        orientation = VERTICAL; body.orientation = VERTICAL
        scroll.isFillViewport = true; scroll.addView(body); addView(scroll, LayoutParams(-1, -1)); render()
    }
    fun setSnapshot(value: String) { snapshot = runCatching { JSONObject(value) }.getOrDefault(JSONObject()); render() }
    fun setAppearance(value: Map<String, String>) { appearance = value; render() }
    fun setTopInset(value: Double) { topInset = dp(value.toInt()); render() }
    fun setBottomInset(value: Double) { bottomInset = dp(value.toInt()); render() }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun color(key: String, fallback: Int) = runCatching { Color.parseColor(appearance[key]) }.getOrDefault(fallback)
    private val primary get() = color("primary", Color.rgb(103, 80, 164))
    private val ink get() = color("onSurface", Color.WHITE)
    private val muted get() = color("onSurfaceVariant", Color.LTGRAY)
    private val surface get() = color("surface", Color.rgb(37, 34, 42))
    private fun shape(fill: Int) = GradientDrawable().apply { setColor(fill); cornerRadius = dp(20).toFloat() }
    private fun english() = snapshot.optString("language") == "en"
    private fun label(es: String, en: String) = if (english()) en else es
    private fun text(value: String, size: Float, bold: Boolean = false) = TextView(ui).apply {
        text = value; textSize = size; setTextColor(ink); includeFontPadding = false
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    private fun emit(action: String, value: String = "", id: String = "") { onAction(mapOf("action" to action, "value" to value, "id" to id)) }
    private fun button(title: String, action: () -> Unit): MaterialButton = MaterialButton(ui).apply {
        text = title; contentDescription = title; minimumHeight = dp(48); setOnClickListener { action() }
    }
    private fun section(title: String) { body.addView(text(title, 18f, true).apply { setPadding(0, dp(24), 0, dp(12)) }) }
    private fun render() {
        val previousScrollY = scroll.scrollY
        body.removeAllViews()
        body.setPadding(dp(18), topInset + dp(12), dp(18), bottomInset + dp(28))
        setBackgroundColor(color("background", Color.rgb(20, 18, 24)))
        val toolbar = LinearLayout(ui).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        toolbar.addView(button("‹") { emit("back") }.apply { contentDescription = label("Volver a Ajustes", "Back to Settings") }, LinearLayout.LayoutParams(dp(56), dp(48)))
        toolbar.addView(text(label("Ecualizador", "Equalizer"), 27f, true), LinearLayout.LayoutParams(0, -2, 1f))
        toolbar.addView(button("↻") { emit("refresh") }.apply { contentDescription = label("Actualizar ecualizador", "Refresh equalizer") }, LinearLayout.LayoutParams(dp(56), dp(48)))
        body.addView(toolbar)
        val mode = EqualizerPolicy.mode(snapshot.optString("mode"))
        val attached = snapshot.optBoolean("attached")
        val available = snapshot.optBoolean("available")
        val bands = snapshot.optJSONArray("bands") ?: JSONArray()
        val systemPanel = snapshot.optBoolean("canOpenSystemPanel")
        val status = when {
            !available -> label("Motor Android no disponible", "Android engine unavailable")
            mode == "off" -> label("Apagado", "Off")
            mode == "system" -> label("Controlado por el sistema", "Controlled by the system")
            attached -> label("Listo para reproducir", "Ready for playback")
            else -> label("Reproduce una pista para activar el motor", "Play a track to attach the engine")
        }
        body.addView(text(status, 14f).apply { setTextColor(muted); setPadding(0, dp(10), 0, 0) })
        section(label("Modo", "Mode"))
        val choices = listOf(label("Apagado", "Off"), label("StaySound", "StaySound"), label("Sistema", "System"))
        val modeValues = listOf("off", "app", "system")
        body.addView(button(choices[modeValues.indexOf(mode)]) {
            MaterialAlertDialogBuilder(ui).setTitle(label("Modo del ecualizador", "Equalizer mode"))
                .setSingleChoiceItems(choices.toTypedArray(), modeValues.indexOf(mode)) { dialog, which ->
                    emit("mode", modeValues[which]); dialog.dismiss()
                }.setNegativeButton(label("Cancelar", "Cancel"), null).show()
        })
        if (mode == "system") {
            body.addView(button(label("Abrir ecualizador del sistema", "Open system equalizer")) { emit("systemPanel") }.apply { isEnabled = systemPanel })
        }
        if (mode == "app") {
            section(label("Bandas", "Bands"))
            if (bands.length() == 0) body.addView(text(label("Sin bandas disponibles", "No bands available"), 14f).apply { setTextColor(muted) })
            for (i in 0 until bands.length()) {
                val band = bands.optJSONObject(i) ?: continue
                val index = band.optInt("index", i)
                val hz = band.optDouble("centerHz", 0.0)
                val min = band.optDouble("minLevel", -1500.0).toFloat()
                val max = band.optDouble("maxLevel", 1500.0).toFloat()
                if (min >= max) continue
                val level = EqualizerPolicy.level(band.optDouble("level", 0.0).toFloat(), min, max)
                val card = LinearLayout(ui).apply { orientation = VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(8)); background = shape(surface) }
                val header = LinearLayout(ui).apply { orientation = HORIZONTAL }
                val freq = if (hz >= 1000) String.format(Locale.US, "%.1f kHz", hz / 1000) else "${hz.toInt()} Hz"
                header.addView(text(freq, 15f, true), LinearLayout.LayoutParams(0, -2, 1f))
                val gain = text(String.format(Locale.US, "%+.1f dB", level / 100f), 14f)
                gain.setTextColor(primary); header.addView(gain)
                card.addView(header)
                val slider = Slider(ui).apply {
                    valueFrom = min; valueTo = max; value = level
                    isEnabled = available && attached
                    contentDescription = label("Banda $freq, ganancia", "Band $freq, gain")
                    addOnChangeListener { _, next, fromUser ->
                        if (fromUser) gain.text = String.format(Locale.US, "%+.1f dB", next / 100f)
                    }
                    addOnSliderTouchListener(object : Slider.OnSliderTouchListener {
                        override fun onStartTrackingTouch(slider: Slider) {}
                        override fun onStopTrackingTouch(slider: Slider) {
                            emit("band", EqualizerPolicy.level(slider.value, min, max).toInt().toString(), index.toString())
                        }
                    })
                }
                card.addView(slider)
                body.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
            }
            section(label("Preajustes", "Presets"))
            val presets = snapshot.optJSONArray("presets") ?: JSONArray()
            for (i in 0 until presets.length()) {
                val preset = presets.optJSONObject(i) ?: continue
                val id = preset.optString("id")
                val title = preset.optString("label", id)
                body.addView(button(if (snapshot.optString("presetId") == id) "✓ $title" else title) { emit("preset", id) }.apply {
                    isEnabled = available && attached
                }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
            }
            body.addView(button(label("Restablecer plano", "Reset to flat")) { emit("reset") }.apply { isEnabled = available && attached })
        }
        scroll.post { scroll.scrollTo(0, previousScrollY) }
    }
}
