package expo.modules.detailview

import android.content.Context
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Parcelable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.view.ContextThemeWrapper
import androidx.core.graphics.ColorUtils
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** A native screen island: no player, catalog persistence, scanner or service is created here. */
class DetailView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val style = DetailStyle(ui)
    private val main = Handler(Looper.getMainLooper())
    private var worker: ExecutorService? = null
    private var work: Future<*>? = null
    private var generation = 0
    private var rawCatalog = "{}"
    private var rawSelection = "{}"
    private data class Cache(val raw: String, val catalog: DetailCatalog)
    private val cache = ThreadLocal<Cache>()
    private var page: DetailPage? = null
    private var artistInfo = emptyMap<String, String>()
    private var currentTrackId = ""
    private var expanded = false
    private var topInset = 0
    private var bottomInset = style.dp(120)
    private var dialog: AlertDialog? = null
    private var scrollState: Parcelable? = null
    private var railState: Parcelable? = null
    private val frame = FrameLayout(ui)
    private val backdrop = ImageView(ui).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private val wash = View(ui).apply { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
    private val list = RecyclerView(ui)
    private val rows = Rows()
    private val back = FrameLayout(ui)
    private val backGlyph = DetailGlyph(style, "back")
    private val submitWork = Runnable { project() }

    init {
        list.layoutManager = LinearLayoutManager(ui)
        list.adapter = rows; list.itemAnimator = null
        list.clipToPadding = false; list.isVerticalScrollBarEnabled = false
        frame.addView(backdrop, FrameLayout.LayoutParams(-1, -1))
        frame.addView(wash, FrameLayout.LayoutParams(-1, -1))
        frame.addView(list, FrameLayout.LayoutParams(-1, -1))
        back.addView(backGlyph, FrameLayout.LayoutParams(style.dp(24), style.dp(24), Gravity.CENTER))
        back.isClickable = true; back.isFocusable = true; back.foreground = style.ripple(20)
        back.setOnClickListener { emitBack() }
        frame.addView(back, FrameLayout.LayoutParams(style.dp(48), style.dp(48)))
        addView(frame, LayoutParams(-1, -1))
        applyInsets()
    }
    fun setCatalog(value: String) { if (rawCatalog != value) { rawCatalog = value; schedule() } }
    fun setSelection(value: String) {
        if (rawSelection == value) return
        rawSelection = value; page = null; expanded = false; scrollState = null; railState = null
        dialog?.dismiss(); dialog = null
        rows.submitList(emptyList()); list.scrollToPosition(0); schedule()
    }
    fun setArtistInfo(value: Map<String, String>) {
        if (artistInfo == value) return
        artistInfo = value; repaint(); paintBackdrop()
    }
    // Rows rebind on repaint, so the palette eases at ~30 fps rather than every frame.
    private val appearance = expo.modules.playerchrome.AppearanceTween(this, frameMs = 32) { style.colors = it; repaint(); paintBackdrop() }
    fun setAppearance(value: Map<String, String>) = appearance.set(value)
    fun setLabels(value: Map<String, String>) { style.labels = value; repaint() }
    fun setCurrentTrackId(value: String) {
        if (currentTrackId == value) return
        val previous = currentTrackId; currentTrackId = value
        rows.currentList.forEachIndexed { index, row ->
            if (row.track?.id == previous || row.track?.id == value) rows.notifyItemChanged(index)
        }
    }
    fun setTopInset(value: Double) { topInset = style.dp(value.toInt().coerceAtLeast(0)); applyInsets() }
    fun setBottomInset(value: Double) { bottomInset = style.dp(value.toInt().coerceAtLeast(0)); applyInsets() }
    private fun applyInsets() {
        list.setPadding(0, topInset + style.dp(72), 0, bottomInset)
        back.layoutParams = FrameLayout.LayoutParams(style.dp(48), style.dp(48)).apply {
            topMargin = topInset + style.dp(10); leftMargin = style.dp(16)
        }
    }
    private fun repaint() {
        back.contentDescription = style.label("back")
        back.background = style.shape(ColorUtils.setAlphaComponent(style.surface, 180), 20)
        backGlyph.tint = style.ink
        rows.notifyItemRangeChanged(0, rows.itemCount)
    }
    private fun heroArtwork() = page?.artwork.orEmpty().ifEmpty {
        if (page?.selection?.kind == "artist") artistInfo["photo"].orEmpty() else page?.thumbnail.orEmpty()
    }
    private fun paintBackdrop() {
        frame.setBackgroundColor(style.background)
        val tone = style.color("paletteBackground", style.background)
        wash.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(
            ColorUtils.setAlphaComponent(tone, 195), ColorUtils.setAlphaComponent(tone, 225), style.background))
        backdrop.visibility = if (style.lightweight) GONE else VISIBLE
        wash.visibility = if (style.lightweight) GONE else VISIBLE
        if (!isAttachedToWindow) return
        if (style.lightweight) { Glide.with(context.applicationContext).clear(backdrop); return }
        // A tiny decoded backdrop keeps old Android versions soft without allocating a full-screen bitmap.
        Glide.with(context.applicationContext).load(heroArtwork().ifEmpty { null })
            .override(48).centerCrop().dontAnimate().into(backdrop)
        if (Build.VERSION.SDK_INT >= 31) backdrop.setRenderEffect(RenderEffect.createBlurEffect(24f, 24f, Shader.TileMode.CLAMP))
    }
    private fun emitBack() {
        val selection = runCatching { DetailSelection.parse(rawSelection) }.getOrNull() ?: return
        onAction(DetailAction("back", selection.kind, selection.id).payload())
    }
    private fun emit(name: String, id: String) { page?.action(name, id)?.let { onAction(it.payload()) } }
    private fun queueMenu(track: DetailTrack) {
        dialog?.dismiss()
        dialog = MaterialAlertDialogBuilder(ui).setTitle(track.title)
            .setItems(arrayOf(style.label("queue"))) { _, _ -> emit("queue", track.id) }
            .setNegativeButton(style.label("cancel"), null).show()
        // Dialog owns Back while open. Otherwise Android Back belongs to the existing router stack.
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow(); worker = Executors.newSingleThreadExecutor(); schedule(); paintBackdrop()
    }
    override fun onDetachedFromWindow() {
        generation++; scrollState = list.layoutManager?.onSaveInstanceState()
        saveRail(); main.removeCallbacksAndMessages(null); work?.cancel(true); worker?.shutdownNow(); worker = null
        dialog?.dismiss(); dialog = null
        Glide.with(context.applicationContext).clear(backdrop)
        super.onDetachedFromWindow()
    }
    private fun saveRail() {
        for (i in 0 until list.childCount) (list.getChildAt(i) as? AlbumRail)?.savePosition()
    }
    private fun schedule() {
        generation++; main.removeCallbacks(submitWork)
        if (isAttachedToWindow) main.post(submitWork)
    }
    private fun project() {
        val revision = generation; val raw = rawCatalog; val selection = rawSelection
        work?.cancel(true)
        work = worker?.submit {
            val result = runCatching {
                val catalog = cache.get()?.takeIf { it.raw == raw }?.catalog
                    ?: DetailCatalog(raw).also { cache.set(Cache(raw, it)) }
                catalog.page(DetailSelection.parse(selection))
            }
            main.post {
                if (!isAttachedToWindow || revision != generation) return@post
                saveRail()
                result.onSuccess { next ->
                    page = next
                    rows.submitList(content(next)) {
                        scrollState?.let { list.layoutManager?.onRestoreInstanceState(it); scrollState = null }
                    }
                }.onFailure {
                    page = null; rows.submitList(listOf(Row("error")))
                }
                paintBackdrop()
            }
        }
    }

    private data class Row(val kind: String, val id: String = "", val track: DetailTrack? = null,
        val index: Int = 0, val page: DetailPage? = null)
    private fun content(page: DetailPage): List<Row> = buildList {
        if (!page.found) { add(Row("notFound")); return@buildList }
        add(Row("hero", page = page))
        if (page.tracks.isEmpty()) add(Row("empty")) else {
            add(Row(if (page.selection.kind == "artist") "topSongs" else "tracks"))
            page.visibleTracks.forEachIndexed { index, track -> add(Row("track", track.id, track, index)) }
        }
        if (page.albums.isNotEmpty()) { add(Row("albums")); add(Row("rail", page = page)) }
        if (page.selection.kind == "artist") add(Row("about", page = page))
    }
    private inner class Rows : ListAdapter<Row, Holder>(object : DiffUtil.ItemCallback<Row>() {
        override fun areItemsTheSame(a: Row, b: Row) = a.kind == b.kind && a.id == b.id
        override fun areContentsTheSame(a: Row, b: Row) = a == b
    }) {
        override fun getItemViewType(position: Int) = when (getItem(position).kind) {
            "hero" -> 0; "track" -> 1; "rail" -> 2; "about" -> 3; else -> 4
        }
        override fun onCreateViewHolder(parent: ViewGroup, type: Int) = Holder(when (type) {
            0 -> Hero(); 1 -> TrackRow(); 2 -> AlbumRail(); 3 -> About(); else -> Message()
        })
        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))
        override fun onViewRecycled(holder: Holder) { (holder.itemView as? AlbumRail)?.savePosition() }
    }
    private inner class Holder(view: View) : RecyclerView.ViewHolder(view) {
        init { itemView.layoutParams = RecyclerView.LayoutParams(-1, -2) }
        fun bind(row: Row) {
            when (val view = itemView) {
                is Hero -> row.page?.let(view::bind)
                is TrackRow -> row.track?.let { view.bind(it, row.index) }
                is AlbumRail -> view.bind(row.page?.albums.orEmpty())
                is About -> view.bind(row.page?.title.orEmpty())
                is Message -> view.bind(row.kind)
            }
        }
    }
    private fun column() = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
    private fun button(label: String, action: () -> Unit) = style.text(12f, 900).apply {
        text = label; gravity = Gravity.CENTER; minHeight = style.dp(48)
        setPadding(style.dp(14), style.dp(8), style.dp(14), style.dp(8))
        background = style.shape(style.primary, 15); setTextColor(style.onPrimary)
        isFocusable = true; foreground = style.ripple(); setOnClickListener { action() }
    }
    private inner class Hero : LinearLayout(ui) {
        private val art = DetailArtwork(style, 28)
        private val info = column()
        init {
            orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(style.dp(18), style.dp(12), style.dp(18), style.dp(34))
            addView(art, LayoutParams(0, 0))
            addView(info, LayoutParams(0, -2, 1f).apply { leftMargin = style.dp(18) })
        }
        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            val size = ((MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight) * .45f).toInt()
            if (art.layoutParams.width != size || art.layoutParams.height != size) {
                art.layoutParams = art.layoutParams.apply { width = size; height = size }
            }
            super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        }
        fun bind(value: DetailPage) {
            art.bind(heroArtwork(), value.thumbnail, value.selection.kind == "artist")
            info.removeAllViews()
            info.addView(style.text(12f).apply {
                text = style.label(value.selection.kind); setTextColor(style.primary); letterSpacing = .12f
            }, LayoutParams(-1, -2).apply { bottomMargin = style.dp(8) })
            info.addView(style.text(if (value.selection.kind == "artist") 31f else 28f, 900).apply {
                text = value.title; maxLines = 3; letterSpacing = -.04f
            })
            if (value.artist.isNotEmpty()) info.addView(style.text(14f, 800).apply {
                text = value.artist; maxLines = 2; setTextColor(style.primary)
            }, LayoutParams(-1, -2).apply { topMargin = style.dp(7) })
            info.addView(style.text(11f).apply {
                text = "${value.tracks.size} ${style.label("songs")} · " +
                    if (value.selection.kind == "artist") "${value.albums.size} ${style.label("albums")}" else detailDuration(value.duration)
                setTextColor(style.subtle)
            }, LayoutParams(-1, -2).apply { topMargin = style.dp(8) })
            value.tracks.firstOrNull()?.let { first ->
                val play = LinearLayout(ui).apply {
                    gravity = Gravity.CENTER; minimumHeight = style.dp(48)
                    setPadding(style.dp(12), 0, style.dp(12), 0)
                    background = style.shape(style.primary, 15); foreground = style.ripple(15)
                    isFocusable = true; contentDescription = style.label("play")
                    addView(DetailGlyph(style, "play").apply { tint = style.onPrimary }, LayoutParams(style.dp(18), style.dp(18)))
                    addView(style.text(12f, 900).apply { text = style.label("play"); setTextColor(style.onPrimary) },
                        LayoutParams(-2, -2).apply { leftMargin = style.dp(7) })
                    setOnClickListener { emit("play", first.id) }
                }
                info.addView(play, LayoutParams(-2, -2).apply { topMargin = style.dp(14) })
            }
        }
    }
    private inner class TrackRow : LinearLayout(ui) {
        private val number = style.text(11f)
        private val art = DetailArtwork(style, 7)
        private val title = style.text(15f, 700)
        private val subtitle = style.text(11f)
        private val duration = style.text(11f)
        private val queue = FrameLayout(ui)
        private val queueGlyph = DetailGlyph(style, "queue")
        init {
            orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = style.dp(72)
            setPadding(style.dp(16), style.dp(8), style.dp(8), style.dp(8))
            foreground = style.ripple(0); isFocusable = true
            number.gravity = Gravity.CENTER
            addView(number, LayoutParams(style.dp(28), -2))
            addView(art, LayoutParams(style.dp(52), style.dp(52)))
            val info = column()
            title.maxLines = 1; subtitle.maxLines = 1
            info.addView(title); info.addView(subtitle, LayoutParams(-1, -2).apply { topMargin = style.dp(5) })
            addView(info, LayoutParams(0, -2, 1f).apply { leftMargin = style.dp(12); rightMargin = style.dp(8) })
            addView(duration)
            queue.addView(queueGlyph, FrameLayout.LayoutParams(style.dp(20), style.dp(20), Gravity.CENTER))
            queue.foreground = style.ripple(); queue.isFocusable = true
            addView(queue, LayoutParams(style.dp(48), style.dp(48)))
        }
        fun bind(track: DetailTrack, index: Int) {
            val playing = currentTrackId == track.id
            setBackgroundColor(if (playing) ColorUtils.setAlphaComponent(style.primary, 32) else Color.TRANSPARENT)
            number.text = if (playing) "▶" else (index + 1).toString(); number.setTextColor(if (playing) style.primary else style.subtle)
            art.visibility = if (page?.selection?.kind == "artist") VISIBLE else GONE
            art.bind(track.thumbnail.ifEmpty { track.artwork }, track.artwork)
            title.text = track.title; title.setTextColor(if (playing) style.primary else style.ink)
            subtitle.text = if (track.album.isNotEmpty() && track.album != "Unknown Album") "${track.artist} - ${track.album}" else track.artist
            subtitle.setTextColor(style.subtle)
            duration.text = detailDuration(track.duration) + if (track.favorite) " ♥" else ""; duration.setTextColor(style.subtle)
            contentDescription = listOfNotNull(track.title, track.artist, detailDuration(track.duration),
                style.label("nowPlaying").takeIf { playing }, style.label("favorite").takeIf { track.favorite }).joinToString(", ")
            queueGlyph.tint = style.subtle; queue.contentDescription = "${style.label("queue")}: ${track.title}"
            setOnClickListener { emit("play", track.id) }
            setOnLongClickListener { queueMenu(track); true }
            queue.setOnClickListener { emit("queue", track.id) }
        }
    }
    private inner class AlbumRail : RecyclerView(ui) {
        private var albums = emptyList<DetailAlbum>()
        private val cards = object : Adapter<AlbumHolder>() {
            override fun getItemCount() = albums.size
            override fun onCreateViewHolder(parent: ViewGroup, type: Int) = AlbumHolder()
            override fun onBindViewHolder(holder: AlbumHolder, position: Int) = holder.bind(albums[position])
        }
        init {
            layoutManager = LinearLayoutManager(ui, HORIZONTAL, false); adapter = cards; itemAnimator = null
            setPadding(style.dp(24), 0, style.dp(14), style.dp(36)); clipToPadding = false
            isHorizontalScrollBarEnabled = false
        }
        fun savePosition() {
            // A newly created/recycled rail has no position yet; do not replace the saved one.
            if (albums.isNotEmpty() && childCount > 0) railState = layoutManager?.onSaveInstanceState()
        }
        fun bind(items: List<DetailAlbum>) {
            savePosition(); albums = items; cards.notifyDataSetChanged()
            railState?.let { layoutManager?.onRestoreInstanceState(it) }
        }
        private inner class AlbumHolder : ViewHolder(column()) {
            private val card = itemView as LinearLayout
            private val art = DetailArtwork(style, 18)
            private val title = style.text(14f, 800)
            private val subtitle = style.text(11f)
            init {
                card.layoutParams = LayoutParams(style.dp(148), -2).apply { rightMargin = style.dp(10) }
                card.isFocusable = true; card.foreground = style.ripple()
                card.addView(art, LinearLayout.LayoutParams(style.dp(148), style.dp(148)))
                title.maxLines = 2; subtitle.maxLines = 1
                card.addView(title, LinearLayout.LayoutParams(-1, -2).apply { topMargin = style.dp(10) })
                card.addView(subtitle, LinearLayout.LayoutParams(-1, -2).apply { topMargin = style.dp(4) })
            }
            fun bind(album: DetailAlbum) {
                art.bind(album.artwork, album.thumbnail); title.text = album.title; title.setTextColor(style.ink)
                subtitle.text = album.artist; subtitle.setTextColor(style.subtle)
                card.contentDescription = "${album.title}, ${album.artist}"
                card.setOnClickListener { emit("album", album.id) }
            }
        }
    }
    private inner class About : LinearLayout(ui) {
        init { orientation = VERTICAL }
        fun bind(name: String) {
            removeAllViews(); setPadding(style.dp(24), style.dp(32), style.dp(24), style.dp(40))
            if (artistInfo["loading"] == "true") {
                addView(style.text(12f).apply { text = style.label("loading"); setTextColor(style.subtle) }); return
            }
            val photo = artistInfo["photo"].orEmpty(); val biography = artistInfo["biography"].orEmpty()
            if (photo.isEmpty() && biography.isEmpty()) { setPadding(0, 0, 0, 0); return }
            addView(style.text(22f, 800).apply { text = style.label("about") }, LayoutParams(-1, -2).apply { bottomMargin = style.dp(16) })
            if (photo.isNotEmpty()) addView(DetailArtwork(style, 28).apply { bind(photo) }, LayoutParams(-1, style.dp(240)))
            addView(style.text(24f, 800).apply { text = name }, LayoutParams(-1, -2).apply { topMargin = style.dp(16) })
            val body = style.text(14f).apply {
                text = biography.ifEmpty { style.label("noBiography") }; setTextColor(style.subtle)
                setLineSpacing(style.dp(6).toFloat(), 1f); maxLines = if (expanded) Int.MAX_VALUE else 4
            }
            addView(body, LayoutParams(-1, -2).apply { topMargin = style.dp(10) })
            if (biography.isNotEmpty()) {
                val toggle = style.text(14f, 800).apply {
                    text = style.label(if (expanded) "less" else "more"); setTextColor(style.primary)
                    minHeight = style.dp(48); gravity = Gravity.CENTER_VERTICAL; isFocusable = true
                    setOnClickListener { expanded = !expanded; bind(name) }
                }
                body.setOnClickListener { expanded = !expanded; bind(name) }; addView(toggle)
            }
        }
    }
    private inner class Message : LinearLayout(ui) {
        init { orientation = VERTICAL }
        fun bind(kind: String) {
            removeAllViews(); setPadding(style.dp(24), style.dp(8), style.dp(24), style.dp(14))
            val heading = kind in listOf("tracks", "topSongs", "albums")
            addView(style.text(if (kind == "tracks") 11f else if (heading) 20f else 16f, if (heading) 800 else 500).apply {
                text = style.label(kind); setTextColor(if (kind == "tracks") style.subtle else style.ink)
            })
            if (kind == "error") addView(button(style.label("retry")) { schedule() })
        }
    }
}
