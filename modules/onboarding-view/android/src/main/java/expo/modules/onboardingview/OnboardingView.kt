package expo.modules.onboardingview

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.appcompat.view.ContextThemeWrapper
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.facebook.react.common.assets.ReactFontManager
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.progressindicator.CircularProgressIndicator
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray

class OnboardingView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val machine = OnboardingMachine()
    private val main = Handler(Looper.getMainLooper())
    private val root = column()
    private var colors = emptyMap<String, String>()
    private var words = emptyMap<String, String>()
    private var initialized = false
    private var pendingReplies = "[]"
    private var painted: OnboardingMachine.Step? = null
    private var top = 0
    private var bottom = 0
    private var ime = 0
    private var light = false
    private var logoUri = ""
    private var nextButton: MaterialButton? = null
    private var avatarImage: ImageView? = null
    private var permissionText: TextView? = null
    private var permissionButton: MaterialButton? = null
    private var counter: TextView? = null
    private var hint: TextView? = null
    private var errorText: TextView? = null
    private var section: TextView? = null
    private var spinner: CircularProgressIndicator? = null
    private var chips: LinearLayout? = null
    private var results: RecyclerView? = null
    private val cards = ArtistCards()
    private var displayedAvatar: String? = null
    private val searchTask = Runnable { machine.searchNow(); update(); publish() }
    private val repaint = Runnable { render(true) }
    init {
        orientation = VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        addView(root, LayoutParams(-1, -1).apply { gravity = Gravity.CENTER_HORIZONTAL })
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            applyInsets(); insets
        }
    }
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun color(key: String, fallback: Int = Color.BLACK) = runCatching { Color.parseColor(colors[key]) }.getOrDefault(fallback)
    private fun label(key: String) = words[key].orEmpty()
    private fun column() = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
    private fun text(value: String, size: Float = 16f, bold: Boolean = false) = TextView(ui).apply {
        text = value; textSize = size; setTextColor(color("onSurface"))
        typeface = ReactFontManager.getInstance().getTypeface("StaySound", if (bold) 700 else 500, false, context.assets)
        setPadding(0, dp(8), 0, dp(8))
    }
    private fun title(value: String, size: Float = 28f) = text(value, size, true).apply { ViewCompat.setAccessibilityHeading(this, true) }
    private fun secondary(value: String) = text(value).apply { setTextColor(color("onSurfaceVariant")) }
    private fun shape(fill: Int, radius: Int = 16) = GradientDrawable().apply { setColor(fill); cornerRadius = dp(radius).toFloat() }
    private fun button(value: String, secondary: Boolean = false, action: () -> Unit) = MaterialButton(ui,
        null, if (secondary) com.google.android.material.R.attr.borderlessButtonStyle else com.google.android.material.R.attr.materialButtonStyle).apply {
        text = value; isAllCaps = false; minHeight = dp(52); cornerRadius = dp(28)
        backgroundTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(if (secondary) Color.TRANSPARENT else color("primary"), color("surfaceVariant")))
        setTextColor(ColorStateList(arrayOf(intArrayOf(android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(color(if (secondary) "onSurfaceVariant" else "onPrimary"), color("onSurfaceVariant"))))
        setOnClickListener { action() }
    }
    private fun addButton(parent: LinearLayout, value: String, secondary: Boolean = false, action: () -> Unit): MaterialButton =
        button(value, secondary, action).also { parent.addView(it, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }) }
    private fun image(size: Int): ImageView = ImageView(ui).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP; background = shape(color("primaryContainer"), 32)
        clipToOutline = true; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(12) }
    }
    private fun loadImage(view: ImageView, uri: String) {
        Glide.with(context.applicationContext).load(uri.ifEmpty { null })
            .placeholder(android.R.drawable.ic_menu_myplaces).error(android.R.drawable.ic_menu_myplaces)
            .override(dp(112)).centerCrop().into(view)
    }
    fun initialize(value: String) {
        if (initialized) return
        initialized = true; machine.restore(value); machine.enter(); replies(pendingReplies); resumeSearch(); schedulePaint()
    }
    fun replies(value: String) {
        pendingReplies = value
        if (!initialized) return
        val replies = runCatching { JSONArray(value) }.getOrNull() ?: return
        for (i in 0 until replies.length()) machine.reply(replies.getJSONObject(i))
        render(); publish()
    }
    fun appearance(value: Map<String, String>) { if (colors != value) { colors = value; schedulePaint() } }
    fun labels(value: Map<String, String>) { if (words != value) { words = value; schedulePaint() } }
    fun logo(value: String) { if (logoUri != value) { logoUri = value; schedulePaint() } }
    fun topInset(value: Double) { top = dp(value.toInt()); applyInsets() }
    fun bottomInset(value: Double) { bottom = dp(value.toInt()); applyInsets() }
    fun lightweight(value: Boolean) { light = value }
    private fun applyInsets() {
        // adjustResize can already shrink the RN host. Pad only the keyboard overlap that
        // remains, rather than subtracting the full IME height a second time.
        val visible = Rect()
        val location = IntArray(2)
        getWindowVisibleDisplayFrame(visible); getLocationOnScreen(location)
        val overlap = if (ime > 0 && height > 0) (location[1] + height - visible.bottom).coerceIn(0, ime) else 0
        root.setPadding(dp(24), top + dp(16), dp(24), maxOf(bottom, overlap) + dp(8))
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
    private fun advance(skip: Boolean = false) {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(windowToken, 0)
        machine.advance(skip); render(); publish()
    }
    private fun edit(parent: LinearLayout, value: String, placeholder: String, search: Boolean = false, changed: (String) -> Unit) {
        val layout = TextInputLayout(ui).apply {
            hint = placeholder; boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
            setBoxCornerRadii(dp(16).toFloat(), dp(16).toFloat(), dp(16).toFloat(), dp(16).toFloat())
            boxBackgroundColor = color("surface"); boxStrokeColor = color("primary")
            defaultHintTextColor = ColorStateList.valueOf(color("onSurfaceVariant"))
            endIconMode = TextInputLayout.END_ICON_CLEAR_TEXT
            setEndIconContentDescription(if (search) "Borrar búsqueda" else "Borrar nombre")
        }
        val input = TextInputEditText(layout.context).apply {
            id = if (search) 2002 else 2001
            setSingleLine(); inputType = InputType.TYPE_CLASS_TEXT or if (search) 0 else InputType.TYPE_TEXT_FLAG_CAP_WORDS
            setTextColor(color("onSurface")); setText(value); minHeight = dp(56)
            contentDescription = if (search) "Buscar artistas" else "Tu nombre"
            imeOptions = if (search) android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH else android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, action, _ ->
                if (action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE || action == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH) {
                    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(windowToken, 0)
                    clearFocus(); true
                } else false
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { changed(s.toString()) }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        layout.addView(input); parent.addView(layout, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12); bottomMargin = dp(8) })
    }
    private fun scrollBody(center: Boolean = false): LinearLayout {
        val scroll = ScrollView(ui).apply { isFillViewport = true; clipToPadding = false }
        val body = column().apply { if (center) gravity = Gravity.CENTER; setPadding(0, dp(16), 0, dp(12)) }
        scroll.addView(body, FrameLayout.LayoutParams(-1, -1))
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f)); return body
    }
    private fun render(force: Boolean = false) {
        if (!initialized) return
        if (!force && painted == machine.step) { update(); return }
        val focus = root.findFocus() as? TextInputEditText
        val focusId = focus?.id; val cursor = focus?.selectionStart ?: 0
        val changedStep = painted != null && painted != machine.step
        painted = machine.step
        root.animate().cancel(); root.alpha = 1f; root.translationY = 0f
        clearImages(root); root.removeAllViews()
        nextButton = null; avatarImage = null; displayedAvatar = null; permissionText = null; permissionButton = null
        counter = null; hint = null; chips = null; results = null; errorText = null; section = null; spinner = null
        setBackgroundColor(color("background")); applyInsets()
        if (machine.step != OnboardingMachine.Step.welcome && machine.step != OnboardingMachine.Step.building) {
            root.addView(LinearProgressIndicator(ui).apply {
                max = 4; progress = machine.step.ordinal; setIndicatorColor(color("primary")); trackColor = color("surfaceVariant")
                contentDescription = "Paso ${machine.step.ordinal + 1} de 5"
            }, LinearLayout.LayoutParams(-1, dp(3)))
            val heading = when (machine.step) {
                OnboardingMachine.Step.profile -> "Tu perfil"
                OnboardingMachine.Step.tasteArtists -> label("title")
                OnboardingMachine.Step.permissions -> "Permisos"
                else -> "¡Todo listo!"
            }
            root.addView(title(heading))
            val subtitle = when (machine.step) {
                OnboardingMachine.Step.profile -> "Ajusta lo básico en segundos."
                OnboardingMachine.Step.tasteArtists -> label("subtitle")
                OnboardingMachine.Step.permissions -> "Solo lo necesario para tu música."
                else -> ""
            }
            if (subtitle.isNotEmpty()) root.addView(secondary(subtitle))
        }
        when (machine.step) {
            OnboardingMachine.Step.welcome -> {
                val body = scrollBody(true)
                body.addView(image(112).also { loadImage(it, logoUri) })
                body.addView(title("StaySound", 40f)); body.addView(secondary("Tu música. Tu ritmo."))
                addButton(body, "Comenzar") { advance() }
            }
            OnboardingMachine.Step.profile -> {
                val body = scrollBody()
                avatarImage = image(110).also { view ->
                    view.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
                    view.contentDescription = "Seleccionar foto de perfil"
                    view.setOnClickListener { machine.pickAvatar(false); publish() }; body.addView(view)
                }
                val actions = LinearLayout(ui)
                actions.addView(button("Galería", true) { machine.pickAvatar(false); publish() }, LinearLayout.LayoutParams(0, -2, 1f))
                actions.addView(button("Cámara", true) { machine.pickAvatar(true); publish() }, LinearLayout.LayoutParams(0, -2, 1f))
                body.addView(actions)
                edit(body, machine.name, "Tu nombre") { machine.name = it; update(); publish() }
                nextButton = addButton(root, "Continuar") { advance() }
                addButton(root, "Saltar por ahora", true) { advance(true) }
            }
            OnboardingMachine.Step.tasteArtists -> {
                counter = text("").also { root.addView(it) }
                hint = secondary("").also { root.addView(it) }
                edit(root, machine.query, label("searchPlaceholder"), true) {
                    machine.setQuery(it); main.removeCallbacks(searchTask)
                    if (machine.searching) main.postDelayed(searchTask, 120)
                    update(); publish()
                }
                val selectedScroll = HorizontalScrollView(ui)
                chips = LinearLayout(ui).also { selectedScroll.addView(it) }
                root.addView(selectedScroll, LinearLayout.LayoutParams(-1, -2))
                val sectionRow = LinearLayout(ui).apply { gravity = Gravity.CENTER_VERTICAL }
                section = secondary("").also { sectionRow.addView(it, LinearLayout.LayoutParams(0, -2, 1f)) }
                spinner = CircularProgressIndicator(ui).apply { isIndeterminate = true; indicatorSize = dp(24); setIndicatorColor(color("primary")) }
                sectionRow.addView(spinner, LinearLayout.LayoutParams(dp(32), dp(32))); root.addView(sectionRow)
                errorText = text("").apply { setTextColor(color("error")); accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE }.also { root.addView(it) }
                results = RecyclerView(ui).apply {
                    layoutManager = GridLayoutManager(ui, if (this@OnboardingView.width >= dp(600)) 3 else 2)
                    adapter = cards; itemAnimator = null; clipToPadding = false
                }.also { root.addView(it, LinearLayout.LayoutParams(-1, 0, 1f)) }
                nextButton = addButton(root, label("continue")) { advance() }
                addButton(root, label("skip"), true) { advance(true) }
            }
            OnboardingMachine.Step.permissions -> {
                val body = scrollBody()
                body.addView(secondary("StaySound necesita estos permisos para funcionar correctamente. Siempre puedes cambiarlos en ajustes."))
                body.addView(title("Biblioteca local", 18f))
                body.addView(secondary("Acceder a tu música guardada en el dispositivo."))
                permissionText = secondary("").also { body.addView(it) }
                body.addView(title("Notificaciones", 18f))
                body.addView(secondary("Controles de reproducción en la barra de notificaciones."))
                permissionButton = addButton(root, "Permitir acceso a música") { machine.requestPermission(); publish() }
                nextButton = addButton(root, "Continuar") { advance() }
            }
            OnboardingMachine.Step.ready -> {
                val body = scrollBody(true)
                avatarImage = image(110).also { body.addView(it) }
                body.addView(title("¡Listo, ${machine.name.jsTrim().ifEmpty { "oyente" }}!"))
                body.addView(secondary("Tu experiencia musical está configurada y personalizada para ti."))
                spinner = CircularProgressIndicator(ui).apply { isIndeterminate = true; setIndicatorColor(color("primary")) }.also { body.addView(it) }
                nextButton = addButton(body, "Entrar a StaySound") { machine.finish(); render(); publish() }
            }
            OnboardingMachine.Step.building -> {
                val body = scrollBody(true)
                body.addView(CircularProgressIndicator(ui).apply { isIndeterminate = true; setIndicatorColor(color("primary")) })
                body.addView(title("Armando tu playlist"))
                body.addView(secondary("Estamos eligiendo canciones de los artistas que seleccionaste. La app abrirá con tu mezcla lista."))
            }
        }
        update()
        if (!changedStep && focusId != null) root.findViewById<TextInputEditText>(focusId)?.let {
            it.requestFocus(); it.setSelection(cursor.coerceIn(0, it.text?.length ?: 0))
        }
        if (changedStep && !light && (Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled())) {
            root.alpha = 0f; root.translationY = dp(16).toFloat()
            root.animate().alpha(1f).translationY(0f).setDuration(200).start()
        }
        publish()
    }
    private fun update() {
        nextButton?.isEnabled = machine.canContinue
        avatarImage?.let { if (displayedAvatar != machine.avatarUri) { displayedAvatar = machine.avatarUri; loadImage(it, machine.avatarUri) } }
        permissionButton?.visibility = if (machine.granted) GONE else VISIBLE
        permissionText?.text = if (machine.granted) "Acceso permitido" else ""
        if (machine.step == OnboardingMachine.Step.ready) spinner?.visibility = if (machine.finishing) VISIBLE else GONE
        if (machine.step != OnboardingMachine.Step.tasteArtists) return
        counter?.text = label("selectedCount").replace("{count}", machine.artists.size.toString())
        hint?.text = if (machine.artists.size < 3) "${3 - machine.artists.size} más para continuar" else ""
        hint?.visibility = if (machine.artists.size < 3) VISIBLE else GONE
        chips?.apply {
            removeAllViews()
            machine.artists.forEach { artist -> addView(Chip(ui).apply {
                text = artist.name; isCloseIconVisible = true; minHeight = dp(48)
                contentDescription = "Quitar ${artist.name}"; setTextColor(color("onSurface"))
                chipBackgroundColor = ColorStateList.valueOf(color("primaryContainer"))
                setOnClickListener { machine.toggle(artist); update(); publish() }
                setOnCloseIconClickListener { machine.toggle(artist); update(); publish() }
            }) }
        }
        section?.text = label(if (machine.searching) "resultsTitle" else "quickTitle")
        errorText?.text = machine.error
        errorText?.visibility = if (machine.searching && machine.error.isNotEmpty()) VISIBLE else GONE
        spinner?.visibility = if (machine.artistLoading || (!machine.searching && machine.quickLoading)) VISIBLE else GONE
        cards.items = if (machine.searching) machine.search else machine.quick
        cards.notifyDataSetChanged()
    }
    private inner class ArtistCards : RecyclerView.Adapter<ArtistHolder>() {
        var items = emptyList<Artist>()
        override fun getItemCount() = items.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ArtistHolder {
            val box = column().apply { gravity = Gravity.CENTER; setPadding(dp(8), dp(12), dp(8), dp(12)) }
            box.layoutParams = RecyclerView.LayoutParams(-1, -2).apply { setMargins(dp(4), dp(4), dp(4), dp(4)) }
            val picture = image(88); val name = text("", 14f, true).apply { gravity = Gravity.CENTER; maxLines = 2 }
            box.addView(picture); box.addView(name); return ArtistHolder(box, picture, name)
        }
        override fun onBindViewHolder(holder: ArtistHolder, position: Int) {
            val artist = items[position]
            val selected = machine.artists.any { it.id == artist.id || (!machine.searching && it.name.lowercase() == artist.name.lowercase()) }
            holder.name.text = artist.name
            holder.itemView.background = shape(color(if (selected) "primaryContainer" else "surface"))
            holder.itemView.isSelected = selected; holder.itemView.isFocusable = true
            holder.itemView.contentDescription = artist.name + if (selected) ", seleccionado" else ""
            holder.itemView.setOnClickListener { machine.toggle(artist); update(); publish() }
            loadImage(holder.picture, if (machine.searching) machine.artwork[artist.id] ?: artist.artworkUrl else artist.artworkUrl)
        }
        override fun onViewRecycled(holder: ArtistHolder) { Glide.with(context.applicationContext).clear(holder.picture) }
    }
    private class ArtistHolder(view: View, val picture: ImageView, val name: TextView) : RecyclerView.ViewHolder(view)
    private fun clearImages(view: View) {
        if (view is ImageView) Glide.with(context.applicationContext).clear(view)
        if (view is ViewGroup) for (i in 0 until view.childCount) clearImages(view.getChildAt(i))
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        applyInsets()
        root.layoutParams = (root.layoutParams as LayoutParams).apply { width = minOf(w, dp(720)) }
        (results?.layoutManager as? GridLayoutManager)?.spanCount = if (w >= dp(600)) 3 else 2
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow(); ViewCompat.requestApplyInsets(this); schedulePaint()
        resumeSearch()
    }
    private fun resumeSearch() {
        main.removeCallbacks(searchTask)
        if (machine.searchQueued) main.postDelayed(searchTask, 120)
    }
    override fun onDetachedFromWindow() {
        main.removeCallbacks(searchTask); main.removeCallbacks(repaint); root.animate().cancel(); clearImages(root)
        super.onDetachedFromWindow()
    }
    // Draft restoration uses initialState from the still-mounted TS route. Android saved-state
    // bundles also survive process death, which would change the existing cold-launch semantics.
}
