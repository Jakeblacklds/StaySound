package expo.modules.searchview

import android.content.Context
import android.content.res.ColorStateList
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import org.json.JSONObject

internal class SearchSheets(private val context: Context, private val style: SearchStyle,
    private val emit: (String, String, String) -> Unit) {
    var credentials = emptyMap<String, String>()
    private var settings = JSONObject()
    private var dialog: BottomSheetDialog? = null
    private var kind = ""
    private var legacy = false
    private var content: LinearLayout? = null
    private var scroll: ScrollView? = null
    private var save: MaterialButton? = null
    private var username: TextInputEditText? = null
    private var password: TextInputEditText? = null

    fun setSettings(value: JSONObject) {
        val saved = value.optInt("authRevision") > settings.optInt("authRevision")
        settings = value
        if (saved && kind == "auth") { dismiss(); return }
        if (kind == "auth") updateSaving()
        else if (kind == "mirrors" || kind == "quality") rebuild()
    }
    fun refreshAppearance() { if (kind.isNotBlank() && kind != "auth") rebuild() }
    fun dismiss() { dialog?.dismiss() }
    fun show(next: String) {
        if (kind == next && dialog?.isShowing == true) return
        dismiss()
        kind = next
        val sheet = BottomSheetDialog(context)
        dialog = sheet
        val container = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val body = ScrollView(context).apply { isFillViewport = false; addView(container) }
        content = container; scroll = body
        sheet.setContentView(body)
        sheet.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        sheet.behavior.maxWidth = style.dp(640)
        sheet.setOnDismissListener {
            if (next == "mirrors") emit("mirrorsVisible", "", "false")
            if (dialog === sheet) {
                kind = ""; dialog = null; content = null; scroll = null
                username?.setText(""); password?.setText("")
                username = null; password = null; save = null
            }
        }
        ViewCompat.setOnApplyWindowInsetsListener(body) { view, insets ->
            val bottom = maxOf(insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom,
                insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
            view.setPadding(0, 0, 0, bottom)
            insets
        }
        rebuild()
        sheet.setOnShowListener { sheet.behavior.state = BottomSheetBehavior.STATE_EXPANDED }
        sheet.show()
        ViewCompat.requestApplyInsets(body)
        if (next == "mirrors") emit("mirrorsVisible", "", "true")
    }

    private fun params() = LinearLayout.LayoutParams(-1, -2)
    private fun button(title: String, selected: Boolean = false, action: () -> Unit) = MaterialButton(
        context, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
        text = title; isAllCaps = false; minimumHeight = style.dp(56)
        gravity = Gravity.CENTER_VERTICAL or Gravity.START
        textSize = 15f; typeface = style.font(if (selected) 700 else 500)
        setPadding(style.dp(12), style.dp(10), style.dp(12), style.dp(10))
        setTextColor(style.ink(if (selected) "primary" else "onSurface", "surface"))
        if (selected) {
            setIconResource(R.drawable.search_check)
            iconTint = ColorStateList.valueOf(style.ink("primary", "surface"))
        }
        setOnClickListener { action() }
    }
    private fun option(title: String, description: String = "", selected: Boolean = false,
        enabled: Boolean = true, action: () -> Unit) {
        val item = button(if (description.isEmpty()) title else "$title\n$description", selected, action)
        item.isEnabled = enabled; item.alpha = if (enabled) 1f else 0.5f
        item.contentDescription = "$title. $description" + if (selected) ". Seleccionado" else ""
        content?.addView(item, params())
    }
    private fun rebuild() {
        val container = content ?: return
        val offset = scroll?.scrollY ?: 0
        container.removeAllViews()
        container.setPadding(style.dp(16), style.dp(18), style.dp(16), style.dp(24))
        container.setBackgroundColor(style.color("surface"))
        val header = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        val heading = style.text(22f, 700).apply {
            setTextColor(style.ink("onSurface", "surface")); isAccessibilityHeading = true
            text = when (kind) { "quality" -> "Fidelidad"; "mirrors" -> "Servidores"
                "auth" -> "Conectar Soulseek"; else -> "Ajustes de descarga" }
        }
        header.addView(heading, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button("Cerrar") { dismiss() }, LinearLayout.LayoutParams(-2, -2))
        container.addView(header, params())
        when (kind) {
            "settings" -> {
                option("Calidad de audio", "Formato de los archivos descargados") { show("quality") }
                option("Catálogo de búsqueda", "Automático es lo recomendado") { show("mirrors") }
                option("Sesión Soulseek", "Cambia tus credenciales") { show("auth") }
            }
            "quality" -> {
                listOf(
                    Triple("LOSSLESS", "Lossless (FLAC)", "16 bits · Calidad de CD"),
                    Triple("MP3", "MP3", "320 kbps · Tamaño moderado"),
                    Triple("HI_RES_LOSSLESS", "Hi-Res Lossless (FLAC)", "24 bits · Archivos de mayor tamaño"),
                    Triple("LOW", "Básica (AAC)", "96 kbps · Menor espacio"),
                ).forEach { (id, title, detail) ->
                    option(title, detail, settings.optString("quality") == id) {
                        emit("quality", "", id); dismiss()
                    }
                }
            }
            "mirrors" -> {
                option("Enrutamiento automático", "Alterna servidores si falla la conexión.", settings.optString("mirror") == "auto") {
                    emit("mirror", "", "auto"); dismiss()
                }
                val mirrors = settings.optJSONArray("mirrors")
                fun addMirrors(isLegacy: Boolean) {
                    if (mirrors != null) for (i in 0 until mirrors.length()) {
                        val item = mirrors.optJSONObject(i) ?: continue
                        if (item.optBoolean("legacy") != isLegacy) continue
                        val id = item.optString("id")
                        option(item.optString("title"), item.optString("description"),
                            settings.optString("mirror") == id, item.optBoolean("enabled", true)) {
                            emit("mirror", "", id); dismiss()
                        }
                    }
                }
                addMirrors(false)
                option(if (legacy) "Ocultar otros servidores" else "Mostrar otros servidores") {
                    legacy = !legacy; rebuild()
                }
                if (legacy) addMirrors(true)
            }
            "auth" -> {
                val note = style.text(14f).apply {
                    text = "Configura tu cuenta para descargar música."
                    setTextColor(style.ink("onSurfaceVariant", "surface"))
                    setPadding(style.dp(12), style.dp(4), style.dp(12), style.dp(16))
                }
                container.addView(note, params())
                fun input(label: String, secret: Boolean): TextInputEditText {
                    val field = TextInputLayout(context).apply {
                        hint = label; boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
                        defaultHintTextColor = ColorStateList.valueOf(style.ink("onSurfaceVariant", "surface"))
                        boxStrokeColor = style.color("primary")
                        if (secret) endIconMode = TextInputLayout.END_ICON_PASSWORD_TOGGLE
                    }
                    val edit = TextInputEditText(field.context).apply {
                        setSingleLine(true); textSize = 16f; minimumHeight = style.dp(56)
                        setTextColor(style.ink("onSurface", "surface"))
                        inputType = InputType.TYPE_CLASS_TEXT or if (secret) InputType.TYPE_TEXT_VARIATION_PASSWORD
                            else InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                        imeOptions = if (secret) android.view.inputmethod.EditorInfo.IME_ACTION_DONE
                            else android.view.inputmethod.EditorInfo.IME_ACTION_NEXT
                    }
                    field.addView(edit, params())
                    container.addView(field, params().apply { bottomMargin = style.dp(14) })
                    return edit
                }
                username = input("Usuario", false).apply { setText(credentials["username"].orEmpty()) }
                password = input("Contraseña", true).apply { setText(credentials["password"].orEmpty()) }
                save = MaterialButton(context).apply {
                    isAllCaps = false; minimumHeight = style.dp(48)
                    backgroundTintList = ColorStateList.valueOf(style.color("primary"))
                    setTextColor(style.ink("onPrimary", "primary"))
                    setOnClickListener {
                        val user = username?.text?.toString()?.trim().orEmpty()
                        val secret = password?.text?.toString()?.trim().orEmpty()
                        if (user.isEmpty()) { username?.error = "Escribe tu usuario"; username?.requestFocus(); return@setOnClickListener }
                        if (secret.isEmpty()) { password?.error = "Escribe tu contraseña"; password?.requestFocus(); return@setOnClickListener }
                        isEnabled = false; text = "Guardando…"
                        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)
                            ?.hideSoftInputFromWindow(windowToken, 0)
                        emit("saveCredentials", user, secret)
                    }
                }
                container.addView(save, params())
                password?.setOnEditorActionListener { _, action, _ ->
                    if (action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                        if (save?.isEnabled == true) save?.performClick()
                        true
                    } else false
                }
                updateSaving()
            }
        }
        scroll?.post { scroll?.scrollTo(0, offset) }
    }
    private fun updateSaving() {
        val saving = settings.optBoolean("saving")
        save?.text = if (saving) "Guardando…" else "Guardar credenciales"
        save?.isEnabled = !saving
        username?.isEnabled = !saving; password?.isEnabled = !saving
    }
}
