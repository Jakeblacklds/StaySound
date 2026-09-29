package expo.modules.playlistview

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Parcelable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.view.ContextThemeWrapper
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.CircularProgressIndicator
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.Future

/** UI projection only. Playlists, playback and downloads remain owned by existing TS services. */
class PlaylistView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val style = PlaylistStyle(ui)
    private val main = Handler(Looper.getMainLooper())
    private var worker: ExecutorService? = null
    private var work: Future<*>? = null
    private var generation = 0
    private var raw = "{}"
    private var catalog = PlaylistCatalog("{}")
    private var selection = Selection("list")
    private var labels = emptyMap<String, String>()
    private var playback = JSONObject()
    private var downloads = JSONObject()
    private var topInset = 0
    private var bottomInset = style.dp(120)
    private var scrollState: Parcelable? = null
    private var dialog: AlertDialog? = null
    private var editor: Editor? = null
    private var creator: Creator? = null
    private var addOpen = false
    private var query = ""
    private val frame = FrameLayout(ui)
    private val backdrop = PlaylistArtwork(style, 0, true)
    private val wash = View(ui)
    private val root = column()
    private val toolbar = row()
    private val body = FrameLayout(ui)
    private val list = RecyclerView(ui)
    private val rows = Rows()
    private val refresh = Runnable { project() }

    init {
        list.layoutManager = LinearLayoutManager(ui); list.adapter = rows; list.itemAnimator = null
        list.clipToPadding = false; list.isVerticalScrollBarEnabled = false
        frame.addView(backdrop, FrameLayout.LayoutParams(-1, -1))
        frame.addView(wash, FrameLayout.LayoutParams(-1, -1))
        root.addView(toolbar, LinearLayout.LayoutParams(-1, -2))
        root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        body.addView(list, FrameLayout.LayoutParams(-1, -1))
        frame.addView(root, FrameLayout.LayoutParams(-1, -1))
        addView(frame, LayoutParams(-1, -1))
        applyInsets(); paint()
    }
    fun setCatalog(value: String) { if (raw != value) { raw = value; schedule() } }
    fun setSelection(value: String) {
        val next = runCatching { Selection.parse(value) }.getOrDefault(Selection("list"))
        if (selection == next) return
        dialog?.dismiss(); editor = null; dialog = null
        selection = next; addOpen = false; query = ""; scrollState = null; creator = null
        body.removeAllViews(); body.addView(list, FrameLayout.LayoutParams(-1, -1))
        rows.submitList(emptyList()); list.scrollToPosition(0); paint(); schedule()
    }
    // paint() rebuilds the toolbar, so the palette eases at ~20 fps rather than every frame.
    private val appearance = expo.modules.playerchrome.AppearanceTween(this, frameMs = 48) { value ->
        if (style.colors != value) { style.colors = value; paint(); rows.notifyItemRangeChanged(0, rows.itemCount); creator?.paint() }
    }
    fun setAppearance(value: Map<String, String>) = appearance.set(value)
    fun setLabels(value: Map<String, String>) { labels = value; paint(); rebuild() }
    fun setPlayback(value: String) { playback = runCatching { JSONObject(value) }.getOrDefault(JSONObject()); refreshVisibleTracks() }
    fun setDownloads(value: String) { downloads = runCatching { JSONObject(value) }.getOrDefault(JSONObject()); refreshVisibleTracks() }
    fun setTopInset(value: Double) { topInset = style.dp(value.toInt()); applyInsets() }
    fun setBottomInset(value: Double) { bottomInset = style.dp(value.toInt()); applyInsets() }
    fun setResponse(value: String) {
        val response = runCatching { JSONObject(value) }.getOrNull() ?: return
        when (response.optString("kind")) {
            "cover" -> editor?.takeIf { it.requestId == response.optString("requestId") }?.setCover(response.optString("uri"))
            "import" -> creator?.importResponse(response)
        }
        response.optString("message").takeIf { it.isNotBlank() && isAttachedToWindow }?.let { message ->
            Snackbar.make(frame, message, Snackbar.LENGTH_LONG).apply {
                (view.layoutParams as? FrameLayout.LayoutParams)?.let { it.bottomMargin = bottomInset; view.layoutParams = it }
            }.show()
        }
    }
    private fun refreshVisibleTracks() {
        rows.currentList.forEachIndexed { i, item -> if (item.entry != null) rows.notifyItemChanged(i) }
        for (i in 0 until list.childCount) (list.getChildAt(i) as? Hero)?.refreshLibrary()
    }
    private fun applyInsets() {
        root.setPadding(0, topInset.coerceAtLeast(0), 0, 0)
        list.setPadding(0, 0, 0, bottomInset.coerceAtLeast(0))
        creator?.setPadding(style.dp(16), 0, style.dp(16), bottomInset.coerceAtLeast(0))
    }
    private fun paint() {
        frame.setBackgroundColor(style.background)
        val p = catalog.find(selection.id)
        backdrop.visibility = if (selection.screen == "detail" && !style.lightweight) VISIBLE else GONE
        backdrop.bind(p?.artwork.orEmpty())
        wash.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(
            style.alpha(style.background, 210), style.alpha(style.background, 245), style.background))
        toolbar.removeAllViews(); toolbar.setPadding(style.dp(16), style.dp(8), style.dp(16), style.dp(6))
        if (selection.screen == "list") {
            toolbar.addView(style.text(labels["title"] ?: "Playlists", 30f, 900), LinearLayout.LayoutParams(0, -2, 1f))
            toolbar.addView(icon("add", labels["create"] ?: "Crear playlist") { emit("openCreate") })
        } else toolbar.addView(icon("back", "Volver") { emit("back") })
    }
    private fun schedule() { generation++; main.removeCallbacks(refresh); if (isAttachedToWindow) main.post(refresh) }
    private fun project() {
        val revision = generation; val source = raw
        work?.cancel(true)
        work = worker?.submit {
            val result = runCatching { PlaylistCatalog(source) }
            main.post {
                if (!isAttachedToWindow || revision != generation) return@post
                result.onSuccess {
                    catalog = it
                    if (selection.screen == "detail" && catalog.find(selection.id)?.readonly != false) dialog?.dismiss()
                    rebuild(); paint()
                }.onFailure { rows.submitList(listOf(Item("error"))) }
            }
        }
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); worker = Executors.newSingleThreadExecutor(); schedule() }
    override fun onDetachedFromWindow() {
        scrollState = list.layoutManager?.onSaveInstanceState(); generation++
        main.removeCallbacksAndMessages(null); work?.cancel(true); worker?.shutdownNow(); worker = null
        dialog?.dismiss(); dialog = null; editor = null
        super.onDetachedFromWindow()
    }
    private fun emit(action: String, id: String = "", memberId: String = "", targetId: String = "", name: String = "",
        description: String = "", artwork: String = "", requestId: String = "") {
        catalog.action(selection, action, id, memberId, targetId, name, description, artwork, requestId, query)?.let { onAction(it.payload()) }
    }
    private fun emit(action: String, entry: Entry) = emit(action, entry.song.id, entry.memberId)
    private fun column() = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
    private fun row() = LinearLayout(ui).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun gap(size: Int) = View(ui).apply { layoutParams = LinearLayout.LayoutParams(1, style.dp(size)); importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
    private fun button(label: String, click: () -> Unit) = MaterialButton(ui).apply {
        text = label; isAllCaps = false; minHeight = style.dp(48); cornerRadius = style.dp(14)
        backgroundTintList = ColorStateList.valueOf(style.primary); setTextColor(style.onPrimary)
        setOnClickListener { click() }
    }
    private fun icon(kind: String, label: String, fill: Boolean = false, click: () -> Unit): FrameLayout = FrameLayout(ui).apply {
        layoutParams = LinearLayout.LayoutParams(style.dp(if (fill) 72 else 48), style.dp(if (fill) 72 else 48))
        addView(PlaylistGlyph(style, kind, if (fill) style.onPrimary else style.primary), FrameLayout.LayoutParams(style.dp(if (fill) 30 else 24), style.dp(if (fill) 30 else 24), Gravity.CENTER))
        background = style.shape(if (fill) style.primary else style.alpha(style.surface, 220), if (fill) 36 else 24)
        foreground = style.ripple(36); contentDescription = label; isClickable = true; isFocusable = true
        setOnClickListener { click() }
        accessibilityDelegate = object : View.AccessibilityDelegate() {
            override fun onInitializeAccessibilityNodeInfo(host: View, info: android.view.accessibility.AccessibilityNodeInfo) {
                super.onInitializeAccessibilityNodeInfo(host, info); info.className = "android.widget.Button"
            }
        }
    }
    private fun field(hint: String, value: String = "", multiline: Boolean = false): Pair<TextInputLayout, TextInputEditText> {
        val shell = TextInputLayout(ui).apply {
            this.hint = hint; boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
            boxStrokeColor = style.primary; defaultHintTextColor = ColorStateList.valueOf(style.subtle)
            setBoxCornerRadii(style.dp(14).toFloat(), style.dp(14).toFloat(), style.dp(14).toFloat(), style.dp(14).toFloat())
        }
        val input = TextInputEditText(shell.context).apply {
            setText(value); setTextColor(style.ink); setHintTextColor(style.subtle); textSize = 16f
            inputType = InputType.TYPE_CLASS_TEXT or if (multiline) InputType.TYPE_TEXT_FLAG_MULTI_LINE else InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            maxLines = if (multiline) 4 else 1; setSingleLine(!multiline)
        }
        shell.addView(input, LinearLayout.LayoutParams(-1, -2)); return shell to input
    }
    private fun TextInputEditText.changed(block: (String) -> Unit) = addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { block(s?.toString().orEmpty()) }
        override fun afterTextChanged(s: Editable?) {}
    })
    private fun rebuild() {
        if (selection.screen == "create") {
            if (creator == null) {
                creator = Creator(); body.removeAllViews()
                body.addView(ScrollView(ui).apply { isFillViewport = true; addView(creator) }, FrameLayout.LayoutParams(-1, -1)); applyInsets()
            }
            return
        }
        val content = buildList {
            if (selection.screen == "list") {
                if (catalog.playlists.isEmpty()) add(Item("emptyPlaylists"))
                catalog.playlists.forEachIndexed { index, p -> add(Item(if (index == 0) "featured" else "playlist", p.id, playlist = p)) }
            } else {
                val p = catalog.find(selection.id)
                if (p == null) add(Item("notFound")) else {
                    add(Item("hero", p.id, playlist = p))
                    if (p.entries.isEmpty()) add(Item("emptyTracks"))
                    p.entries.forEachIndexed { index, e -> add(Item("track", e.memberId, entry = e, index = index)) }
                }
            }
        }
        rows.submitList(content) {
            scrollState?.let { list.layoutManager?.onRestoreInstanceState(it); scrollState = null }
            // Library metadata can change without changing the current playlist (e.g. a download).
            for (i in 0 until list.childCount) (list.getChildAt(i) as? Hero)?.refreshLibrary()
        }
    }
    private data class Item(val kind: String, val id: String = "", val playlist: LocalPlaylist? = null, val entry: Entry? = null, val index: Int = 0)
    private inner class Rows : ListAdapter<Item, Holder>(object : DiffUtil.ItemCallback<Item>() {
        override fun areItemsTheSame(a: Item, b: Item) = a.kind == b.kind && a.id == b.id
        override fun areContentsTheSame(a: Item, b: Item) = a == b
    }) {
        override fun getItemViewType(position: Int) = when (getItem(position).kind) { "hero" -> 1; "track" -> 2; "featured" -> 3; else -> 0 }
        override fun onCreateViewHolder(parent: ViewGroup, type: Int) = Holder(when (type) { 1 -> Hero(); 2 -> SongRow(); 3 -> Featured(); else -> column() })
        override fun onBindViewHolder(holder: Holder, position: Int) { holder.bind(getItem(position)) }
    }
    private inner class Holder(view: View) : RecyclerView.ViewHolder(view) {
        init { itemView.layoutParams = RecyclerView.LayoutParams(-1, -2) }
        fun bind(item: Item) {
            when (val view = itemView) {
                is Hero -> item.playlist?.let(view::bind)
                is Featured -> item.playlist?.let(view::bind)
                is SongRow -> item.entry?.let { view.bind(it, item.index) }
                is LinearLayout -> {
                    view.removeAllViews(); view.setPadding(style.dp(20), style.dp(12), style.dp(20), style.dp(12))
                    val p = item.playlist
                    if (p != null) {
                        val line = row(); line.minimumHeight = style.dp(68)
                        line.addView(PlaylistArtwork(style, 7).apply { bind(p.artwork) }, LinearLayout.LayoutParams(style.dp(50), style.dp(50)))
                        line.addView(style.text(p.name, 15f, 700).apply { maxLines = 1; setPadding(style.dp(14), 0, 0, 0) }, LinearLayout.LayoutParams(0, -2, 1f))
                        line.addView(icon("more", p.name) { emit("open", p.id) })
                        line.isFocusable = true; line.foreground = style.ripple(); line.setOnClickListener { emit("open", p.id) }
                        view.addView(line)
                    } else {
                        val message = when (item.kind) {
                            "emptyPlaylists" -> labels["emptyTitle"] ?: "Aún no hay playlists"
                            "notFound" -> "Playlist not found"
                            "error" -> "No se pudo cargar la playlist."
                            else -> "No hay canciones en esta playlist"
                        }
                        view.addView(style.text(message, 18f, 700).apply { gravity = Gravity.CENTER; setPadding(0, style.dp(36), 0, style.dp(12)) })
                        if (item.kind == "emptyPlaylists") {
                            view.addView(style.text(labels["emptyDescription"].orEmpty(), 14f, color = style.subtle).apply { gravity = Gravity.CENTER })
                            view.addView(button(labels["create"] ?: "Crear playlist") { emit("openCreate") })
                        }
                        if (item.kind == "error") view.addView(button("Reintentar") { schedule() })
                    }
                }
            }
        }
    }
    private inner class Featured : LinearLayout(ui) {
        private var spinner: ObjectAnimator? = null
        private var artwork: PlaylistArtwork? = null
        init { orientation = VERTICAL; setPadding(style.dp(20), style.dp(4), style.dp(20), style.dp(22)) }
        fun bind(p: LocalPlaylist) {
            spinner?.cancel(); removeAllViews()
            addView(style.text("MEZCLA DESTACADA", 10f, 900, style.subtle).apply { letterSpacing = .15f })
            addView(gap(14))
            val line = row().apply { minimumHeight = style.dp(190) }
            artwork = PlaylistArtwork(style, 86).apply { bind(p.artwork); background = style.shape(style.surface, 86, style.primary) }
            // Keep the circular artwork and the existing two-column composition.
            line.addView(artwork, LinearLayout.LayoutParams(style.dp(172), style.dp(172)).apply { marginEnd = style.dp(20) })
            val copy = column()
            copy.addView(style.text(p.name, 20f, 900).apply { maxLines = 2 })
            copy.addView(gap(7)); copy.addView(style.text(p.description.ifEmpty { "Una selección para escuchar sin interrupciones." }, 13f, color = style.subtle).apply { maxLines = 3 })
            copy.addView(gap(14)); copy.addView(icon("play", "Abrir ${p.name}") { emit("open", p.id) })
            line.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
            line.isFocusable = true; line.foreground = style.ripple(); line.setOnClickListener { emit("open", p.id) }; addView(line)
            if (catalog.playlists.size > 1) { addView(gap(30)); addView(style.text("TUS PLAYLISTS", 10f, 900, style.subtle).apply { letterSpacing = .15f }) }
            spin()
        }
        private fun spin() {
            spinner?.cancel()
            if (!isAttachedToWindow || style.lightweight || (Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled())) return
            spinner = ObjectAnimator.ofFloat(artwork, "rotation", 0f, 360f).apply { duration = 36000; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator(); start() }
        }
        override fun onAttachedToWindow() { super.onAttachedToWindow(); spin() }
        override fun onDetachedFromWindow() { spinner?.cancel(); super.onDetachedFromWindow() }
    }
    private inner class Hero : LinearLayout(ui) {
        private val art = PlaylistArtwork(style, 30)
        private val title = style.text("", 28f, 800).apply { gravity = Gravity.CENTER; maxLines = 2 }
        private val description = style.text("", 14f, color = style.subtle).apply { gravity = Gravity.CENTER; maxLines = 2 }
        private val count = style.text("", 12f, color = style.subtle).apply { gravity = Gravity.CENTER }
        private val actions = row().apply { gravity = Gravity.CENTER }
        private val toggle = button("Agregar canciones") { addOpen = !addOpen; updatePanel() }
        private val panel = column()
        private val search = field("Buscar en tu biblioteca", query)
        private val libraryList = RecyclerView(ui)
        private val libraryRows = LibraryRows()
        private val empty = style.text("", 14f, color = style.subtle).apply { gravity = Gravity.CENTER; setPadding(0, style.dp(24), 0, style.dp(24)) }
        init {
            orientation = VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(style.dp(20), style.dp(16), style.dp(20), style.dp(16))
            addView(art, LinearLayout.LayoutParams(style.dp(210), style.dp(210)))
            addView(gap(22)); addView(title, LinearLayout.LayoutParams(-1, -2)); addView(gap(7))
            addView(description, LinearLayout.LayoutParams(-1, -2)); addView(count, LinearLayout.LayoutParams(-1, -2)); addView(gap(24))
            addView(actions, LinearLayout.LayoutParams(-1, -2)); addView(gap(22)); addView(toggle, LinearLayout.LayoutParams(-1, -2))
            panel.addView(search.first); panel.addView(empty)
            libraryList.layoutManager = LinearLayoutManager(ui); libraryList.adapter = libraryRows; libraryList.itemAnimator = null
            panel.addView(libraryList, LinearLayout.LayoutParams(-1, style.dp(380))); addView(panel, LinearLayout.LayoutParams(-1, -2))
            search.second.changed { query = it; refreshLibrary() }
        }
        fun bind(p: LocalPlaylist) {
            art.bind(p.artwork); title.text = p.name; title.setTextColor(style.ink)
            description.setTextColor(style.subtle); count.setTextColor(style.subtle)
            toggle.backgroundTintList = ColorStateList.valueOf(style.surface); toggle.setTextColor(style.primary)
            description.text = p.description; description.visibility = if (p.description.isEmpty()) GONE else VISIBLE
            val seconds = p.duration / 1000
            count.text = "${p.entries.size} songs • ${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
            actions.removeAllViews()
            actions.addView(icon("play", "Reproducir playlist", true) { catalog.find(selection.id)?.playable?.firstOrNull()?.let { emit("play", it) } }.apply { isEnabled = p.playable.isNotEmpty(); alpha = if (isEnabled) 1f else .4f })
            actions.addView(icon("shuffle", "Aleatorio") { catalog.find(selection.id)?.playable?.randomOrNull()?.let { emit("shuffle", it) } }.apply { isEnabled = p.playable.isNotEmpty() })
            actions.addView(icon("edit", "Edit playlist") { editPlaylist() }.apply { isEnabled = !p.readonly; alpha = if (isEnabled) 1f else .4f })
            toggle.visibility = if (p.readonly) GONE else VISIBLE
            updatePanel()
        }
        private fun updatePanel() {
            toggle.text = if (addOpen) "Cerrar" else "Agregar canciones"
            panel.visibility = if (addOpen && catalog.find(selection.id)?.readonly == false) VISIBLE else GONE
            refreshLibrary()
        }
        fun refreshLibrary() {
            val songs = if (addOpen) catalog.library(query) else emptyList()
            libraryRows.submitList(songs) { libraryRows.notifyItemRangeChanged(0, libraryRows.itemCount) }
            empty.text = if (catalog.library.isEmpty()) "No hay canciones en tu biblioteca todavía" else "No hay resultados"
            empty.visibility = if (songs.isEmpty()) VISIBLE else GONE
            libraryList.visibility = if (songs.isEmpty()) GONE else VISIBLE
        }
    }
    private inner class LibraryRows : ListAdapter<Song, LibraryHolder>(object : DiffUtil.ItemCallback<Song>() {
        override fun areItemsTheSame(a: Song, b: Song) = a.id == b.id
        override fun areContentsTheSame(a: Song, b: Song) = a == b
    }) {
        override fun onCreateViewHolder(parent: ViewGroup, type: Int) = LibraryHolder(SongRow())
        override fun onBindViewHolder(holder: LibraryHolder, position: Int) { holder.view.bind(Entry(getItem(position).id, getItem(position)), position, true) }
    }
    private inner class LibraryHolder(val view: SongRow) : RecyclerView.ViewHolder(view)
    private inner class SongRow : LinearLayout(ui) {
        init { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = style.dp(68); layoutParams = RecyclerView.LayoutParams(-1, -2) }
        fun bind(entry: Entry, index: Int, library: Boolean = false) {
            removeAllViews(); setPadding(style.dp(if (library) 0 else 16), style.dp(6), style.dp(if (library) 0 else 12), style.dp(6))
            val song = entry.song
            val playing = playback.optString("id") == song.id || (song.tidalId.isNotEmpty() && playback.optString("tidalId") == song.tidalId) || (song.spotifyId.isNotEmpty() && playback.optString("spotifyId") == song.spotifyId)
            if (!library) addView(style.text("${index + 1}", 12f, color = if (playing) style.primary else style.subtle).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(style.dp(28), -2))
            addView(PlaylistArtwork(style, 8).apply { bind(song.artwork) }, LinearLayout.LayoutParams(style.dp(44), style.dp(44)))
            val copy = column().apply { setPadding(style.dp(12), 0, style.dp(8), 0) }
            copy.addView(style.text(song.title, 15f, 700, if (playing) style.primary else style.ink).apply { maxLines = 1 })
            copy.addView(style.text(song.artist, 12f, color = style.subtle).apply { maxLines = 1 })
            addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
            val selected = catalog.find(selection.id)?.entries?.any { it.song.id == song.id } == true
            val state = downloads.optJSONObject(entry.memberId)
            val actionLabel = if (library) { if (selected) "Quitar de playlist" else "Agregar a playlist" } else if (song.remote) "Descargar" else "Opciones de ${song.title}"
            val control = icon(if (library) { if (selected) "done" else "add" } else if (song.remote) "download" else "more", actionLabel) {
                if (library) emit("toggle", song.id) else if (song.remote) emit("download", entry) else trackMenu(entry)
            }
            if (!library && state?.optBoolean("busy") == true) {
                control.removeAllViews(); control.isEnabled = false
                val progress = state.optInt("progress", -1)
                control.contentDescription = "Descargando ${song.title}${if (progress >= 0) ", $progress%" else ""}"
                control.addView(style.text(if (progress < 0) "..." else "$progress%", 12f, color = style.primary).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, -1))
            }
            if (!library && !song.playable) control.isEnabled = false
            addView(control)
            isFocusable = true; foreground = style.ripple(); contentDescription = "${song.title}, ${song.artist}${if (playing) ", Reproduciéndose ahora" else ""}"
            setOnClickListener { if (library) emit("libraryPlay", song.id) else emit("play", entry) }
            setOnLongClickListener { if (!library) { trackMenu(entry); true } else false }
        }
    }
    private fun menu(title: String, options: List<Pair<String, () -> Unit>>) {
        dialog?.dismiss()
        dialog = MaterialAlertDialogBuilder(ui).setTitle(title).setItems(options.map { it.first }.toTypedArray()) { _, which -> options[which].second() }
            .setNegativeButton("Cancel", null).show()
    }
    private fun confirm(title: String, message: String, label: String, action: () -> Unit) {
        dialog?.dismiss()
        dialog = MaterialAlertDialogBuilder(ui).setTitle(title).setMessage(message).setNegativeButton("Cancel", null)
            .setPositiveButton(label) { _, _ -> action() }.show()
    }
    private fun trackMenu(entry: Entry) {
        val song = entry.song
        menu(song.title, buildList {
            if (song.playable) add("Agregar a cola" to { emit("queue", entry) })
            if (song.remote && song.playable) add("Descargar" to { emit("download", entry) })
            if (catalog.find(selection.id)?.readonly == false) add("Quitar de playlist" to { emit("remove", entry) })
            if (!song.remote) {
                add("Agregar a playlist" to {
                    menu("Agregar a playlist", buildList {
                        add("New playlist" to { emit("newWithTrack", entry) })
                        catalog.playlists.filter { !it.readonly }.take(6).forEach { p -> add(p.name to { emit("addToPlaylist", song.id, entry.memberId, p.id) }) }
                    })
                })
                add("Quitar de la biblioteca" to { confirm("¿Eliminar de la biblioteca?", "Esta acción quitará \"${song.title}\" de tu colección. El archivo permanecerá en tu dispositivo.", "Eliminar") { emit("deleteTrack", entry) } })
                add("Borrar del dispositivo" to { confirm("¿Borrar del dispositivo?", "¡Cuidado! Se borrará el archivo \"${song.title}\" permanentemente de tu almacenamiento. No se puede deshacer.", "Borrar archivo") { emit("deleteFile", entry) } })
            }
        })
    }
    private fun editPlaylist() {
        val p = catalog.find(selection.id)?.takeUnless { it.readonly } ?: return
        dialog?.dismiss(); editor = Editor(p).also { it.show() }
    }
    private inner class Editor(private val p: LocalPlaylist) {
        val requestId = UUID.randomUUID().toString()
        private var artwork = p.artwork
        private var committed = false
        private val name = field("Name", p.name)
        private val description = field("Description", p.description, true)
        private val cover = PlaylistArtwork(style, 16)
        private val remove = button("Remove image") { setCover("") }
        private var alert: AlertDialog? = null
        fun setCover(uri: String) { artwork = uri; cover.bind(uri); remove.visibility = if (uri.isEmpty()) GONE else VISIBLE }
        fun show() {
            val content = column().apply { setPadding(style.dp(24), style.dp(8), style.dp(24), style.dp(8)) }
            content.addView(name.first); content.addView(gap(10)); content.addView(description.first); content.addView(gap(12))
            content.addView(cover, LinearLayout.LayoutParams(style.dp(72), style.dp(72)))
            content.addView(button("Select from gallery") { emit("pickCover", requestId = requestId) }); content.addView(remove)
            content.addView(button("Eliminar playlist") {
                alert?.dismiss()
                confirm("¿Eliminar playlist?", "Se eliminará \"${p.name}\". Las canciones permanecerán en tu biblioteca.", "Eliminar") { emit("deletePlaylist") }
            })
            setCover(artwork)
            alert = MaterialAlertDialogBuilder(ui).setTitle("Edit playlist").setView(ScrollView(ui).apply { addView(content) })
                .setNegativeButton("Cancel", null).setPositiveButton("Save", null).create()
            alert?.setOnDismissListener {
                if (!committed) emit("cancelCover", requestId = requestId)
                if (editor === this) editor = null
            }
            alert?.show(); dialog = alert
            alert?.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            val save = alert?.getButton(AlertDialog.BUTTON_POSITIVE)
            save?.isEnabled = name.second.text.toString().isNotBlank()
            name.second.changed { save?.isEnabled = it.isNotBlank() }
            save?.setOnClickListener {
                if (name.second.text.toString().isBlank()) return@setOnClickListener
                committed = true
                emit("edit", name = name.second.text.toString(), description = description.second.text.toString(), artwork = artwork, requestId = requestId)
                alert?.dismiss()
            }
        }
    }
    private inner class PathChoice(label: String, description: String, click: () -> Unit) : LinearLayout(ui) {
        private val indicator = View(ui)
        private val title = style.text(label, 17f, 700)
        private val subtitle = style.text(description, 13f, color = style.subtle)
        private val chevron = PlaylistGlyph(style, "back", style.subtle)
        init {
            orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = style.dp(84)
            setPadding(style.dp(16), style.dp(18), style.dp(16), style.dp(18))
            addView(indicator, LinearLayout.LayoutParams(style.dp(3), style.dp(36)).apply { marginEnd = style.dp(16) })
            addView(column().apply { addView(title); addView(gap(3)); addView(subtitle) }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(chevron, LinearLayout.LayoutParams(style.dp(18), style.dp(18)))
            isFocusable = true; isClickable = true; foreground = style.ripple(24); setOnClickListener { click() }
            accessibilityDelegate = object : View.AccessibilityDelegate() {
                override fun onInitializeAccessibilityNodeInfo(host: View, info: android.view.accessibility.AccessibilityNodeInfo) {
                    super.onInitializeAccessibilityNodeInfo(host, info); info.className = "android.widget.Button"; info.isSelected = isSelected
                }
            }
        }
        fun paint(active: Boolean) {
            isSelected = active
            background = style.shape(style.alpha(if (active) style.variant else style.surface, 150), 24, style.alpha(if (active) style.primary else style.outline, 70))
            indicator.background = style.shape(if (active) style.primary else android.graphics.Color.TRANSPARENT, 2)
            title.setTextColor(if (active) style.ink else style.subtle); subtitle.setTextColor(style.subtle)
            chevron.rotation = if (active) 270f else 180f
        }
    }
    private inner class Creator : LinearLayout(ui) {
        private var path = ""
        private var loading = false
        private val hero = style.text("¿Cómo quieres\nempezar?", 34f, 800)
        private val manual = column()
        private val spotify = column()
        private val name = field("Nombre de la playlist")
        private val url = field("open.spotify.com/playlist/...")
        private val create = button("Crear playlist") { submitName() }
        private val importButton = button("Importar") { if (validUrl() && !loading) { setLoading(true); emit("import", name = url.second.text.toString()) } }
        private val error = style.text("", 13f, color = style.color("error", android.graphics.Color.RED))
        private val progress = CircularProgressIndicator(ui).apply { isIndeterminate = true; contentDescription = "Importando…"; setIndicatorColor(style.primary) }
        private val spotifyOption = PathChoice("Importar de Spotify", "Pega la URL de una playlist pública") { select("spotify") }
        private val manualOption = PathChoice("Crear desde cero", "Ponle nombre y agrega canciones de tu biblioteca") { select("manual") }
        init {
            orientation = VERTICAL
            addView(gap(28)); addView(style.text("Crear playlist", 12f, 800, style.primary)); addView(gap(6)); addView(hero); addView(gap(28))
            addView(spotifyOption); addView(gap(16))
            spotify.addView(url.first); spotify.addView(importButton); spotify.addView(progress); spotify.addView(error); addView(spotify)
            addView(gap(12)); addView(manualOption); addView(gap(16))
            manual.addView(name.first); manual.addView(create); addView(manual)
            url.second.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            url.second.changed { if (!loading) { error.text = ""; importButton.isEnabled = validUrl() } }
            name.second.changed { create.isEnabled = it.isNotBlank() && !loading }
            name.second.imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            name.second.setOnEditorActionListener { _, action, _ -> if (action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) { submitName(); true } else false }
            create.isEnabled = false; setLoading(false); updatePath(); paint()
        }
        fun paint() {
            hero.setTextColor(style.ink)
            listOf(create, importButton).forEach { it.backgroundTintList = ColorStateList.valueOf(style.primary); it.setTextColor(style.onPrimary) }
            spotifyOption.paint(path == "spotify"); manualOption.paint(path == "manual")
        }
        private fun validUrl() = Regex("(spotify\\.com/playlist/|spotify:playlist:)", RegexOption.IGNORE_CASE).containsMatchIn(url.second.text.toString())
        private fun submitName() { if (name.second.text.toString().isNotBlank() && !loading) { create.isEnabled = false; emit("create", name = name.second.text.toString()) } }
        private fun select(next: String) {
            if (loading) return
            path = if (path == next) "" else next; updatePath()
            if (path == "spotify") emit("clipboard")
            if (path == "manual") { name.second.requestFocus(); name.second.post { (ui.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).showSoftInput(name.second, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT) } }
        }
        private fun updatePath() { manual.visibility = if (path == "manual") VISIBLE else GONE; spotify.visibility = if (path == "spotify") VISIBLE else GONE; spotifyOption.paint(path == "spotify"); manualOption.paint(path == "manual") }
        private fun setLoading(value: Boolean) {
            loading = value; importButton.text = if (value) "Importando…" else "Importar"
            importButton.isEnabled = !value && validUrl(); url.second.isEnabled = !value; name.second.isEnabled = !value
            create.isEnabled = !value && name.second.text.toString().isNotBlank()
            manualOption.isEnabled = !value; spotifyOption.isEnabled = !value; progress.visibility = if (value) VISIBLE else GONE
        }
        fun importResponse(response: JSONObject) {
            path = "spotify"; updatePath()
            if (response.has("url")) url.second.setText(response.optString("url"))
            error.text = response.optString("error"); setLoading(response.optBoolean("loading"))
        }
    }
}
