package expo.modules.equalizerview

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.playerchrome.StayIconView
import org.json.JSONArray
import org.json.JSONObject

/**
 * The equalizer screen. Built once and updated in place: a new snapshot only restyles what
 * changed, so dragging a band never tears the screen down under the finger.
 */
class EqualizerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private var snapshot = JSONObject()
    private var appearance = emptyMap<String, String>()
    private var presetSignature = ""

    private val scroll = ScrollView(context)
    private val body = LinearLayout(context).apply { orientation = VERTICAL }
    private val backIcon = StayIconView(context, "back")
    private val back = FrameLayout(context).apply {
        isClickable = true; isFocusable = true
        addView(backIcon, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
        setOnClickListener { emit("back") }
    }
    private val title = label(28f, 800)
    private val status = label(14f, 500)
    private val modes = LinearLayout(context).apply { orientation = HORIZONTAL }
    private val modeChips = MODES.map { mode -> chip { emit("mode", mode) } }
    private val curve = EqualizerBandsView(context)
    private val presetsTitle = label(18f, 700)
    private val presetScroll = HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false }
    private val presets = LinearLayout(context).apply { orientation = HORIZONTAL }
    private val systemPanel = chip { emit("systemPanel") }
    private val note = label(13f, 500)

    init {
        orientation = VERTICAL
        body.setPadding(dp(20), dp(8), dp(20), dp(28))
        val toolbar = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        toolbar.addView(back, LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginStart = dp(-12) })
        toolbar.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
        body.addView(toolbar)
        body.addView(status, margins(top = 6))
        modeChips.forEach { modes.addView(it, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(8) }) }
        body.addView(modes, margins(top = 22))
        body.addView(curve, LinearLayout.LayoutParams(-1, dp(300)).apply { topMargin = dp(18) })
        body.addView(presetsTitle, margins(top = 18))
        presetScroll.addView(presets)
        body.addView(presetScroll, margins(top = 12))
        body.addView(systemPanel, LinearLayout.LayoutParams(-2, dp(48)).apply { topMargin = dp(24) })
        body.addView(note, margins(top = 20))
        scroll.isFillViewport = true
        scroll.addView(body)
        addView(scroll, LayoutParams(-1, -1))

        curve.onLevel = { band, done ->
            // The ear gets the change straight from the engine while the finger moves;
            // JS hears about it once, on release, to persist it.
            val level = band.level.toInt()
            EqualizerEngine.io.execute { EqualizerEngine.setBandLevel(context.applicationContext, band.index, level) }
            if (done) emit("band", level.toString(), band.index.toString())
        }
        update()
    }

    fun setSnapshot(value: String) { snapshot = runCatching { JSONObject(value) }.getOrDefault(JSONObject()); update() }
    fun setAppearance(value: Map<String, String>) { appearance = value; presetSignature = ""; update() }
    fun setTopInset(value: Double) { body.setPadding(dp(20), dp(value.toInt()) + dp(8), dp(20), body.paddingBottom) }
    fun setBottomInset(value: Double) { body.setPadding(dp(20), body.paddingTop, dp(20), dp(value.toInt()) + dp(28)) }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun margins(top: Int) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }
    private fun color(key: String, fallback: Int) = runCatching { Color.parseColor(appearance[key]) }.getOrDefault(fallback)
    private val primary get() = color("primary", 0xFFFFA31A.toInt())
    private val ink get() = color("onSurface", Color.WHITE)
    private val muted get() = color("onSurfaceVariant", 0xFF9A9A9A.toInt())
    private val background get() = color("background", Color.BLACK)
    private val onPrimary: Int get() {
        val opaque = ColorUtils.setAlphaComponent(primary, 255)
        return if (ColorUtils.calculateContrast(Color.WHITE, opaque) >= ColorUtils.calculateContrast(Color.BLACK, opaque)) Color.WHITE else Color.BLACK
    }
    private fun face(weight: Int) = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, context.assets)
    private fun label(size: Float, weight: Int) = TextView(context).apply {
        textSize = size; includeFontPadding = false; typeface = face(weight)
    }
    private fun chip(action: () -> Unit) = label(15f, 700).apply {
        gravity = Gravity.CENTER; minHeight = dp(48); setPadding(dp(18), 0, dp(18), 0)
        isClickable = true; isFocusable = true; setOnClickListener { action() }
    }
    private fun styleChip(view: TextView, selected: Boolean) {
        view.isSelected = selected
        view.setTextColor(if (selected) onPrimary else ink)
        view.background = GradientDrawable().apply {
            cornerRadius = dp(24).toFloat()
            if (selected) setColor(primary) else setStroke(dp(1), ColorUtils.setAlphaComponent(ink, 46))
        }
    }
    private fun english() = snapshot.optString("language") == "en"
    private fun text(es: String, en: String) = if (english()) en else es
    private fun emit(action: String, value: String = "", id: String = "") { onAction(mapOf("action" to action, "value" to value, "id" to id)) }

    private fun update() {
        setBackgroundColor(background)
        val mode = EqualizerPolicy.mode(snapshot.optString("mode"))
        val attached = snapshot.optBoolean("attached")
        val available = snapshot.optBoolean("available")

        backIcon.ink = ink
        back.contentDescription = text("Volver a Ajustes", "Back to Settings")
        title.text = text("Ecualizador", "Equalizer"); title.setTextColor(ink)
        status.setTextColor(muted)
        status.text = when {
            !available -> text("Este dispositivo no ofrece ecualizador.", "This device has no equalizer.")
            mode == "off" -> text("Apagado. El sonido sale tal cual.", "Off. Audio plays untouched.")
            mode == "system" -> text("Lo controla el ecualizador de tu teléfono.", "Your phone's own equalizer is in charge.")
            attached -> text("Activo en lo que está sonando.", "Active on what is playing.")
            else -> text("Se aplicará en cuanto suene una pista.", "It will apply as soon as a track plays.")
        }

        val names = listOf(text("Apagado", "Off"), "StaySound", text("Sistema", "System"))
        modeChips.forEachIndexed { position, chip ->
            chip.text = names[position]
            chip.isEnabled = available
            styleChip(chip, MODES[position] == mode)
        }

        val app = mode == "app" && available
        curve.visibility = if (app) View.VISIBLE else View.GONE
        presetsTitle.visibility = curve.visibility
        presetScroll.visibility = curve.visibility
        if (app) {
            curve.accent = primary; curve.ink = ink; curve.muted = muted; curve.typeface = face(700)
            curve.bands = readBands(snapshot.optJSONArray("bands") ?: JSONArray())
            curve.contentDescription = text("Curva del ecualizador, ${curve.bands.size} bandas", "Equalizer curve, ${curve.bands.size} bands")
            presetsTitle.text = text("Preajustes", "Presets"); presetsTitle.setTextColor(ink)
            updatePresets(snapshot.optJSONArray("presets") ?: JSONArray(), snapshot.optString("presetId"))
        }

        systemPanel.visibility = if (mode == "system") View.VISIBLE else View.GONE
        systemPanel.text = text("Abrir el ecualizador del teléfono", "Open the phone's equalizer")
        systemPanel.isEnabled = snapshot.optBoolean("canOpenSystemPanel")
        systemPanel.alpha = if (systemPanel.isEnabled) 1f else 0.4f
        styleChip(systemPanel, true)

        note.setTextColor(muted)
        note.text = text(
            "El ecualizador usa el motor de audio de Android: las bandas y su alcance dependen de tu teléfono.",
            "The equalizer uses Android's audio engine: the bands and their range depend on your phone.",
        )
    }

    private fun readBands(source: JSONArray): List<EqBand> {
        val held = curve.dragging.takeIf { it >= 0 }?.let { curve.bands.getOrNull(it) }
        return (0 until source.length()).mapNotNull { position ->
            val band = source.optJSONObject(position) ?: return@mapNotNull null
            val min = band.optDouble("minLevel", -1500.0).toFloat()
            val max = band.optDouble("maxLevel", 1500.0).toFloat()
            if (min >= max) return@mapNotNull null
            val index = band.optInt("index", position)
            // A snapshot that lands mid-drag is older than the finger; the finger wins.
            if (held != null && held.index == index) return@mapNotNull held
            EqBand(index, band.optDouble("centerHz", 0.0), min, max, EqualizerPolicy.level(band.optDouble("level", 0.0).toFloat(), min, max))
        }
    }

    private fun updatePresets(source: JSONArray, selected: String) {
        val signature = source.toString()
        if (signature != presetSignature) {
            presetSignature = signature
            presets.removeAllViews()
            for (position in 0 until source.length()) {
                val preset = source.optJSONObject(position) ?: continue
                val id = preset.optString("id")
                presets.addView(chip { emit("preset", id) }.apply { text = preset.optString("label", id); tag = id },
                    LinearLayout.LayoutParams(-2, dp(48)).apply { marginEnd = dp(8) })
            }
        }
        for (position in 0 until presets.childCount) {
            val chip = presets.getChildAt(position) as TextView
            styleChip(chip, chip.tag == selected)
        }
    }

    private companion object { val MODES = listOf("off", "app", "system") }
}
