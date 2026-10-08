package expo.modules.onboardingview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.bumptech.glide.Glide
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.playerchrome.StayIconView
import org.json.JSONArray

/**
 * The first run, one step per screen. A step is laid out once when it is entered and then
 * updated in place, so typing never loses focus to a rebuild.
 */
class OnboardingView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val machine = OnboardingMachine()
    private val main = Handler(Looper.getMainLooper())
    private val root = LinearLayout(context).apply { orientation = VERTICAL }
    private var colors = emptyMap<String, String>()
    private var initialized = false
    private var pendingReplies = "[]"
    private var painted: OnboardingMachine.Step? = null
    private var top = 0
    private var bottom = 0
    private var ime = 0
    private var logoUri = ""
    private val repaint = Runnable { render(true) }

    // The parts of the current step that change without a rebuild.
    private var primary: TextView? = null
    private var secondary: TextView? = null
    private var status: TextView? = null
    private var action: TextView? = null
    private var rows: LinearLayout? = null
    private var meter: Meter? = null
    private var shownResults: Any? = null

    init {
        orientation = VERTICAL
        addView(root, LayoutParams(-1, -1))
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            applyInsets(); insets
        }
    }

    // ── props ────────────────────────────────────────────────────────────────────────────
    fun initialize(value: String) {
        if (initialized) return
        initialized = true; machine.restore(value); machine.enter(); replies(pendingReplies); schedulePaint()
    }
    fun replies(value: String) {
        pendingReplies = value
        if (!initialized) return
        val replies = runCatching { JSONArray(value) }.getOrNull() ?: return
        for (i in 0 until replies.length()) machine.reply(replies.getJSONObject(i))
        render(); publish()
    }
    fun appearance(value: Map<String, String>) { if (colors != value) { colors = value; schedulePaint() } }
    fun logo(value: String) { if (logoUri != value) { logoUri = value; schedulePaint() } }
    fun topInset(value: Double) { top = dp(value.toInt()); applyInsets() }
    fun bottomInset(value: Double) { bottom = dp(value.toInt()); applyInsets() }

    private fun applyInsets() {
        // adjustResize can already shrink the RN host. Pad only the keyboard overlap that
        // remains, rather than subtracting the full IME height a second time.
        val visible = Rect()
        val location = IntArray(2)
        getWindowVisibleDisplayFrame(visible); getLocationOnScreen(location)
        val overlap = if (ime > 0 && height > 0) (location[1] + height - visible.bottom).coerceIn(0, ime) else 0
        root.setPadding(dp(24), top + dp(8), dp(24), maxOf(bottom, overlap) + dp(12))
    }
    private fun schedulePaint() { main.removeCallbacks(repaint); main.post(repaint) }
    private fun publish() {
        if (!isAttachedToWindow || !initialized) return
        val snapshot = machine.snapshot()
        onAction(mapOf("action" to "checkpoint", "id" to 0, "payload" to "{}", "snapshot" to snapshot))
        machine.drainEffects().forEach { effect ->
            onAction(mapOf("action" to effect.action, "id" to effect.id, "payload" to effect.payload.toString(), "snapshot" to snapshot))
        }
    }
    /** Runs a machine transition, then repaints and sends whatever it asked for. */
    private fun act(change: OnboardingMachine.() -> Unit) { machine.change(); render(); publish() }
    private fun hideKeyboard() {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(windowToken, 0)
    }

    // ── style ────────────────────────────────────────────────────────────────────────────
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun color(key: String, fallback: Int) = runCatching { Color.parseColor(colors[key]) }.getOrDefault(fallback)
    private val accent get() = color("primary", 0xFFFFA31A.toInt())
    private val ink get() = color("onSurface", Color.WHITE)
    private val muted get() = color("onSurfaceVariant", 0xFF9A9A9A.toInt())
    private val ground get() = color("background", Color.BLACK)
    private val panel get() = ColorUtils.blendARGB(ground, ink, 0.07f)
    private val onAccent: Int get() {
        val opaque = ColorUtils.setAlphaComponent(accent, 255)
        return if (ColorUtils.calculateContrast(Color.WHITE, opaque) >= ColorUtils.calculateContrast(Color.BLACK, opaque)) Color.WHITE else Color.BLACK
    }
    private fun face(weight: Int) = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, context.assets)
    private fun text(value: String, size: Float, weight: Int = 500, tone: Int = ink) = TextView(context).apply {
        text = value; textSize = size; typeface = face(weight); setTextColor(tone); setLineSpacing(0f, 1.2f)
    }
    private fun pill(value: String, onClick: () -> Unit) = text(value, 16f, 700).apply {
        gravity = Gravity.CENTER; minHeight = dp(54); setPadding(dp(24), 0, dp(24), 0)
        isClickable = true; isFocusable = true; setOnClickListener { onClick() }
    }
    private fun stylePill(view: TextView, enabled: Boolean = true) {
        view.isEnabled = enabled; view.alpha = if (enabled) 1f else 0.4f
        view.setTextColor(onAccent)
        view.background = GradientDrawable().apply { cornerRadius = dp(27).toFloat(); setColor(accent) }
    }
    private fun link(value: String, onClick: () -> Unit) = text(value, 15f, 600, muted).apply {
        gravity = Gravity.CENTER; minHeight = dp(48)
        isClickable = true; isFocusable = true; setOnClickListener { onClick() }
    }
    private fun field(hint: String, value: String, secret: Boolean = false, action: Int = EditorInfo.IME_ACTION_NEXT,
                      onDone: (() -> Unit)? = null, changed: (String) -> Unit) = EditText(context).apply {
        setText(value); this.hint = hint; textSize = 17f; typeface = face(500)
        setTextColor(ink); setHintTextColor(muted); setSingleLine(); minHeight = dp(56)
        setPadding(dp(18), 0, dp(18), 0); imeOptions = action
        inputType = InputType.TYPE_CLASS_TEXT or when {
            secret -> InputType.TYPE_TEXT_VARIATION_PASSWORD
            else -> InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        // The input type resets the face on password fields.
        if (secret) typeface = face(500)
        background = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat(); setColor(panel); setStroke(dp(1), ColorUtils.setAlphaComponent(ink, 40))
        }
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { changed(s.toString()); update() }
            override fun afterTextChanged(s: Editable?) {}
        })
        setOnEditorActionListener { _, id, _ -> if (id == action && onDone != null) { onDone(); true } else false }
    }
    private fun LinearLayout.add(view: View, top: Int = 0, height: Int = -2) =
        addView(view, LinearLayout.LayoutParams(-1, height).apply { topMargin = dp(top) })

    // ── layout ───────────────────────────────────────────────────────────────────────────
    private fun render(force: Boolean = false) {
        if (!initialized) return
        if (!force && painted == machine.step) { update(); return }
        painted = machine.step
        primary = null; secondary = null; status = null; action = null; rows = null; meter = null; shownResults = null
        hideKeyboard()
        root.removeAllViews()
        setBackgroundColor(ground)

        val bar = FrameLayout(context)
        if (machine.step != OnboardingMachine.Step.welcome) {
            val back = FrameLayout(context).apply {
                isClickable = true; isFocusable = true; contentDescription = "Volver al paso anterior"
                addView(StayIconView(context, "back").apply { ink = this@OnboardingView.ink },
                    FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
                setOnClickListener { act { back() } }
            }
            bar.addView(back, FrameLayout.LayoutParams(dp(48), dp(48)).apply { marginStart = dp(-12) })
            val position = machine.step.ordinal
            bar.addView(text("$position de 4", 13f, 600, muted), FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_VERTICAL or Gravity.END))
        }
        root.addView(bar, LinearLayout.LayoutParams(-1, dp(48)))

        val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(12), 0, dp(24)) }
        root.addView(ScrollView(context).apply { isFillViewport = true; addView(body) }, LinearLayout.LayoutParams(-1, 0, 1f))
        val footer = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        root.addView(footer, LinearLayout.LayoutParams(-1, -2))

        fun heading(value: String) = body.add(text(value, 32f, 800).apply {
            letterSpacing = -0.02f; setLineSpacing(0f, 1.05f); ViewCompat.setAccessibilityHeading(this, true)
        })
        fun paragraph(value: String, top: Int = 12) = body.add(text(value, 16f, 500, muted), top)

        when (machine.step) {
            OnboardingMachine.Step.welcome -> {
                val logo = ImageView(context).apply { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
                body.addView(logo, LinearLayout.LayoutParams(dp(84), dp(84)).apply { topMargin = dp(8); bottomMargin = dp(20) })
                if (logoUri.isNotEmpty()) Glide.with(context.applicationContext).load(logoUri).into(logo)
                heading("Tu música, sin nube")
                paragraph("StaySound guarda tu biblioteca en el teléfono y enciende la letra palabra por palabra.")
                body.add(field("¿Cómo te llamas? (opcional)", machine.name, action = EditorInfo.IME_ACTION_DONE,
                    onDone = { hideKeyboard() }) { machine.name = it }.apply {
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
                }, 28, dp(56))
                paragraph("Para conseguir música nueva, StaySound busca en Soulseek, una red donde las personas comparten " +
                    "sus archivos. No es infalible: a veces una canción no aparece o una descarga falla.", 20)
                primary = pill("Empezar") { act { advance() } }
            }
            OnboardingMachine.Step.music -> {
                heading("La música que ya tienes")
                paragraph("Si guardas canciones en el teléfono, StaySound puede mostrarlas en tu biblioteca. Solo lee los archivos de audio.")
                status = text("", 15f, 600).also { body.add(it, 24) }
                action = pill("Permitir acceso a mi música") { act { requestPermission() } }.also { body.add(it, 12, dp(54)) }
                paragraph("Lo que descargues desde StaySound se guarda dentro de la app y aparece en tu biblioteca. " +
                    "Si desinstalas StaySound, esas descargas se borran con ella.", 24)
                primary = pill("Continuar") { act { advance() } }
            }
            OnboardingMachine.Step.account -> {
                heading("Tu cuenta de Soulseek")
                paragraph("Las descargas pasan por Soulseek. Entra con tu cuenta o escribe un usuario y una contraseña nuevos: " +
                    "Soulseek la crea la primera vez que entras.")
                body.add(field("Usuario", machine.username) { machine.username = it }, 24, dp(56))
                body.add(field("Contraseña", "", secret = true, action = EditorInfo.IME_ACTION_DONE,
                    onDone = { hideKeyboard(); act { if (canSave) saveAccount() } }) { machine.password = it }, 12, dp(56))
                status = text("", 14f, 600).also { body.add(it, 14) }
                primary = pill("") { hideKeyboard(); act { if (connected && password.isEmpty()) advance() else saveAccount() } }
                secondary = link("Ahora no") { act { skip() } }
            }
            OnboardingMachine.Step.tryIt -> {
                heading("Prueba con una canción")
                paragraph("Busca algo que te guste y descárgalo. Así ves cómo funciona antes de entrar.")
                body.add(field("Canción o artista", machine.query, action = EditorInfo.IME_ACTION_SEARCH,
                    onDone = { hideKeyboard(); act { search() } }) { machine.query = it }, 24, dp(56))
                action = pill("Buscar") { hideKeyboard(); act { search() } }.also { body.add(it, 12, dp(54)) }
                status = text("", 14f, 600).also { body.add(it, 16) }
                meter = Meter(context).also { body.add(it, 10, dp(4)) }
                rows = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }.also { body.add(it, 8) }
                primary = pill("Continuar") { act { advance() } }
                secondary = link("Saltar por ahora") { act { skip() } }
            }
            OnboardingMachine.Step.ready -> {
                heading("Todo listo")
                paragraph("En la pestaña Buscar encuentras canciones, álbumes y artistas. Toca el icono de descarga y la canción llega a tu biblioteca.")
                paragraph("Si una descarga falla o tarda, prueba otra versión de la misma canción o inténtalo más tarde: depende de quién esté conectado.", 16)
                paragraph("La cuenta, la calidad y lo demás se cambian en los ajustes de descarga, arriba a la derecha en Buscar.", 16)
                primary = pill("Entrar a StaySound") { act { finish() } }
            }
        }
        primary?.let { footer.add(it, 0, dp(54)) }
        secondary?.let { footer.add(it, 4, dp(48)) }
        applyInsets()
        update()
    }

    /** Everything that changes inside a step: labels, enabled states, results and progress. */
    private fun update() {
        val step = painted ?: return
        primary?.let { stylePill(it, !machine.finishing) }
        when (step) {
            OnboardingMachine.Step.music -> {
                status?.text = if (machine.granted) "Listo. StaySound ya puede leer tu música." else "Todavía no tiene permiso."
                status?.setTextColor(if (machine.granted) accent else muted)
                action?.visibility = if (machine.granted) View.GONE else View.VISIBLE
                action?.let { stylePill(it) }
            }
            OnboardingMachine.Step.account -> {
                val stored = machine.connected && machine.password.isEmpty()
                primary?.text = when { machine.saving -> "Guardando…"; stored -> "Continuar"; else -> "Guardar y continuar" }
                primary?.let { stylePill(it, stored || machine.canSave) }
                status?.text = when {
                    machine.accountError.isNotEmpty() -> machine.accountError
                    stored -> "Ya hay una cuenta guardada. Puedes continuar o escribir otra."
                    else -> ""
                }
                status?.setTextColor(if (machine.accountError.isNotEmpty()) color("error", 0xFFFF6B5E.toInt()) else muted)
                secondary?.visibility = if (machine.connected) View.GONE else View.VISIBLE
            }
            OnboardingMachine.Step.tryIt -> updateTrial()
            OnboardingMachine.Step.ready -> primary?.text = if (machine.finishing) "Entrando…" else "Entrar a StaySound"
            OnboardingMachine.Step.welcome -> {}
        }
    }

    private fun updateTrial() {
        val running = machine.transfer == OnboardingMachine.Transfer.running
        val done = machine.transfer == OnboardingMachine.Transfer.done
        action?.let { it.text = if (machine.searching) "Buscando…" else "Buscar"; stylePill(it, machine.canSearch) }
        status?.text = when {
            done -> "Listo. La canción ya está en tu biblioteca."
            running -> "Descargando… ${machine.progress}%"
            machine.transfer == OnboardingMachine.Transfer.failed ->
                "No se pudo descargar: ${machine.transferError.ifEmpty { "la otra persona no respondió" }}. Prueba con otro resultado."
            machine.searching -> "Buscando en Soulseek. Puede tardar unos segundos."
            machine.searchError.isNotEmpty() -> machine.searchError
            machine.searched && machine.results.isEmpty() -> "No apareció nada. Prueba con otro título o añade el artista."
            machine.results.isNotEmpty() -> "Toca una para descargarla."
            else -> ""
        }
        status?.setTextColor(when {
            done -> accent
            machine.transfer == OnboardingMachine.Transfer.failed || machine.searchError.isNotEmpty() -> color("error", 0xFFFF6B5E.toInt())
            else -> muted
        })
        meter?.let { it.tint = accent; it.rest = panel; it.fraction = if (running || done) machine.progress / 100f else 0f
            it.visibility = if (running || done) View.VISIBLE else View.INVISIBLE }
        primary?.let { stylePill(it, !running) }
        secondary?.visibility = if (done || running) View.GONE else View.VISIBLE

        val container = rows ?: return
        val key = Triple(machine.results, machine.transferId, machine.transfer)
        if (shownResults == key) return
        shownResults = key
        container.removeAllViews()
        machine.results.take(6).forEach { found ->
            val chosen = found.id == machine.transferId && machine.transfer != OnboardingMachine.Transfer.idle
            val row = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64)
                isClickable = !running; isFocusable = !running; alpha = if (running && !chosen) 0.4f else 1f
                contentDescription = "Descargar ${found.title}, ${found.artist}"
                setOnClickListener { act { download(found) } }
            }
            val copy = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            copy.addView(text(found.title, 16f, 700, if (chosen) accent else ink).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            copy.addView(text(listOf(found.artist, found.detail).filter { it.isNotBlank() }.joinToString(" · "), 13f, 500, muted)
                .apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            row.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(StayIconView(context, if (chosen && done) "check" else "download").apply { ink = if (chosen) accent else muted },
                LinearLayout.LayoutParams(dp(24), dp(24)).apply { marginStart = dp(12) })
            container.addView(row, LinearLayout.LayoutParams(-1, -2))
            container.addView(View(context).apply { setBackgroundColor(ColorUtils.setAlphaComponent(ink, 26)) },
                LinearLayout.LayoutParams(-1, 1))
        }
    }

    /** A hairline progress bar. */
    private class Meter(context: Context) : View(context) {
        var tint = Color.WHITE
        var rest = Color.DKGRAY
        var fraction = 0f
            set(value) { field = value.coerceIn(0f, 1f); invalidate() }
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(canvas: Canvas) {
            val radius = height / 2f
            paint.color = rest
            canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), radius, radius, paint)
            paint.color = tint
            canvas.drawRoundRect(0f, 0f, width * fraction, height.toFloat(), radius, radius, paint)
        }
    }
}
