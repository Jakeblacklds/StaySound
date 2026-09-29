package expo.modules.searchview

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Editable
import android.text.TextWatcher
import android.text.TextUtils
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.core.graphics.ColorUtils
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.bitmap.CircleCrop
import com.bumptech.glide.load.resource.bitmap.RoundedCorners
import com.google.android.material.button.MaterialButton
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject

private val SKELETON_TITLES = floatArrayOf(.62f, .78f, .5f, .7f, .56f, .84f, .66f)
private val SKELETON_SUBTITLES = floatArrayOf(.38f, .3f, .44f, .26f, .4f, .34f, .3f)

class SearchView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val style = SearchStyle(ui)
    private val main = Handler(Looper.getMainLooper())
    private val session = SearchSession()
    private val title = style.text(30f, 900)
    private val toolbar = LinearLayout(ui)
    private val settingsButton = icon(R.drawable.search_settings, "Ajustes de descarga") { hideKeyboard(); sheets.show("settings") }
    private val searchDock = LinearLayout(ui)
    private val search = EditText(ui)
    private val searchIcon = ImageView(ui)
    private val clear = icon(R.drawable.search_close, "Borrar búsqueda") { search.setText("") }
    private val banner = style.text(13f, 600)
    private val bannerDot = PulseDot(ui)
    private val bannerPill = LinearLayout(ui)
    private var bannerShown = false
    private var entranceUntil = 0L
    private val list = RecyclerView(ui)
    private val adapter = SearchAdapter()
    private val sheets = SearchSheets(ui, style, ::emit)
    private var songs = emptyList<SearchTrack>()
    private var top: SearchEntity? = null
    private var artists = emptyList<SearchEntity>()
    private var albums = emptyList<SearchEntity>()
    private var filter = "all"
    private var recommendations = emptyList<SearchTrack>()
    private var recent = emptyList<SearchEntity>()
    private var transfers = emptyMap<String, Transfer>()
    private var activeId = ""
    private var playing = false
    private var loading = false
    private var error = ""
    private var recommending = true
    private var recommendationError = ""
    private var health = ""
    private var bottomInset = 180
    private var topInset = 0
    private var authRequest = 0
    private val commit = Runnable { dispatchSearch() }

    init {
        orientation = VERTICAL
        isFocusableInTouchMode = true
        toolbar.gravity = Gravity.CENTER_VERTICAL
        title.text = "Buscar"
        title.letterSpacing = -0.035f
        toolbar.addView(title, LayoutParams(0, -2, 1f))
        toolbar.addView(settingsButton, LayoutParams(style.dp(48), style.dp(48)))
        addView(toolbar, LayoutParams(-1, -2))
        searchDock.gravity = Gravity.CENTER_VERTICAL
        searchIcon.setImageResource(R.drawable.search_magnify)
        searchIcon.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        searchDock.addView(searchIcon, LayoutParams(style.dp(24), style.dp(24)).apply { marginStart = style.dp(14) })
        search.apply {
            hint = "Artistas, canciones, álbumes…"
            textSize = 14f
            typeface = style.font(600)
            background = null
            setSingleLine(true)
            minimumHeight = style.dp(56)
            setPadding(style.dp(12), style.dp(12), 0, style.dp(12))
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            inputType = android.text.InputType.TYPE_CLASS_TEXT
            onFocusChangeListener = OnFocusChangeListener { _, _ -> updateChrome(); render() }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun afterTextChanged(s: Editable?) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    session.edit(s?.toString().orEmpty())
                    main.removeCallbacks(commit)
                    error = ""; loading = session.query.isNotEmpty()
                    // Like Spotify, the previous results stay (dimmed) while the next ones
                    // arrive; only an empty field goes back to recents and suggestions.
                    if (session.query.isEmpty()) clearResults()
                    clear.visibility = if (s.isNullOrEmpty()) INVISIBLE else VISIBLE
                    updateChrome(); render(resetScroll = session.query.isEmpty())
                    if (session.query.isEmpty()) dispatchSearch() else main.postDelayed(commit, 260)
                }
            })
            setOnEditorActionListener { _, action, event ->
                if (action == EditorInfo.IME_ACTION_SEARCH || (event?.keyCode == android.view.KeyEvent.KEYCODE_ENTER
                        && event.action == android.view.KeyEvent.ACTION_UP)) {
                    main.removeCallbacks(commit); dispatchSearch(); hideKeyboard()
                    if (session.query.isNotEmpty()) emit("remember", value = session.query)
                    true
                } else false
            }
        }
        searchDock.addView(search, LayoutParams(0, -2, 1f))
        clear.visibility = INVISIBLE
        searchDock.addView(clear, LayoutParams(style.dp(48), style.dp(48)))
        addView(searchDock, LayoutParams(-1, -2).apply {
            leftMargin = style.dp(20); rightMargin = style.dp(20); bottomMargin = style.dp(12)
        })
        bannerPill.gravity = Gravity.CENTER_VERTICAL
        bannerPill.setPadding(style.dp(10), style.dp(7), style.dp(14), style.dp(7))
        bannerPill.addView(bannerDot, LayoutParams(style.dp(16), style.dp(16)).apply { marginEnd = style.dp(6) })
        bannerPill.addView(banner, LayoutParams(-2, -2))
        banner.accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
        bannerPill.visibility = GONE
        addView(bannerPill, LayoutParams(-2, -2).apply {
            marginStart = style.dp(20); bottomMargin = style.dp(12)
        })
        list.layoutManager = LinearLayoutManager(ui)
        list.adapter = adapter
        list.itemAnimator = null
        list.clipToPadding = false
        list.isVerticalScrollBarEnabled = false
        addView(list, LayoutParams(-1, 0, 1f))
        updateChrome(); render()
    }

    private fun emit(action: String, id: String = "", value: String = "") {
        onAction(mapOf("action" to action, "id" to id, "value" to value, "requestId" to session.revision))
    }
    private fun icon(resource: Int, label: String, click: () -> Unit) = ImageButton(ui).apply {
        setImageResource(resource); contentDescription = label
        setPadding(style.dp(13), style.dp(13), style.dp(13), style.dp(13))
        setOnClickListener { click() }
    }
    private fun hideKeyboard() {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)
            ?.hideSoftInputFromWindow(windowToken, 0)
        search.clearFocus()
    }
    private fun dispatchSearch() {
        if (session.dispatch()) emit("search", value = session.query)
    }
    private fun clearResults() {
        songs = emptyList(); top = null; artists = emptyList(); albums = emptyList(); filter = "all"
    }
    private val hasResults get() = songs.isNotEmpty() || artists.isNotEmpty() || albums.isNotEmpty() || top != null
    private fun count(id: String) = when (id) {
        "songs" -> songs.size; "artists" -> artists.size; "albums" -> albums.size; else -> 1
    }
    private fun openEntity(entity: SearchEntity) { hideKeyboard(); emit("open", entity.kind, entity.id) }
    private fun runQuery(text: String) {
        search.setText(text); search.setSelection(search.length())
        main.removeCallbacks(commit); dispatchSearch(); hideKeyboard()
    }
    private fun selectFilter(id: String) {
        if (id == filter) return
        filter = id; armEntrance(); render(resetScroll = true)
    }
    /** Cards lift toward the finger instead of shrinking away from it. */
    private fun lift(view: View) {
        view.stateListAnimator = android.animation.StateListAnimator().apply {
            addState(intArrayOf(android.R.attr.state_pressed),
                android.animation.ObjectAnimator.ofFloat(view, View.TRANSLATION_Y, -style.dp(3).toFloat()).setDuration(140L))
            addState(intArrayOf(),
                android.animation.ObjectAnimator.ofFloat(view, View.TRANSLATION_Y, 0f).setDuration(240L))
        }
    }
    private fun card(fill: Int, radius: Int) = android.graphics.drawable.RippleDrawable(
        ColorStateList.valueOf(ColorUtils.setAlphaComponent(style.color("primary"), 40)),
        style.shape(fill, radius), style.shape(Color.WHITE, radius))
    private fun raised() = ColorUtils.blendARGB(style.color("surface"), style.color("onSurface"), .06f)
    private fun loadArt(view: ImageView, entity: SearchEntity, radius: Int = 12) {
        val placeholder = when (entity.kind) {
            "artist" -> R.drawable.search_person; "album" -> R.drawable.search_disc; else -> R.drawable.search_music
        }
        val request = Glide.with(this).load(entity.artwork.ifBlank { null })
            .placeholder(placeholder).error(placeholder)
        if (entity.round) request.transform(CircleCrop()).into(view)
        else request.centerCrop().transform(RoundedCorners(style.dp(radius))).into(view)
        view.background = if (entity.round) style.shape(style.color("surfaceVariant"), 999)
            else style.shape(style.color("surfaceVariant"), radius)
    }
    private fun retry() {
        session.retry(); loading = true; error = ""; render(); dispatchSearch()
    }
    private fun updateChrome() {
        setBackgroundColor(style.color("background"))
        toolbar.setPadding(style.dp(20), style.dp(topInset + 10), style.dp(20), style.dp(12))
        title.setTextColor(style.ink("onBackground"))
        search.setTextColor(style.ink("onSurface", "surface"))
        search.setHintTextColor(style.ink("onSurfaceVariant", "surface"))
        searchIcon.imageTintList = ColorStateList.valueOf(style.ink("primary", "surface"))
        searchDock.background = style.shape(style.color("surface"), 10).apply {
            setStroke(style.dp(1).coerceAtLeast(1), if (search.hasFocus()) style.color("primary")
                else ColorUtils.setAlphaComponent(style.color("outline"), 85))
        }
        list.setPadding(style.dp(4), 0, style.dp(4), style.dp(bottomInset))
        for (button in listOf(settingsButton, clear)) {
            button.background = style.ripple()
            button.imageTintList = ColorStateList.valueOf(style.ink())
        }
        val tone = if (health == "error") style.ink("error") else style.ink("onSurfaceVariant")
        banner.text = if (health == "error") "Servicio no disponible" else "Servicio inestable"
        banner.setTextColor(tone)
        bannerDot.color = tone
        bannerPill.background = style.shape(ColorUtils.blendARGB(style.color("surface"), tone, 0.12f), 999).apply {
            setStroke(style.dp(1).coerceAtLeast(1), ColorUtils.setAlphaComponent(tone, 70))
        }
        showBanner(session.query.isNotEmpty() && health.isNotBlank())
    }
    /** The health pill drops in and fades out instead of popping. */
    private fun showBanner(show: Boolean) {
        if (show == bannerShown) return
        bannerShown = show
        bannerPill.animate().cancel()
        if (!SearchMotion.enabled()) { bannerPill.visibility = if (show) VISIBLE else GONE; return }
        if (show) {
            bannerPill.visibility = VISIBLE
            bannerPill.alpha = 0f; bannerPill.translationY = -style.dp(8).toFloat()
            bannerPill.scaleX = .96f; bannerPill.scaleY = .96f
            bannerPill.animate().alpha(1f).translationY(0f).scaleX(1f).scaleY(1f)
                .setDuration(380L).setInterpolator(SearchMotion.SETTLE).start()
        } else {
            bannerPill.animate().alpha(0f).translationY(-style.dp(6).toFloat())
                .setDuration(180L).setInterpolator(SearchMotion.EXIT)
                .withEndAction { if (!bannerShown) bannerPill.visibility = GONE }.start()
        }
    }
    /** Rows bound in the next moment slide in, staggered, instead of appearing at once. */
    private fun armEntrance() { entranceUntil = SystemClock.uptimeMillis() + 650L }
    private fun skeletons(count: Int) = List(count) { SearchRow("skeleton:$it", SearchRow.SKELETON) }
    fun setTopInset(value: Double) { topInset = value.toInt(); updateChrome() }
    fun setBottomInset(value: Double) { bottomInset = value.toInt(); updateChrome() }
    // Album palettes ease across the page instead of repainting in a single frame.
    private val appearance = expo.modules.playerchrome.AppearanceTween(this) { applyAppearance(it) }
    fun setAppearance(value: Map<String, String>) = appearance.set(value)
    private fun applyAppearance(value: Map<String, String>) {
        style.colors = value; updateChrome()
        adapter.notifyItemRangeChanged(0, adapter.itemCount, "appearance")
        sheets.refreshAppearance()
    }
    fun setRecentSearches(value: List<String>) {
        recent = value.mapNotNull(::parseRecent); if (session.query.isEmpty()) render()
    }
    fun setCredentials(value: Map<String, String>) { sheets.credentials = value }
    fun requestAuth(value: Int) {
        if (value <= authRequest) return
        authRequest = value
        hideKeyboard(); sheets.show("auth")
    }
    fun setSettings(value: String) {
        val data = runCatching { JSONObject(value) }.getOrNull() ?: return
        health = data.optString("health"); updateChrome(); sheets.setSettings(data)
    }
    fun setResult(value: String) {
        val data = runCatching { JSONObject(value) }.getOrNull() ?: return
        if (!session.accepts(data.optInt("requestId", -1), data.optString("query"))) return
        songs = parseTracks(data.optJSONArray("tracks"))
        top = parseEntity(data.optJSONObject("top"))
        artists = parseEntities(data.optJSONArray("artists"), "artist")
        albums = parseEntities(data.optJSONArray("albums"), "album")
        // A filter with nothing to show for the new query falls back to "Todo".
        if (filter != "all" && count(filter) == 0) filter = "all"
        loading = false
        armEntrance()
        error = if (data.optString("status") == "error") data.optString("error", "No se pudo consultar el catálogo.") else ""
        render(resetScroll = true)
    }
    fun setRecommendations(value: String) {
        val data = runCatching { JSONObject(value) }.getOrNull() ?: return
        val next = parseTracks(data.optJSONArray("tracks"))
        if (next.map { it.id } != recommendations.map { it.id }) armEntrance()
        recommendations = next
        recommending = data.optBoolean("loading")
        recommendationError = data.optString("error")
        if (session.query.isEmpty()) render()
    }
    fun setTransfers(value: String) {
        val data = runCatching { JSONObject(value) }.getOrNull() ?: return
        val next = parseTransfers(data.optJSONArray("tracks"))
        val nextActive = data.optString("activeId")
        val nextPlaying = data.optBoolean("playing")
        val changed = (transfers.keys + next.keys).filter { transfers[it] != next[it] }.toMutableSet()
        if (activeId != nextActive || playing != nextPlaying) { changed.add(activeId); changed.add(nextActive) }
        transfers = next; activeId = nextActive; playing = nextPlaying
        adapter.currentList.forEachIndexed { index, row ->
            if (row.track?.id in changed) adapter.notifyItemChanged(index, "transfer")
        }
    }
    private fun resultRows(): List<SearchRow> = buildList {
        add(SearchRow("chips", SearchRow.CHIPS, action = filter,
            entities = SEARCH_FILTERS.filter { (id, _) -> count(id) > 0 }
                .map { (id, label) -> SearchEntity("filter", id, label) }))
        when (filter) {
            "songs" -> songs.forEach { add(SearchRow("track:${it.id}", SearchRow.TRACK, track = it)) }
            "artists" -> artists.forEach { add(SearchRow("artist:${it.id}", SearchRow.ENTITY, entity = it)) }
            "albums" -> albums.forEach { add(SearchRow("album:${it.id}", SearchRow.ENTITY, entity = it)) }
            else -> {
                val best = top
                if (best != null) {
                    add(SearchRow("h:top", SearchRow.HEADING, "Mejor resultado"))
                    add(SearchRow("top:${best.key}", SearchRow.TOP, entity = best, track = best.track))
                }
                // With an artist on top, "Canciones" leads with that artist's own songs.
                val topArtist = best?.takeIf { it.kind == "artist" }?.id
                val ordered = if (topArtist == null) songs
                    else songs.filter { it.artistId == topArtist } + songs.filter { it.artistId != topArtist }
                val overview = ordered.filter { it.id != best?.track?.id }.take(4)
                if (overview.isNotEmpty()) {
                    add(SearchRow("h:songs", SearchRow.HEADING, "Canciones",
                        action = if (songs.size > overview.size) "songs" else ""))
                    overview.forEach { add(SearchRow("track:${it.id}", SearchRow.TRACK, track = it)) }
                }
                val railArtists = artists.filter { it.id != topArtist }
                if (railArtists.isNotEmpty()) {
                    add(SearchRow("h:artists", SearchRow.HEADING, "Artistas", action = "artists"))
                    add(SearchRow("rail:artists", SearchRow.RAIL, entities = railArtists.take(12)))
                }
                if (albums.isNotEmpty()) {
                    add(SearchRow("h:albums", SearchRow.HEADING, "Álbumes", action = "albums"))
                    add(SearchRow("rail:albums", SearchRow.RAIL, entities = albums.take(12)))
                }
            }
        }
    }
    private fun render(resetScroll: Boolean = false) {
        val rows = buildList {
            when {
                error.isNotEmpty() -> add(SearchRow("error", SearchRow.MESSAGE, "No se pudo cargar el catálogo", error, action = "retry"))
                session.query.isNotEmpty() -> when {
                    hasResults -> addAll(resultRows())
                    loading -> addAll(skeletons(7))
                    else -> add(SearchRow("empty", SearchRow.MESSAGE, "Sin resultados",
                        "No encontramos nada para “${session.query}”. Revisa la ortografía o prueba con el nombre del artista."))
                }
                search.hasFocus() && recent.isNotEmpty() -> {
                    add(SearchRow("recent", SearchRow.HEADING, "Búsquedas recientes", action = "clear"))
                    recent.forEach { add(SearchRow("recent:${it.key}", SearchRow.RECENT, it.title, entity = it)) }
                }
                else -> {
                    add(SearchRow("suggestions", SearchRow.HEADING, "Sugerencias", action = "refresh"))
                    if (recommending && recommendations.isEmpty()) addAll(skeletons(5))
                    else if (recommendationError.isNotBlank())
                        add(SearchRow("recommendation-error", SearchRow.MESSAGE, "No se pudieron cargar las sugerencias",
                            "Comprueba tu conexión e inténtalo de nuevo.", action = "refresh"))
                    else if (recommendations.isEmpty())
                        add(SearchRow("welcome", SearchRow.MESSAGE, "Encuentra tu próxima canción", "Busca un título, artista o álbum."))
                    recommendations.forEach { add(SearchRow("track:${it.id}", SearchRow.TRACK, track = it)) }
                }
            }
        }
        // Stale results for the previous query stay readable but visibly settle back.
        val targetAlpha = if (loading && hasResults) .55f else 1f
        if (list.alpha != targetAlpha) {
            list.animate().cancel()
            if (SearchMotion.enabled()) list.animate().alpha(targetAlpha).setDuration(180L).start() else list.alpha = targetAlpha
        }
        adapter.submitList(rows) { if (resetScroll) list.scrollToPosition(0) }
    }
    override fun onDetachedFromWindow() {
        main.removeCallbacks(commit); sheets.dismiss(); super.onDetachedFromWindow()
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (session.query.isNotEmpty() && loading) { session.retry(); main.postDelayed(commit, 350) }
    }

    private inner class Holder(val root: LinearLayout, val copy: LinearLayout, val title: TextView,
        val subtitle: TextView, val artwork: ImageView, val button: ImageButton,
        val progress: ProgressBar, val retry: MaterialButton,
        val state: DownloadStateButton? = null, val more: TextView? = null, val pill: TextView? = null,
        val go: ImageView? = null, val strip: LinearLayout? = null,
        val scroller: HorizontalScrollView? = null) : RecyclerView.ViewHolder(root) {
        var lastKey = ""
        var lastStatus = ""
    }

    private inner class SearchAdapter : ListAdapter<SearchRow, Holder>(object : DiffUtil.ItemCallback<SearchRow>() {
        override fun areItemsTheSame(a: SearchRow, b: SearchRow) = a.key == b.key
        override fun areContentsTheSame(a: SearchRow, b: SearchRow) = a == b
    }) {
        override fun getItemViewType(position: Int) = getItem(position).kind
        override fun onCreateViewHolder(parent: ViewGroup, type: Int): Holder {
            when (type) {
                SearchRow.SKELETON -> return skeletonHolder()
                SearchRow.TOP -> return topHolder()
                SearchRow.RAIL, SearchRow.CHIPS -> return stripHolder(type)
                SearchRow.ENTITY, SearchRow.RECENT -> return entityHolder(type)
            }
            val root = LinearLayout(ui).apply {
                orientation = if (type == SearchRow.MESSAGE) VERTICAL else HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                layoutParams = RecyclerView.LayoutParams(-1, -2)
                minimumHeight = style.dp(if (type == SearchRow.TRACK) 72 else 56)
                setPadding(style.dp(16), style.dp(if (type == SearchRow.MESSAGE) 36 else 10), style.dp(16), style.dp(10))
            }
            val art = ImageView(ui).apply { scaleType = ImageView.ScaleType.CENTER_CROP; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
            val copy = LinearLayout(ui).apply { orientation = VERTICAL }
            val name = style.text(if (type == SearchRow.HEADING || type == SearchRow.MESSAGE) 20f else 15f, 700)
            val sub = style.text(13f)
            if (type != SearchRow.MESSAGE) {
                name.maxLines = 1; name.ellipsize = TextUtils.TruncateAt.END
                sub.maxLines = 1; sub.ellipsize = TextUtils.TruncateAt.END
            }
            copy.addView(name, LayoutParams(-1, -2))
            copy.addView(sub, LayoutParams(-1, -2).apply { topMargin = style.dp(4) })
            val button = icon(R.drawable.search_download, "Descargar") {}
            val progress = ProgressBar(ui, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
            // Track rows show progress in the download ring; only messages keep a bar.
            if (type != SearchRow.TRACK) copy.addView(progress, LayoutParams(-1, style.dp(3)).apply { topMargin = style.dp(6) })
            val state = if (type == SearchRow.TRACK) DownloadStateButton(ui, style) else null
            val retry = MaterialButton(ui).apply { isAllCaps = false; minimumHeight = style.dp(48) }
            val more = if (type == SearchRow.HEADING) style.text(13f, 700).apply {
                setPadding(style.dp(12), style.dp(10), style.dp(4), style.dp(10))
            } else null
            if (type == SearchRow.TRACK) root.addView(art, LayoutParams(style.dp(52), style.dp(52)).apply { marginEnd = style.dp(14) })
            root.addView(copy, if (type == SearchRow.MESSAGE) LayoutParams(-1, -2) else LayoutParams(0, -2, 1f))
            if (more != null) root.addView(more, LayoutParams(-2, -2))
            when {
                state != null -> root.addView(state, LayoutParams(style.dp(48), style.dp(48)).apply { marginStart = style.dp(8) })
                type != SearchRow.MESSAGE -> root.addView(button, LayoutParams(style.dp(48), style.dp(48)).apply { marginStart = style.dp(8) })
                else -> root.addView(retry, LayoutParams(-2, -2).apply { topMargin = style.dp(16) })
            }
            return Holder(root, copy, name, sub, art, button, progress, retry, state, more = more)
        }
        private fun oneLine(view: TextView) = view.apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
        /** "Mejor resultado": the one card that answers most searches in a single tap. */
        private fun topHolder(): Holder {
            val root = LinearLayout(ui).apply {
                orientation = VERTICAL
                layoutParams = RecyclerView.LayoutParams(-1, -2).apply {
                    leftMargin = style.dp(16); rightMargin = style.dp(16); bottomMargin = style.dp(10)
                }
                setPadding(style.dp(18), style.dp(18), style.dp(14), style.dp(14))
            }
            lift(root)
            val art = ImageView(ui).apply { scaleType = ImageView.ScaleType.CENTER_CROP; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
            root.addView(art, LayoutParams(style.dp(96), style.dp(96)))
            val name = oneLine(style.text(26f, 900)).apply { letterSpacing = -0.03f }
            root.addView(name, LayoutParams(-1, -2).apply { topMargin = style.dp(16) })
            val bottom = LinearLayout(ui).apply { gravity = Gravity.CENTER_VERTICAL; minimumHeight = style.dp(48) }
            val pill = style.text(12f, 700).apply { setPadding(style.dp(10), style.dp(5), style.dp(10), style.dp(5)) }
            val sub = oneLine(style.text(14f, 600))
            val state = DownloadStateButton(ui, style)
            val go = ImageView(ui).apply {
                setImageResource(R.drawable.search_chevron); scaleType = ImageView.ScaleType.CENTER
                importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            bottom.addView(pill, LayoutParams(-2, -2))
            bottom.addView(sub, LayoutParams(0, -2, 1f).apply { marginStart = style.dp(10); marginEnd = style.dp(8) })
            bottom.addView(state, LayoutParams(style.dp(48), style.dp(48)))
            bottom.addView(go, LayoutParams(style.dp(44), style.dp(44)))
            root.addView(bottom, LayoutParams(-1, -2).apply { topMargin = style.dp(6) })
            return Holder(root, LinearLayout(ui), name, sub, art, ImageButton(ui), ProgressBar(ui), MaterialButton(ui),
                state = state, pill = pill, go = go)
        }
        /** Filter chips and the artist/album rails: both scroll sideways inside the list. */
        private fun stripHolder(type: Int): Holder {
            val root = LinearLayout(ui).apply {
                layoutParams = RecyclerView.LayoutParams(-1, -2)
                setPadding(0, style.dp(if (type == SearchRow.CHIPS) 2 else 0), 0, style.dp(if (type == SearchRow.CHIPS) 10 else 14))
            }
            val strip = LinearLayout(ui).apply { gravity = Gravity.CENTER_VERTICAL }
            val scroller = HorizontalScrollView(ui).apply {
                isHorizontalScrollBarEnabled = false; clipToPadding = false; overScrollMode = OVER_SCROLL_NEVER
                setPadding(style.dp(16), 0, style.dp(16), 0)
                addView(strip, LayoutParams(-2, -2))
            }
            root.addView(scroller, LayoutParams(-1, -2))
            return Holder(root, LinearLayout(ui), TextView(ui), TextView(ui), ImageView(ui), ImageButton(ui),
                ProgressBar(ui), MaterialButton(ui), strip = strip, scroller = scroller)
        }
        /** Artist/album rows (filtered views) and recents: artwork, two lines, one trailing control. */
        private fun entityHolder(type: Int): Holder {
            val root = LinearLayout(ui).apply {
                gravity = Gravity.CENTER_VERTICAL
                layoutParams = RecyclerView.LayoutParams(-1, -2)
                minimumHeight = style.dp(72)
                setPadding(style.dp(16), style.dp(8), style.dp(if (type == SearchRow.RECENT) 4 else 12), style.dp(8))
            }
            val art = ImageView(ui).apply { scaleType = ImageView.ScaleType.CENTER_CROP; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
            val copy = LinearLayout(ui).apply { orientation = VERTICAL }
            val name = oneLine(style.text(15f, 700))
            val sub = oneLine(style.text(13f))
            copy.addView(name, LayoutParams(-1, -2))
            copy.addView(sub, LayoutParams(-1, -2).apply { topMargin = style.dp(4) })
            root.addView(art, LayoutParams(style.dp(56), style.dp(56)).apply { marginEnd = style.dp(14) })
            root.addView(copy, LayoutParams(0, -2, 1f))
            val forget = icon(R.drawable.search_close, "Quitar de recientes") {}
            val go = ImageView(ui).apply {
                setImageResource(R.drawable.search_chevron); importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            if (type == SearchRow.RECENT) root.addView(forget, LayoutParams(style.dp(48), style.dp(48)))
            else root.addView(go, LayoutParams(style.dp(22), style.dp(22)))
            return Holder(root, copy, name, sub, art, forget, ProgressBar(ui), MaterialButton(ui), go = go)
        }
        private fun skeletonHolder(): Holder {
            val root = LinearLayout(ui).apply {
                layoutParams = RecyclerView.LayoutParams(-1, -2)
                minimumHeight = style.dp(72); gravity = Gravity.CENTER_VERTICAL
                setPadding(style.dp(16), style.dp(10), style.dp(16), style.dp(10))
                importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            }
            root.addView(SkeletonRowView(ui, style), LayoutParams(-1, -2))
            return Holder(root, LinearLayout(ui), TextView(ui), TextView(ui), ImageView(ui), ImageButton(ui),
                ProgressBar(ui), MaterialButton(ui))
        }
        override fun onBindViewHolder(holder: Holder, position: Int) {
            bind(holder, getItem(position), true); enter(holder, position)
        }
        override fun onBindViewHolder(holder: Holder, position: Int, payloads: MutableList<Any>) {
            bind(holder, getItem(position), payloads.isEmpty())
            if (payloads.isEmpty()) enter(holder, position)
        }
        private fun enter(h: Holder, position: Int) {
            val view = h.root
            view.animate().cancel()
            if (!SearchMotion.enabled() || SystemClock.uptimeMillis() > entranceUntil || position > 11) {
                view.alpha = 1f; view.translationY = 0f; return
            }
            view.alpha = 0f; view.translationY = style.dp(18).toFloat()
            view.animate().alpha(1f).translationY(0f)
                .setStartDelay(position * 32L).setDuration(420L)
                .setInterpolator(SearchMotion.SETTLE).start()
        }
        /** A soft accent wash crosses the row when its download lands. */
        private fun celebrate(h: Holder) {
            if (!SearchMotion.enabled()) return
            val wash = android.graphics.drawable.GradientDrawable().apply {
                setColor(ColorUtils.setAlphaComponent(style.color("primary"), 34)); cornerRadius = style.dp(16).toFloat()
            }
            h.root.foreground = wash
            android.animation.ValueAnimator.ofInt(0, 255, 0).apply {
                duration = 1100L; interpolator = SearchMotion.STANDARD
                addUpdateListener { wash.alpha = it.animatedValue as Int }
                addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: android.animation.Animator) { h.root.foreground = null }
                })
                start()
            }
        }
        private fun bind(h: Holder, row: SearchRow, loadImage: Boolean) {
            if (row.kind == SearchRow.SKELETON) {
                val skeleton = h.root.getChildAt(0) as? SkeletonRowView ?: return
                val index = row.key.substringAfter(':').toIntOrNull() ?: 0
                skeleton.titleFraction = SKELETON_TITLES[index % SKELETON_TITLES.size]
                skeleton.subtitleFraction = SKELETON_SUBTITLES[index % SKELETON_SUBTITLES.size]
                skeleton.invalidate()
                return
            }
            when (row.kind) {
                SearchRow.TOP -> { bindTop(h, row, loadImage); return }
                SearchRow.RAIL -> { bindRail(h, row, loadImage); return }
                SearchRow.CHIPS -> { bindChips(h, row); return }
                SearchRow.ENTITY, SearchRow.RECENT -> { bindEntity(h, row, loadImage); return }
            }
            h.title.setTextColor(style.ink())
            h.subtitle.setTextColor(style.ink("onSurfaceVariant"))
            h.root.background = style.ripple()
            h.button.background = style.ripple()
            h.button.imageTintList = ColorStateList.valueOf(style.ink("primary"))
            h.button.visibility = GONE; h.progress.visibility = GONE; h.retry.visibility = GONE
            h.subtitle.visibility = if (row.kind == SearchRow.TRACK || row.description.isNotEmpty()) VISIBLE else GONE
            h.title.text = row.title; h.subtitle.text = row.description
            h.root.setOnClickListener(null)
            h.copy.setOnClickListener(null)
            h.root.contentDescription = null
            when (row.kind) {
                SearchRow.TRACK -> {
                    val track = row.track ?: return
                    val transfer = transfers[track.id] ?: Transfer()
                    val active = track.id == activeId
                    h.title.text = track.title; h.subtitle.text = track.subtitle
                    h.title.setTextColor(style.ink(if (active) "primary" else "onSurface"))
                    if (loadImage) Glide.with(this@SearchView).load(track.artwork.ifBlank { null })
                        .placeholder(R.drawable.search_music).error(R.drawable.search_music)
                        .centerCrop().transform(RoundedCorners(style.dp(12))).into(h.artwork)
                    h.artwork.background = style.shape(style.color("surfaceVariant"))
                    h.copy.contentDescription = "${track.title}, ${track.subtitle}" + if (active) {
                        if (playing) ", reproduciéndose" else ", en pausa"
                    } else ""
                    h.root.setOnClickListener { hideKeyboard(); emit("track", track.id) }
                    val state = h.state ?: return
                    state.contentDescription = when (transfer.status) {
                        "downloading" -> "Cancelar descarga de ${track.title}, ${transfer.progress}%"
                        "done" -> "Descargada: ${track.title}"
                        "error" -> "Reintentar descarga de ${track.title}"
                        else -> "Descargar ${track.title}"
                    }
                    state.isEnabled = transfer.status != "done"
                    state.setOnClickListener { emit("download", track.id) }
                    state.bind(track.id, transfer.status, transfer.progress)
                    if (h.lastKey == track.id && h.lastStatus == "downloading" && transfer.status == "done") celebrate(h)
                    h.lastKey = track.id; h.lastStatus = transfer.status
                }
                SearchRow.HEADING -> {
                    h.title.isAccessibilityHeading = true
                    val more = h.more
                    if (more != null) {
                        val label = when (row.action) { "clear" -> "Borrar"; "songs", "artists", "albums" -> "Ver todo"; else -> "" }
                        more.visibility = if (label.isEmpty()) GONE else VISIBLE
                        more.text = label
                        more.setTextColor(style.ink("onSurfaceVariant"))
                        more.background = style.ripple()
                        more.contentDescription = if (row.action == "clear") "Borrar búsquedas recientes" else "Ver todo: ${row.title}"
                        more.setOnClickListener {
                            if (row.action == "clear") emit("clearRecent") else selectFilter(row.action)
                        }
                    }
                    if (row.action == "refresh") {
                        h.button.visibility = VISIBLE; h.button.isEnabled = !recommending
                        h.button.alpha = if (recommending) 0.4f else 1f
                        h.button.setImageResource(R.drawable.search_refresh)
                        h.button.contentDescription = "Actualizar sugerencias"
                        h.button.setOnClickListener { emit("refresh") }
                    }
                }
                SearchRow.MESSAGE -> {
                    h.root.background = null
                    h.title.accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
                    if (row.action == "loading") {
                        h.progress.visibility = VISIBLE; h.progress.isIndeterminate = true
                        h.progress.indeterminateTintList = ColorStateList.valueOf(style.color("primary"))
                    } else if (row.action.isNotEmpty()) {
                        h.retry.visibility = VISIBLE; h.retry.text = "Reintentar"
                        h.retry.backgroundTintList = ColorStateList.valueOf(style.color("primary"))
                        h.retry.setTextColor(style.ink("onPrimary", "primary"))
                        h.retry.setOnClickListener { if (row.action == "retry") retry() else emit("refresh") }
                    }
                }
            }
        }
        private fun bindTop(h: Holder, row: SearchRow, loadImage: Boolean) {
            val entity = row.entity ?: return
            val track = row.track
            h.root.background = card(raised(), 18)
            h.title.text = entity.title
            h.title.setTextColor(style.ink("onSurface"))
            val label = entity.label.ifBlank {
                when (entity.kind) { "artist" -> "Artista"; "album" -> "Álbum"; else -> "Canción" }
            }
            h.pill?.apply {
                text = label
                setTextColor(style.ink("onSurface", "surfaceVariant"))
                background = style.shape(ColorUtils.blendARGB(raised(), style.color("onSurface"), .12f), 999)
            }
            h.subtitle.text = entity.subtitle
            h.subtitle.visibility = if (entity.subtitle.isBlank()) INVISIBLE else VISIBLE
            h.subtitle.setTextColor(style.ink("onSurfaceVariant", "surface"))
            if (loadImage) loadArt(h.artwork, entity, 14)
            val go = h.go
            val state = h.state
            if (entity.kind == "track" && track != null && state != null) {
                go?.visibility = GONE
                state.visibility = VISIBLE
                val transfer = transfers[track.id] ?: Transfer()
                state.isEnabled = transfer.status != "done"
                state.contentDescription = if (transfer.status == "done") "Descargada: ${track.title}" else "Descargar ${track.title}"
                state.setOnClickListener { emit("download", track.id) }
                state.bind(track.id, transfer.status, transfer.progress)
                h.title.setTextColor(style.ink(if (track.id == activeId) "primary" else "onSurface"))
                h.root.setOnClickListener { hideKeyboard(); emit("track", track.id) }
            } else {
                state?.visibility = GONE
                go?.visibility = VISIBLE
                go?.background = style.shape(style.color("primary"), 999)
                go?.imageTintList = ColorStateList.valueOf(style.ink("onPrimary", "primary"))
                h.root.setOnClickListener { openEntity(entity) }
            }
            h.root.contentDescription = listOf(label, entity.title, entity.subtitle).filter { it.isNotBlank() }.joinToString(", ")
        }
        private fun bindRail(h: Holder, row: SearchRow, loadImage: Boolean) {
            val strip = h.strip ?: return
            val signature = row.entities.joinToString("|") { it.key }
            if (loadImage || h.lastKey != signature) {
                strip.removeAllViews()
                row.entities.forEach { entity ->
                    val size = style.dp(if (entity.round) 116 else 136)
                    val tile = LinearLayout(ui).apply {
                        orientation = VERTICAL
                        gravity = if (entity.round) Gravity.CENTER_HORIZONTAL else Gravity.START
                        setPadding(style.dp(6), style.dp(6), style.dp(6), style.dp(8))
                        background = card(Color.TRANSPARENT, 14)
                        contentDescription = "${entity.title}, ${entity.subtitle}"
                        setOnClickListener { openEntity(entity) }
                    }
                    lift(tile)
                    val art = ImageView(ui).apply { scaleType = ImageView.ScaleType.CENTER_CROP; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
                    tile.addView(art, LayoutParams(size, size))
                    val name = oneLine(style.text(13f, 700)).apply {
                        text = entity.title; gravity = if (entity.round) Gravity.CENTER_HORIZONTAL else Gravity.START
                    }
                    tile.addView(name, LayoutParams(size, -2).apply { topMargin = style.dp(9) })
                    val sub = oneLine(style.text(12f)).apply {
                        text = entity.subtitle; gravity = name.gravity
                    }
                    tile.addView(sub, LayoutParams(size, -2).apply { topMargin = style.dp(3) })
                    loadArt(art, entity)
                    strip.addView(tile, LayoutParams(-2, -2))
                }
                if (h.lastKey != signature) h.scroller?.scrollTo(0, 0)
                h.lastKey = signature
            }
            for (index in 0 until strip.childCount) {
                val tile = strip.getChildAt(index) as? LinearLayout ?: continue
                (tile.getChildAt(1) as? TextView)?.setTextColor(style.ink())
                (tile.getChildAt(2) as? TextView)?.setTextColor(style.ink("onSurfaceVariant"))
            }
        }
        private fun bindChips(h: Holder, row: SearchRow) {
            val strip = h.strip ?: return
            strip.removeAllViews()
            row.entities.forEach { option ->
                val selected = option.id == row.action
                val chip = style.text(14f, 700).apply {
                    text = option.title
                    gravity = Gravity.CENTER
                    minHeight = style.dp(36)
                    setPadding(style.dp(16), 0, style.dp(16), 0)
                    isSelected = selected
                    val fill = if (selected) style.ink("onSurface") else style.color("surfaceVariant")
                    background = card(fill, 999)
                    setTextColor(if (selected) style.color("background") else style.ink("onSurface", "surfaceVariant"))
                    contentDescription = "Filtro ${option.title}" + if (selected) ", seleccionado" else ""
                    setOnClickListener { selectFilter(option.id) }
                }
                strip.addView(chip, LayoutParams(-2, style.dp(36)).apply { marginEnd = style.dp(8) })
            }
        }
        private fun bindEntity(h: Holder, row: SearchRow, loadImage: Boolean) {
            val entity = row.entity ?: return
            h.root.background = style.ripple()
            h.title.text = entity.title
            h.subtitle.text = entity.subtitle
            h.subtitle.visibility = if (entity.subtitle.isBlank()) GONE else VISIBLE
            h.title.setTextColor(style.ink())
            h.subtitle.setTextColor(style.ink("onSurfaceVariant"))
            h.go?.imageTintList = ColorStateList.valueOf(style.ink("onSurfaceVariant"))
            h.root.contentDescription = "${entity.title}, ${entity.subtitle}"
            if (entity.kind == "query") {
                Glide.with(this@SearchView).clear(h.artwork)
                h.artwork.setImageResource(R.drawable.search_magnify)
                h.artwork.scaleType = ImageView.ScaleType.CENTER
                h.artwork.imageTintList = ColorStateList.valueOf(style.ink("onSurfaceVariant", "surfaceVariant"))
                h.artwork.background = style.shape(style.color("surfaceVariant"), 999)
            } else if (loadImage) {
                h.artwork.scaleType = ImageView.ScaleType.CENTER_CROP
                h.artwork.imageTintList = null
                loadArt(h.artwork, entity)
            }
            if (row.kind == SearchRow.RECENT) {
                h.button.background = style.ripple()
                h.button.imageTintList = ColorStateList.valueOf(style.ink("onSurfaceVariant"))
                h.button.contentDescription = "Quitar ${entity.title} de recientes"
                h.button.setOnClickListener { emit("forgetRecent", value = entity.key) }
                h.root.setOnClickListener {
                    when (entity.kind) {
                        "artist", "album" -> openEntity(entity)
                        else -> {
                            runQuery(entity.query)
                            if (entity.kind == "query") emit("remember", value = entity.query)
                        }
                    }
                }
            } else {
                h.root.setOnClickListener { openEntity(entity) }
            }
        }
        override fun onViewRecycled(holder: Holder) {
            holder.root.animate().cancel()
            holder.root.alpha = 1f; holder.root.translationY = 0f; holder.root.foreground = null
            Glide.with(this@SearchView).clear(holder.artwork)
            super.onViewRecycled(holder)
        }
    }
}
