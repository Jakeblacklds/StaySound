package expo.modules.tidaldetailview

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import androidx.recyclerview.widget.StaggeredGridLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class TidalDetailView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val s = TidalStyle(ui)
    private val root = FrameLayout(ui)
    private val backdrop = TidalArtwork(s, 0, true)
    private val wash = View(ui)
    private val portrait = TidalArtwork(s, 0)
    private val portraitFade = View(ui)
    private val list = RecyclerView(ui)
    private val toolbar = FrameLayout(ui)
    private val barFill = View(ui)
    private val barTitle = s.text("", 16f, 600)
    private val back = icon("back", "Volver", Color.WHITE) { emit("back") }
    private val state = DetailListState()
    private var model = TidalDetailModel()
    private val adapter = DetailAdapter()
    private var topInset = 0
    private var bottomInset = 140
    private var scrollOffset = 0
    private var dialog: androidx.appcompat.app.AlertDialog? = null
    private var lastRaw = ""
    private val heroHeight get() = (resources.displayMetrics.heightPixels / resources.displayMetrics.density * 0.5f).toInt()

    init {
        addView(root, LayoutParams(-1, -1))
        root.addView(backdrop, FrameLayout.LayoutParams(-1, -1))
        root.addView(wash, FrameLayout.LayoutParams(-1, -1))
        root.addView(portrait, FrameLayout.LayoutParams(-1, s.dp(heroHeight)))
        root.addView(portraitFade, FrameLayout.LayoutParams(-1, s.dp(heroHeight)))
        list.layoutManager = LinearLayoutManager(ui)
        list.adapter = adapter; list.itemAnimator = null; list.clipToPadding = false
        list.isVerticalScrollBarEnabled = false
        root.addView(list, FrameLayout.LayoutParams(-1, -1))
        toolbar.addView(barFill, FrameLayout.LayoutParams(-1, -1))
        barTitle.gravity = Gravity.CENTER; barTitle.maxLines = 1
        toolbar.addView(barTitle, FrameLayout.LayoutParams(-1, s.dp(52)).apply { leftMargin = s.dp(64); rightMargin = s.dp(64) })
        back.background = s.shape(0x47000000, 24)
        toolbar.addView(back, FrameLayout.LayoutParams(s.dp(48), s.dp(48)).apply { leftMargin = s.dp(8) })
        root.addView(toolbar, FrameLayout.LayoutParams(-1, s.dp(52)))
        list.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) { scrollOffset = (scrollOffset + dy).coerceAtLeast(0); updateScroll() }
        })
        updateAppearance(); render()
    }
    fun setModel(raw: String) {
        if (raw == lastRaw) return
        lastRaw = raw
        val next = TidalDetailModel.parse(raw)
        val changed = next.screenKey != model.screenKey
        val artworkChanged = next.artwork != model.artwork || next.kind != model.kind
        model = next; state.accept(next)
        if (changed) {
            dialog?.dismiss(); scrollOffset = 0
            list.layoutManager = if (model.kind == DetailKind.genre) StaggeredGridLayoutManager(2, RecyclerView.VERTICAL) else LinearLayoutManager(ui)
        }
        if (artworkChanged || changed) updateAppearance()
        barTitle.text = model.title
        render(); updateScroll()
    }
    // Rows are rebuilt on bind, so the palette eases at ~20 fps rather than every frame.
    private val appearance = expo.modules.playerchrome.AppearanceTween(this, frameMs = 48) { value ->
        if (s.colors != value) { s.colors = value; updateAppearance(); adapter.notifyDataSetChanged() }
    }
    fun setAppearance(value: Map<String, String>) = appearance.set(value)
    fun setTopInset(value: Double) { topInset = value.toInt().coerceAtLeast(0); updateInsets(); adapter.notifyDataSetChanged() }
    fun setBottomInset(value: Double) { bottomInset = value.toInt().coerceAtLeast(0); updateInsets() }
    private fun updateInsets() {
        toolbar.layoutParams.height = s.dp(topInset + 52)
        (barTitle.layoutParams as FrameLayout.LayoutParams).topMargin = s.dp(topInset)
        (back.layoutParams as FrameLayout.LayoutParams).topMargin = s.dp(topInset + 2)
        list.setPadding(if (model.kind == DetailKind.genre) s.dp(10) else 0, 0, if (model.kind == DetailKind.genre) s.dp(10) else 0, s.dp(bottomInset))
        toolbar.requestLayout()
    }
    private fun updateAppearance() {
        root.setBackgroundColor(s.background)
        val isArtist = model.kind == DetailKind.artist
        portrait.visibility = if (isArtist) VISIBLE else GONE
        portraitFade.visibility = portrait.visibility
        portrait.bind(model.artwork)
        portraitFade.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.TRANSPARENT, 0x26000000, s.alpha(s.background, 230), s.background))
        val artworkBackdrop = !s.lightweight && model.kind in listOf(DetailKind.album, DetailKind.playlist) && model.artwork.isNotEmpty()
        backdrop.visibility = if (artworkBackdrop) VISIBLE else GONE
        if (artworkBackdrop) backdrop.bind(model.artwork)
        wash.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, if (s.lightweight) intArrayOf(s.background, s.background)
            else if (artworkBackdrop) intArrayOf(if (s.dark) 0x80000000.toInt() else 0x70FFFFFF, s.alpha(s.background, 180), s.background)
            else intArrayOf(androidx.core.graphics.ColorUtils.blendARGB(s.background, s.primary, if (s.dark) .30f else .25f), s.background))
        barFill.setBackgroundColor(s.alpha(s.background, 240)); barTitle.setTextColor(s.ink)
        updateInsets(); updateScroll()
    }
    private fun updateScroll() {
        val y = scrollOffset / resources.displayMetrics.density
        val threshold = when (model.kind) { DetailKind.artist -> heroHeight * .5f; DetailKind.genre -> 120f; else -> 220f }
        barFill.alpha = ((y - threshold * .5f) / (threshold * .5f)).coerceIn(0f, 1f)
        barTitle.alpha = ((y - threshold * .7f) / (threshold * .3f)).coerceIn(0f, 1f)
        barTitle.translationY = s.dp(8) * (1f - barTitle.alpha)
        portrait.translationY = -scrollOffset * .3f
        portraitFade.translationY = portrait.translationY
        portrait.alpha = (1f - y / (heroHeight * .7f)).coerceIn(0f, 1f)
        portraitFade.alpha = portrait.alpha
    }
    private fun emit(action: String, id: String = "", kind: String = "") {
        DetailActions.create(model, action, id, kind)?.let { onAction(it.payload()) }
    }
    private fun navigate(link: DetailLink) = emit("navigate", link.id, link.kind.name)
    private fun icon(kind: String, label: String, tint: Int = s.ink, click: () -> Unit): View = TidalGlyph(s, kind, tint).apply {
        contentDescription = label; setPadding(s.dp(13), s.dp(13), s.dp(13), s.dp(13))
        foreground = s.ripple(24); isFocusable = true; setOnClickListener { click() }
    }
    private fun column() = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
    private fun line() = LinearLayout(ui).apply { gravity = Gravity.CENTER_VERTICAL }
    private fun label(value: String, size: Float, weight: Int = 500, color: Int = s.ink, lines: Int = 1) = s.text(value, size, weight, color).apply { maxLines = lines }
    private fun heading(title: String, kicker: String, top: Int = 32) = column().apply {
        setPadding(s.dp(20), s.dp(top), s.dp(20), s.dp(14))
        addView(label(kicker.uppercase(), 11f, 600, s.primary).apply { letterSpacing = .1f })
        addView(label(title, 20f, 700, lines = 2), LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(6) })
    }
    private data class Row(val key: String, val type: Int, val data: Any? = null)
    private data class TrackRow(val track: DetailTrack, val index: Int, val first: Boolean, val last: Boolean)
    private fun render() {
        val rows = mutableListOf<Row>()
        when (state.phase(model)) {
            "loading" -> rows.add(Row("loading", 0))
            "error" -> rows.add(Row("error", 1, model.error))
            else -> {
                rows.add(Row("hero", 2, model.copy(tracks = emptyList(), grid = emptyList(), sections = emptyList())))
                if (model.kind == DetailKind.genre) {
                    state.grid(model).forEachIndexed { index, link -> rows.add(Row("grid:${link.kind}:${link.id}", 7, index to link)) }
                    if (state.visibleCount < model.grid.size) rows.add(Row("more", 8, state.visibleCount to model.grid.size))
                } else {
                    rows.add(Row("actions", 3, Triple(model.preparing, model.downloadingAll, model.tracks.isEmpty())))
                    if (model.kind == DetailKind.artist && model.tracks.isNotEmpty()) rows.add(Row("tracksTitle", 4, "Popular" to "Lo más sonado"))
                    if (model.kind == DetailKind.playlist) rows.add(Row("tracksTitle", 4, "Canciones" to "En esta lista"))
                    val tracks = state.tracks(model)
                    tracks.forEachIndexed { i, track -> rows.add(Row("track:$i:${track.id}", 5, TrackRow(track, i, i == 0, i == tracks.lastIndex))) }
                    if (model.kind == DetailKind.artist && model.tracks.size > 8) rows.add(Row("expand", 9, state.expanded to model.tracks.size))
                    model.sections.filter { it.items.isNotEmpty() }.forEachIndexed { index, section ->
                        rows.add(Row("sectionTitle:$index", 4, section.title to section.kicker)); rows.add(Row("rail:$index", 6, section))
                    }
                }
                if (state.phase(model) == "empty") rows.add(Row("empty", 10))
            }
        }
        adapter.submitList(rows)
    }
    private fun hero(): View {
        val artist = model.kind == DetailKind.artist
        val genre = model.kind == DetailKind.genre
        val wrap = column().apply { clipChildren = false; clipToPadding = false }
        wrap.setPadding(s.dp(if (genre) 6 else 20), s.dp(if (artist) (heroHeight - 150).coerceAtLeast(topInset + 64) else topInset + 64), s.dp(if (genre) 6 else 20), s.dp(if (genre) 24 else 22))
        val copy = column()
        copy.addView(label(model.kicker, 11f, 600, s.primary).apply { letterSpacing = .12f })
        copy.addView(label(model.title, if (artist || genre) 40f else 24f, 700, if (artist) Color.WHITE else s.ink, if (artist) 2 else 3), LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(6) })
        if (model.subtitle.isNotEmpty()) copy.addView(label(model.subtitle, 14f, 500, s.subtle, 2).apply {
            setPadding(0, s.dp(6), 0, s.dp(6))
            if (model.artistLink != null) { minimumHeight = s.dp(48); gravity = Gravity.CENTER_VERTICAL; foreground = s.ripple(); setOnClickListener { model.artistLink?.let(::navigate) }; isFocusable = true }
        })
        if (model.description.isNotEmpty()) copy.addView(label(model.description, 13f, 500, s.subtle, 2), LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(6) })
        if (model.meta.isNotEmpty() && !artist) copy.addView(label(model.meta, if (artist) 14f else 13f, 500, if (artist) 0xD1FFFFFF.toInt() else s.subtle, 3), LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(6) })
        if (model.quality.isNotEmpty() || model.explicit || artist) copy.addView(line().apply {
            setPadding(0, s.dp(8), 0, 0)
            for (value in listOf(model.quality, if (model.explicit) "E" else "").filter { it.isNotEmpty() }) addView(label(value, 11f, 800, if (artist) Color.WHITE else s.ink).apply {
                setPadding(s.dp(9), s.dp(3), s.dp(9), s.dp(3)); background = s.shape(s.alpha(s.primary, 38), 8, s.alpha(s.primary, 85))
            }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = s.dp(8) })
            if (artist && model.meta.isNotEmpty()) addView(label(model.meta, 14f, 500, 0xD1FFFFFF.toInt(), 3), LinearLayout.LayoutParams(0, -2, 1f))
        })
        if (artist || genre) wrap.addView(copy) else wrap.addView(LinearLayout(ui).apply {
            gravity = Gravity.BOTTOM; clipChildren = false; clipToPadding = false
            // Preserve 148 dp covers on phones, shrink only in unusually narrow multiwindow layouts.
            val available = (if (width > 0) width else resources.displayMetrics.widthPixels) / resources.displayMetrics.density
            val coverSize = minOf(148, (available * .40f).toInt())
            addView(TidalArtwork(s, 24).apply { bind(model.artwork); elevation = s.dp(14).toFloat() }, LinearLayout.LayoutParams(s.dp(coverSize), s.dp(coverSize)))
            addView(copy, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = s.dp(18) })
        })
        return wrap
    }
    private fun actionButton(kind: String, description: String, busy: Boolean, enabled: Boolean, primary: Boolean = false, click: () -> Unit): View = line().apply {
        gravity = Gravity.CENTER
        background = s.shape(if (primary) s.primary else Color.TRANSPARENT, 24, if (primary) null else s.alpha(s.ink, 36))
        foreground = s.ripple(24); contentDescription = if (busy) "$description, preparando" else description
        val tint = if (primary) s.onPrimary else s.ink
        if (busy) addView(ProgressBar(ui).apply { indeterminateTintList = ColorStateList.valueOf(tint) }, LinearLayout.LayoutParams(s.dp(20), s.dp(20)))
        else addView(TidalGlyph(s, kind, tint), LinearLayout.LayoutParams(s.dp(20), s.dp(20)))
        if (primary) addView(label("Reproducir", 16f, 800, tint), LinearLayout.LayoutParams(-2, -2).apply { marginStart = s.dp(8) })
        isEnabled = enabled; alpha = if (enabled || busy) 1f else .45f; isFocusable = true
        setOnClickListener { click() }
    }
    private fun actions() = line().apply {
        setPadding(s.dp(20), 0, s.dp(20), s.dp(30))
        addView(actionButton("play", "Reproducir", model.preparing == "play", model.tracks.isNotEmpty() && model.preparing.isEmpty(), true) { emit("playAll") }, LinearLayout.LayoutParams(0, s.dp(54), 1f))
        addView(actionButton("shuffle", "Reproducción aleatoria", model.preparing == "shuffle", model.tracks.isNotEmpty() && model.preparing.isEmpty()) { emit("shuffle") }, LinearLayout.LayoutParams(s.dp(54), s.dp(54)).apply { marginStart = s.dp(12) })
        addView(actionButton("download", "Descargar todo", model.downloadingAll, model.tracks.isNotEmpty() && !model.downloadingAll) { emit("downloadAll") }, LinearLayout.LayoutParams(s.dp(54), s.dp(54)).apply { marginStart = s.dp(12) })
    }
    private fun textButton(title: String, subtitle: String = "", click: () -> Unit) = column().apply {
        gravity = Gravity.CENTER; minimumHeight = s.dp(48); setPadding(s.dp(16), s.dp(14), s.dp(16), s.dp(14))
        addView(label(title, 14f, 700, s.primary, 2))
        if (subtitle.isNotEmpty()) addView(label(subtitle, 13f, 500, s.subtle), LinearLayout.LayoutParams(-2, -2).apply { topMargin = s.dp(4) })
        background = s.shape(s.alpha(s.surface, 208), 24, s.alpha(s.outline, 64)); foreground = s.ripple(24)
        isFocusable = true; setOnClickListener { click() }
    }
    private fun showOptions(track: DetailTrack) {
        val screenKey = model.screenKey
        dialog?.dismiss()
        val downloadLabel = when (track.status) { "downloading" -> "Cancelar descarga"; "done" -> "Descargada"; "error" -> "Reintentar descarga"; else -> "Descargar" }
        dialog = MaterialAlertDialogBuilder(ui).setTitle(track.title)
            .setItems(arrayOf("Reproducir", "Agregar a cola", downloadLabel)) { _, which ->
                if (screenKey == model.screenKey) emit(when (which) { 0 -> "play"; 1 -> "queue"; else -> if (track.status == "downloading") "cancelDownload" else "download" }, track.id)
            }.setNegativeButton("Cancelar", null).show()
    }
    private inner class TrackHolder(val panel: LinearLayout) : RecyclerView.ViewHolder(panel) {
        private val row = line()
        private val artwork = TidalArtwork(s, 12)
        private val artDock = FrameLayout(ui)
        private val artMark = FrameLayout(ui)
        private val panelSurface = FrameLayout(ui)
        private val downloadIndicator = TidalDownloadIndicator(s)
        private val index = FrameLayout(ui)
        private val title = label("", 14f, 600)
        private val subtitle = label("", 12f, 500, s.subtle)
        private val download = FrameLayout(ui)
        private var current: DetailTrack? = null
        init {
            panel.setPadding(s.dp(16), 0, s.dp(16), 0)
            panel.addView(panelSurface, LinearLayout.LayoutParams(-1, -2))
            panelSurface.setPadding(s.dp(4), 0, s.dp(4), 0)
            panelSurface.addView(row, FrameLayout.LayoutParams(-1, -2))
            row.minimumHeight = s.dp(64); row.setPadding(s.dp(16), s.dp(8), s.dp(4), s.dp(8))
            artDock.addView(artwork, FrameLayout.LayoutParams(-1, -1))
            artMark.background = s.shape(0x6B000000, 12)
            artDock.addView(artMark, FrameLayout.LayoutParams(-1, -1))
            row.addView(artDock, LinearLayout.LayoutParams(s.dp(52), s.dp(52)))
            row.addView(index, LinearLayout.LayoutParams(s.dp(30), s.dp(30)))
            row.addView(column().apply { addView(title); addView(subtitle, LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(4) }) }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = s.dp(14) })
            download.addView(downloadIndicator, FrameLayout.LayoutParams(s.dp(32), s.dp(32), Gravity.CENTER))
            row.addView(download, LinearLayout.LayoutParams(s.dp(48), s.dp(48)))
            row.addView(icon("more", "Opciones de canción") { current?.let(::showOptions) }, LinearLayout.LayoutParams(s.dp(48), s.dp(48)))
            row.foreground = s.ripple(); row.isFocusable = true
            row.setOnClickListener { current?.let { emit("play", it.id) } }
            row.setOnLongClickListener { current?.let(::showOptions); true }
            download.foreground = s.ripple(24); download.isFocusable = true
            download.setOnClickListener { current?.let { emit(if (it.status == "downloading") "cancelDownload" else "download", it.id) } }
        }
        fun bind(value: TrackRow) {
            val t = value.track; current = t
            title.text = t.title; title.setTextColor(if (t.active) s.primary else s.ink)
            val seconds = t.durationMs / 1000
            subtitle.text = t.artist + if (seconds > 0) " · ${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}" else ""
            subtitle.setTextColor(s.subtle)
            panelSurface.background = s.shape(s.alpha(s.surface, if (s.dark) 208 else 224), 0).apply {
                val top = if (value.first) s.dp(28).toFloat() else 0f
                val bottom = if (value.last) s.dp(28).toFloat() else 0f
                cornerRadii = floatArrayOf(top, top, top, top, bottom, bottom, bottom, bottom)
            }
            panelSurface.setPadding(s.dp(4), if (value.first) s.dp(8) else 0, s.dp(4), if (value.last) s.dp(8) else 0)
            row.background = s.shape(if (t.active) s.alpha(s.primary, 31) else Color.TRANSPARENT, 16)
            val album = model.kind == DetailKind.album
            artDock.visibility = if (album) GONE else VISIBLE
            artMark.visibility = if (t.active) VISIBLE else GONE
            artMark.removeAllViews()
            if (t.active) artMark.addView(TidalGlyph(s, if (t.playing) "playing" else "pause", Color.WHITE), FrameLayout.LayoutParams(s.dp(18), s.dp(18), Gravity.CENTER))
            index.visibility = if (album) VISIBLE else GONE
            artwork.bind(t.artwork)
            index.removeAllViews()
            val mark = if (t.active) TidalGlyph(s, if (t.playing) "playing" else "pause", s.primary) else label("${value.index + 1}", 15f, 600, s.subtle).apply { gravity = Gravity.CENTER }
            index.addView(mark, FrameLayout.LayoutParams(-1, -1))
            row.contentDescription = "${t.title}, ${t.artist}" + if (t.active) ", ${if (t.playing) "Reproduciendo" else "Preparando"}" else ""
            download.isEnabled = t.status != "done"
            download.contentDescription = when (t.status) { "downloading" -> "Cancelar descarga, ${(t.progress * 100).toInt()} por ciento"; "done" -> "Descargada"; "error" -> "Reintentar descarga"; else -> "Descargar" }
            downloadIndicator.bind(t.status, t.progress)
        }
    }
    private fun card(link: DetailLink, size: Int, circle: Boolean, mosaicHeight: Int = 0): View {
        val wrap = if (mosaicHeight > 0) FrameLayout(ui) else column()
        val cover = TidalArtwork(s, if (circle) size / 2 else if (mosaicHeight > 0) 28 else 16).apply { bind(link.artwork) }
        if (wrap is FrameLayout) {
            wrap.background = s.shape(s.variant, 28); wrap.clipToOutline = true
            wrap.addView(cover, FrameLayout.LayoutParams(-1, -1))
            wrap.addView(View(ui).apply { background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.TRANSPARENT, 0x4D0C0C0E, 0xD90C0C0E.toInt())) }, FrameLayout.LayoutParams(-1, (s.dp(mosaicHeight) * .6f).toInt(), Gravity.BOTTOM))
            wrap.addView(column().apply {
                setPadding(s.dp(16), s.dp(12), s.dp(16), s.dp(16))
                addView(label(link.title, 15f, 800, Color.WHITE, 2))
                addView(label(link.subtitle, 12f, 500, 0xB3FFFFFF.toInt()), LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(4) })
            }, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        } else if (wrap is LinearLayout) {
            wrap.addView(cover, LinearLayout.LayoutParams(s.dp(size), s.dp(size)))
            wrap.addView(label(link.title, 14f, 600, lines = 2).apply { if (circle) gravity = Gravity.CENTER }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(10) })
            if (link.subtitle.isNotEmpty()) wrap.addView(label(link.subtitle, 12f, 500, s.subtle), LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(4) })
        }
        wrap.foreground = s.ripple(if (mosaicHeight > 0) 28 else 16); wrap.isFocusable = true
        wrap.contentDescription = "${link.title}, ${link.subtitle}"; wrap.setOnClickListener { navigate(link) }
        return wrap
    }
    private fun rail(section: DetailSection): View = RecyclerView(ui).apply {
        layoutManager = LinearLayoutManager(ui, RecyclerView.HORIZONTAL, false)
        setPadding(s.dp(20), 0, s.dp(4), 0); clipToPadding = false; isHorizontalScrollBarEnabled = false
        adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            override fun getItemCount() = section.items.size
            override fun onCreateViewHolder(parent: ViewGroup, type: Int) = object : RecyclerView.ViewHolder(FrameLayout(ui).apply {
                layoutParams = RecyclerView.LayoutParams(s.dp(section.size + 16), -1); setPadding(0, 0, s.dp(16), 0)
            }) {}
            override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
                (holder.itemView as FrameLayout).apply { removeAllViews(); addView(card(section.items[position], section.size, section.circle), FrameLayout.LayoutParams(-1, -2)) }
            }
        }
        layoutParams = FrameLayout.LayoutParams(-1, s.dp(section.size + 88))
    }
    private fun loading() = column().apply {
        setPadding(s.dp(20), s.dp(topInset + 64), s.dp(20), 0)
        contentDescription = "Cargando detalle"
        fun block(height: Int, width: Int = -1) = View(ui).apply { background = s.shape(s.alpha(s.subtle, 35), 24); layoutParams = LinearLayout.LayoutParams(if (width < 0) width else s.dp(width), s.dp(height)).apply { bottomMargin = s.dp(16) } }
        addView(block(if (model.kind == DetailKind.artist) 260 else 148))
        addView(block(54))
        repeat(5) { addView(block(64)) }
    }
    private inner class DetailAdapter : ListAdapter<Row, RecyclerView.ViewHolder>(object : DiffUtil.ItemCallback<Row>() {
        override fun areItemsTheSame(a: Row, b: Row) = a.key == b.key && a.type == b.type
        override fun areContentsTheSame(a: Row, b: Row) = a == b
    }) {
        override fun getItemViewType(position: Int) = getItem(position).type
        override fun onCreateViewHolder(parent: ViewGroup, type: Int): RecyclerView.ViewHolder {
            if (type == 5) return TrackHolder(column().apply { layoutParams = RecyclerView.LayoutParams(-1, -2) })
            return object : RecyclerView.ViewHolder(FrameLayout(ui).apply { layoutParams = RecyclerView.LayoutParams(-1, -2) }) {}
        }
        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            val row = getItem(position)
            if (holder is TrackHolder) { holder.bind(row.data as TrackRow); return }
            val container = holder.itemView as FrameLayout
            container.removeAllViews(); container.setPadding(0, 0, 0, 0)
            if (model.kind == DetailKind.genre) container.layoutParams = StaggeredGridLayoutManager.LayoutParams(-1, -2).apply { isFullSpan = row.type != 7 }
            val view = when (row.type) {
                0 -> loading()
                1 -> column().apply {
                    gravity = Gravity.CENTER; setPadding(s.dp(20), s.dp(topInset + 100), s.dp(20), s.dp(30))
                    addView(label("${when (model.kind) { DetailKind.artist -> "Artista"; DetailKind.playlist -> "Playlist"; DetailKind.genre -> "Género"; else -> "Álbum" }} no disponible", 24f, 700, lines = 3))
                    addView(label(model.error, 14f, 500, s.subtle, 6), LinearLayout.LayoutParams(-1, -2).apply { topMargin = s.dp(12); bottomMargin = s.dp(20) })
                    addView(textButton("Volver") { emit("back") })
                }
                2 -> hero()
                3 -> actions()
                4 -> { val (title, kicker) = row.data as Pair<*, *>; heading(title.toString(), kicker.toString(), if (row.key == "tracksTitle") 0 else 32) }
                6 -> rail(row.data as DetailSection)
                7 -> {
                    val (index, link) = row.data as Pair<*, *>
                    val height = if ((index as Int) % 4 in listOf(0, 3)) 260 else 180
                    container.setPadding(s.dp(6), 0, s.dp(6), s.dp(12))
                    card(link as DetailLink, 150, false, height).apply { layoutParams = FrameLayout.LayoutParams(-1, s.dp(height)) }
                }
                8 -> textButton("Cargar más", "Mostrando ${state.grid(model).size} de ${model.grid.size}") { state.loadMore(model.grid.size); render() }
                9 -> textButton(if (state.expanded) "Mostrar menos" else "Ver ${model.tracks.size - 8} más") { state.toggleTracks(); render() }.also { container.setPadding(s.dp(16), 0, s.dp(16), 0) }
                else -> label(if (model.kind == DetailKind.genre) "No hay resultados disponibles" else "No hay canciones disponibles", 14f, 500, s.subtle, 3).apply { setPadding(s.dp(20), s.dp(30), s.dp(20), s.dp(30)) }
            }
            if (view.layoutParams == null) view.layoutParams = FrameLayout.LayoutParams(-1, -2)
            container.addView(view)
        }
    }
    override fun onDetachedFromWindow() { dialog?.dismiss(); dialog = null; super.onDetachedFromWindow() }
}
