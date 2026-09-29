package expo.modules.settingsview

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject

class SettingsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val scroll = ScrollView(ui)
    private val body = LinearLayout(ui)
    private var snapshot = JSONObject()
    private var appearance = emptyMap<String, String>()
    private var topInset = 0
    private var bottomInset = 0
    private val colors = listOf("#6750A4", "#006A6A", "#0061A4", "#3D662F", "#B3261E", "#984061", "#625D39", "#005AC1")

    init {
        orientation = VERTICAL
        body.orientation = VERTICAL
        scroll.isFillViewport = true
        scroll.addView(body)
        addView(scroll, LayoutParams(-1, -1))
        render()
    }
    fun setSnapshot(value: String) { snapshot = runCatching { JSONObject(value) }.getOrDefault(JSONObject()); render() }
    // render() rebuilds the page, so the palette eases at ~15 fps rather than every frame.
    private val appearanceTween = expo.modules.playerchrome.AppearanceTween(this, frameMs = 64) { appearance = it; render() }
    fun setAppearance(value: Map<String, String>) = appearanceTween.set(value)
    fun setTopInset(value: Double) { topInset = dp(value.toInt()); render() }
    fun setBottomInset(value: Double) { bottomInset = dp(value.toInt()); render() }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun color(key: String, fallback: Int): Int = runCatching { Color.parseColor(appearance[key]) }.getOrDefault(fallback)
    private val primary get() = color("primary", Color.rgb(103, 80, 164))
    private val ink get() = color("onSurface", Color.rgb(240, 236, 245))
    private val muted get() = color("onSurfaceVariant", Color.rgb(190, 185, 198))
    private val surface get() = color("surface", Color.rgb(37, 34, 42))
    private fun text(value: String, size: Float, bold: Boolean = false) = TextView(ui).apply {
        text = value; textSize = size; setTextColor(ink)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        includeFontPadding = false
    }
    private fun shape(fill: Int, radius: Int = 20) = GradientDrawable().apply { setColor(fill); cornerRadius = dp(radius).toFloat() }
    private fun emit(action: String, value: String = "", id: String = "") { onAction(mapOf("action" to action, "value" to value, "id" to id)) }
    private fun isEnglish() = snapshot.optString("language") == "en"
    private fun label(es: String, en: String) = if (isEnglish()) en else es
    private fun section(title: String) {
        body.addView(text(title, 14f, true).apply { setTextColor(primary); setPadding(0, dp(26), 0, dp(12)) })
    }
    private fun row(title: String, detail: String = "", enabled: Boolean = true, action: () -> Unit) {
        val holder = LinearLayout(ui).apply {
            orientation = VERTICAL; minimumHeight = dp(62); gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12)); background = shape(surface)
            isEnabled = enabled; alpha = if (enabled) 1f else .5f
            isClickable = enabled; isFocusable = enabled; contentDescription = "$title. $detail"
            setOnClickListener { action() }
        }
        holder.addView(text(title, 16f, true))
        if (detail.isNotBlank()) holder.addView(text(detail, 13f).apply { setTextColor(muted); setPadding(0, dp(3), 0, 0) })
        body.addView(holder, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
    }
    private fun toggle(title: String, detail: String, checked: Boolean, action: String, id: String = "", enabled: Boolean = true) {
        val holder = LinearLayout(ui).apply {
            orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(12), dp(8)); background = shape(surface)
        }
        val caption = LinearLayout(ui).apply { orientation = VERTICAL }
        caption.addView(text(title, 16f, true))
        caption.addView(text(detail, 13f).apply { setTextColor(muted) })
        holder.addView(caption, LinearLayout.LayoutParams(0, -2, 1f))
        holder.addView(MaterialSwitch(ui).apply {
            isChecked = checked; isEnabled = enabled; contentDescription = title; minimumHeight = dp(48)
            thumbTintList = ColorStateList.valueOf(primary)
            setOnCheckedChangeListener { _, value -> emit(action, value.toString(), id) }
        })
        body.addView(holder, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
    }
    private fun choose(title: String, names: List<String>, values: List<String>, selected: String, action: String) {
        MaterialAlertDialogBuilder(ui).setTitle(title).setSingleChoiceItems(names.toTypedArray(), values.indexOf(selected)) { dialog, which ->
            emit(action, values[which]); dialog.dismiss()
        }.setNegativeButton(label("Cancelar", "Cancel"), null).show()
    }
    private fun edit(title: String, hint: String, initial: String, action: String) {
        val input = EditText(ui).apply { setText(initial); this.hint = hint; setSingleLine(true); setPadding(dp(24), dp(16), dp(24), dp(16)) }
        MaterialAlertDialogBuilder(ui).setTitle(title).setView(input)
            .setPositiveButton(label("Guardar", "Save")) { _, _ ->
                val value = input.text.toString()
                when (action) {
                    "accentColor" -> {
                        val normalized = SettingsPolicy.color(value)
                        if (normalized != null) emit(action, normalized)
                        else MaterialAlertDialogBuilder(ui).setMessage(label("Introduce un color HEX válido, por ejemplo #6750A4.", "Enter a valid HEX color, such as #6750A4.")).setPositiveButton("OK", null).show()
                    }
                    "spectrumDelay" -> emit(action, SettingsPolicy.spectrumDelay(value).toString())
                    else -> emit(action, value)
                }
            }
            .setNegativeButton(label("Cancelar", "Cancel"), null).show()
    }
    private fun soulseekDialog() {
        val box = LinearLayout(ui).apply { orientation = VERTICAL; setPadding(dp(24), dp(8), dp(24), 0) }
        val username = EditText(ui).apply { hint = label("Usuario", "Username"); setSingleLine(true); setText(snapshot.optString("soulseekUser")) }
        val password = EditText(ui).apply { hint = label("Contraseña", "Password"); inputType = 129; setSingleLine(true) }
        box.addView(username); box.addView(password)
        MaterialAlertDialogBuilder(ui).setTitle("Soulseek").setView(box)
            .setPositiveButton(label("Guardar", "Save")) { _, _ ->
                onAction(mapOf("action" to "soulseek", "value" to username.text.toString(), "id" to password.text.toString()))
            }.setNegativeButton(label("Cancelar", "Cancel"), null).show()
    }
    private fun render() {
        val previousScrollY = scroll.scrollY
        body.removeAllViews()
        body.setPadding(dp(18), topInset + dp(16), dp(18), bottomInset + dp(28))
        setBackgroundColor(color("background", Color.rgb(20, 18, 24)))
        body.addView(text(label("Ajustes", "Settings"), 32f, true).apply { setPadding(0, 0, 0, dp(8)) })
        row(snapshot.optString("userName", label("Tu perfil", "Your profile")), label("Editar nombre", "Edit name")) {
            edit(label("Nombre", "Name"), label("Tu nombre", "Your name"), snapshot.optString("userName"), "name")
        }
        row(label("Foto de perfil", "Profile photo"), label("Elegir de la galería", "Choose from gallery")) { emit("avatar") }

        section(label("Idioma", "Language"))
        row(label("Idioma de la app", "App language"), if (isEnglish()) "English" else "Español") {
            choose(label("Idioma", "Language"), listOf("Español", "English"), listOf("es", "en"), SettingsPolicy.language(snapshot.optString("language")), "language")
        }
        section(label("Personalización", "Appearance"))
        row(label("Tema", "Theme"), snapshot.optString("mode", "system")) {
            choose(label("Tema", "Theme"), listOf(label("Sistema", "System"), label("Claro", "Light"), label("Oscuro", "Dark")), listOf("system", "light", "dark"), SettingsPolicy.themeMode(snapshot.optString("mode")), "mode")
        }
        toggle(label("Color dinámico", "Dynamic color"), label("Colores basados en tu música", "Colors based on your music"), snapshot.optBoolean("dynamicColors"), "dynamicColors")
        toggle(label("Modo ligero", "Lightweight mode"), label("Optimiza para dispositivos lentos", "Optimizes for slower devices"), snapshot.optBoolean("lightweightMode"), "lightweightMode")
        row(label("Visualización de audio", "Audio visualization"), snapshot.optString("spectrumTheme")) {
            val themes = listOf("columns", "aurora", "caustics", "waveformArc", "refractionVeil")
            val titles = listOf(label("Columnas", "Columns"), "Aurora", label("Cáusticas", "Caustics"), label("Arco de onda", "Waveform arc"), label("Refracción", "Refraction"))
            choose(label("Visualización de audio", "Audio visualization"), titles, themes, snapshot.optString("spectrumTheme"), "spectrumTheme")
        }
        row(label("Sincronización del espectro", "Spectrum sync"), "${snapshot.optInt("spectrumDelayMs")} ms") {
            edit(label("Retardo del espectro (0–650 ms)", "Spectrum delay (0–650 ms)"), "ms", snapshot.optInt("spectrumDelayMs").toString(), "spectrumDelay")
        }
        if (!snapshot.optBoolean("dynamicColors")) {
            row(label("Color de acento", "Accent color"), snapshot.optString("accentColor")) {
                val names = colors + listOf(label("Personalizado…", "Custom…"))
                MaterialAlertDialogBuilder(ui).setTitle(label("Color de acento", "Accent color"))
                    .setItems(names.toTypedArray()) { _, index ->
                        if (index < colors.size) emit("accentColor", colors[index])
                        else edit(label("Color HEX", "HEX color"), "#6750A4", snapshot.optString("accentColor"), "accentColor")
                    }.show()
            }
        }
        section(label("Audio y biblioteca", "Audio and library"))
        row(label("Ecualizador", "Equalizer"), snapshot.optString("equalizerSummary")) { emit("equalizer") }
        val trackCount = snapshot.optInt("trackCount")
        row(label("Biblioteca de música", "Music library"), label("$trackCount pistas · escanear", "$trackCount tracks · scan"), !snapshot.optBoolean("busy")) { emit("scan") }
        row(label("Reparar metadata", "Repair metadata"), label("Completar datos faltantes", "Fill missing details"), !snapshot.optBoolean("busy")) { emit("repair") }
        row(label("Buscar artwork en TIDAL", "Find artwork on TIDAL"), label("Completar portadas faltantes", "Fill missing covers"), !snapshot.optBoolean("busy")) { emit("hydrate") }

        section(label("TIDAL y Soulseek", "TIDAL and Soulseek"))
        row(label("Calidad de descarga", "Download quality"), SettingsPolicy.quality(snapshot.optString("quality"))) {
            choose(label("Calidad de audio", "Audio quality"), SettingsPolicy.qualities, SettingsPolicy.qualities,
                SettingsPolicy.quality(snapshot.optString("quality")), "quality")
        }
        val mirrors = snapshot.optJSONArray("mirrors") ?: JSONArray()
        val mirrorValues = (0 until mirrors.length()).map { mirrors.optJSONObject(it)?.optString("url").orEmpty() }.filter { it.isNotBlank() }
        val mirrorNames = (0 until mirrors.length()).map { mirrors.optJSONObject(it)?.optString("label").orEmpty() }.filter { it.isNotBlank() }
        row(label("Mirror TIDAL", "TIDAL mirror"), snapshot.optString("mirrorLabel", "Auto")) {
            choose(label("Servidor TIDAL", "TIDAL server"), listOf(label("Automático", "Automatic")) + mirrorNames,
                listOf("auto") + mirrorValues, SettingsPolicy.mirror(snapshot.optString("mirror"), mirrorValues), "mirror")
        }
        row("Soulseek", snapshot.optString("soulseekUser", label("Configurar cuenta", "Set up account"))) { soulseekDialog() }

        section(label("Letras", "Lyrics"))
        val sources = snapshot.optJSONArray("lyricsSources") ?: JSONArray()
        for (i in 0 until sources.length()) {
            val source = sources.optJSONObject(i) ?: continue
            toggle(source.optString("label"), label("Fuente de letras", "Lyrics source"), source.optBoolean("enabled"), "lyricsSource", source.optString("id"),
                !source.optBoolean("enabled") || (0 until sources.length()).count { sources.optJSONObject(it)?.optBoolean("enabled") == true } > 1)
        }
        val fonts = snapshot.optJSONArray("lyricsFonts") ?: JSONArray()
        val fontNames = (0 until fonts.length()).map { fonts.optJSONObject(it)?.optString("label").orEmpty() }
        val fontIds = (0 until fonts.length()).map { fonts.optJSONObject(it)?.optString("id").orEmpty() }
        row(label("Tipografía de letras", "Lyrics font"), snapshot.optString("lyricsFont")) {
            choose(label("Tipografía", "Font"), fontNames, fontIds, snapshot.optString("lyricsFont"), "lyricsFont")
        }
        section(label("Actualización", "Updates"))
        val update = snapshot.optJSONObject("update") ?: JSONObject()
        val state = SettingsPolicy.updateState(update.optBoolean("enabled"), update.optBoolean("otaReady"), update.optString("binaryVersion"), update.optString("status"), update.optString("error"))
        val updateDetail = when (state) {
            "release-only" -> label("Disponible en la versión release", "Available in the release build")
            "ota-ready" -> label("Actualización lista · reiniciar", "Update ready · restart")
            "binary-ready" -> label("Nueva versión ${update.optString("binaryVersion")}", "New version ${update.optString("binaryVersion")}")
            "checking" -> label("Buscando…", "Checking…")
            "downloading" -> label("Descargando…", "Downloading…")
            "installing" -> label("Preparando instalación…", "Preparing installation…")
            "awaiting-install-permission" -> label("Permite instalar APKs y vuelve a tocar", "Allow APK installation and tap again")
            "error" -> update.optString("error")
            else -> label("Instalada ${update.optString("installedVersion")}", "Installed ${update.optString("installedVersion")}")
        }
        row(label("Actualización APK", "APK update"), updateDetail, state !in listOf("release-only", "checking", "downloading", "installing")) { emit("update") }
        body.addView(text("StaySound ${update.optString("installedVersion")}", 12f).apply { setTextColor(muted); gravity = Gravity.CENTER; setPadding(0, dp(20), 0, 0) })
        scroll.post { scroll.scrollTo(0, previousScrollY) }
    }
}
