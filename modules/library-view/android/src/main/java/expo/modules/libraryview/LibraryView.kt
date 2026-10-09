package expo.modules.libraryview

import expo.modules.playerchrome.stayIcon
import expo.modules.playerchrome.TrackActionsSheet
import android.animation.ValueAnimator
import android.os.Build
import androidx.core.view.ViewCompat
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import com.facebook.react.common.assets.ReactFontManager
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.appcompat.view.ContextThemeWrapper
import androidx.core.graphics.ColorUtils
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.Future

/** A native island: only catalog revisions and explicit user actions cross into JS. */
class LibraryView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val main = Handler(Looper.getMainLooper())
    private var worker: ExecutorService? = null
    private var work: Future<*>? = null
    private var generation = 0
    private var rawCatalog = "{}"
    private var catalog = LibraryCatalog()
    private data class ParsedCatalog(val raw: String, val locale: String, val catalog: LibraryCatalog)
    // Detach/reattach may overlap a cancelled worker. Each worker owns its cache.
    private val parsed = ThreadLocal<ParsedCatalog>()
    private var labels = emptyMap<String, String>()
    private var colors = emptyMap<String, String>()
    private data class SongPalette(val fill: Int, val title: Int, val secondary: Int,
        val activeTitle: Int, val activeSecondary: Int, val favorite: Int, val activeFavorite: Int)
    private var songPalette = buildSongPalette()
    private var tab = "songs"
    private var query = ""
    private var currentTrack = ""
    private var scanning = false
    private var playbackOptions = emptyMap<String, Any>()
    private var loadFailed = false
    private var filtering = false
    private var sectionTransition = false
    private val motionEnabled get() = colors["motion"] != "off" && (Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled())
    private var searchOpen = false
    private var resetScroll = false
    private var dialog: androidx.appcompat.app.AlertDialog? = null
    private var trackSheet: TrackActionsSheet? = null
    private val title = text(30f, true)
    private val toolbar = LinearLayout(ui)
    private val tabs = LibraryTabs(ui) { selectTab(it) }
    private val search = EditText(ui)
    private val searchToggle = ImageButton(ui)
    private val content = FrameLayout(ui)
    private val layout = GridLayoutManager(ui, 1)
    private val rows = LibraryAdapter()
    private val list = RecyclerView(ui)
    private val loadingIndicator = ProgressBar(ui).apply { visibility = GONE }
    private val showLoading = Runnable {
        if (filtering && rows.itemCount == 0 && isAttachedToWindow) loadingIndicator.visibility = VISIBLE
    }
    private val empty = LinearLayout(ui)
    private val emptyTitle = text(22f, true)
    private val emptyDescription = text(15f)
    private val scanButton = MaterialButton(ui)
    private val submitWork = Runnable { filter() }

    init {
        orientation = VERTICAL
        title.setPadding(dp(24), dp(24), dp(24), dp(16))
        title.typeface = font(700)
        ViewCompat.setAccessibilityHeading(title, true)
        title.letterSpacing = -0.03f
        addView(title, LayoutParams(-1, -2))
        toolbar.gravity = Gravity.CENTER_VERTICAL
        toolbar.setPadding(dp(16), 0, dp(16), dp(16))
        toolbar.addView(tabs, LayoutParams(0, -2, 1f))
        search.apply {
            visibility = GONE
            setSingleLine(true)
            textSize = 16f
            setPadding(dp(14), 0, dp(14), 0)
            minimumHeight = dp(48)
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
            inputType = android.text.InputType.TYPE_CLASS_TEXT
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    query = s?.toString().orEmpty()
                    resetScroll = true
                    scheduleFilter(100)
                }
                override fun afterTextChanged(s: Editable?) {}
            })
            setOnEditorActionListener { _, _, _ -> hideKeyboard(); true }
        }
        toolbar.addView(search, LayoutParams(0, -2, 1f))
        searchToggle.setPadding(dp(13), dp(13), dp(13), dp(13))
        searchToggle.setOnClickListener { toggleSearch() }
        toolbar.addView(searchToggle, LayoutParams(dp(48), dp(48)).apply { marginStart = dp(8) })
        addView(toolbar, LayoutParams(-1, -2))
        list.layoutManager = layout
        list.adapter = rows
        list.itemAnimator = null // No change animation competes with a fling or playback highlight.
        list.clipToPadding = false
        list.setPadding(dp(16), dp(4), dp(16), dp(120))
        list.setHasFixedSize(true)
        list.isVerticalScrollBarEnabled = false
        content.addView(list, FrameLayout.LayoutParams(-1, -1))
        empty.orientation = VERTICAL
        empty.gravity = Gravity.CENTER
        empty.setPadding(dp(28), dp(16), dp(28), dp(120))
        emptyTitle.gravity = Gravity.CENTER
        emptyDescription.gravity = Gravity.CENTER
        emptyDescription.setPadding(0, dp(12), 0, dp(20))
        empty.addView(emptyTitle, LayoutParams(-1, -2))
        empty.addView(emptyDescription, LayoutParams(-1, -2))
        scanButton.isAllCaps = false
        scanButton.minimumHeight = dp(48)
        scanButton.setOnClickListener { if (loadFailed) scheduleFilter() else showScanFolders() }
        empty.addView(scanButton, LayoutParams(-2, -2))
        content.addView(empty, FrameLayout.LayoutParams(-1, -1))
        content.addView(loadingIndicator, FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER))
        addView(content, LayoutParams(-1, 0, 1f))
        updateChrome()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun font(weight: Int) = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, context.assets)
    private fun text(size: Float, bold: Boolean = false) = TextView(ui).apply {
        textSize = size
        includeFontPadding = false
        typeface = font(if (bold) 700 else 500)
    }
    private fun label(key: String) = labels[key].orEmpty()
    private fun color(key: String, fallback: Int = Color.TRANSPARENT): Int =
        runCatching { Color.parseColor(colors[key]) }.getOrDefault(fallback)
    private fun readable(ink: Int, background: Int): Int {
        val opaqueInk = ColorUtils.setAlphaComponent(ink, 255)
        if (ColorUtils.calculateContrast(opaqueInk, background) >= 4.5) return opaqueInk
        val target = if (ColorUtils.calculateContrast(Color.WHITE, background) >=
            ColorUtils.calculateContrast(Color.BLACK, background)) Color.WHITE else Color.BLACK
        for (step in 1..20) {
            val candidate = ColorUtils.blendARGB(opaqueInk, target, step / 20f)
            if (ColorUtils.calculateContrast(candidate, background) >= 4.5) return candidate
        }
        return target
    }
    private fun buildSongPalette(): SongPalette {
        val background = ColorUtils.setAlphaComponent(color("background", Color.BLACK), 255)
        // Match the actual 40% container over the screen, not the opaque M3 container.
        val fill = ColorUtils.setAlphaComponent(color("primaryContainer"), 102)
        val activeBackground = ColorUtils.compositeColors(fill, background)
        val title = readable(color("onSurface", Color.WHITE), background)
        val secondary = color("onSurfaceVariant", title)
        return SongPalette(fill, title, readable(secondary, background),
            readable(color("onPrimaryContainer", title), activeBackground),
            readable(secondary, activeBackground),
            readable(color("primary", title), background),
            readable(color("primary", title), activeBackground))
    }
    private fun shape(fill: Int, radius: Int = 24) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(radius).toFloat()
    }
    private fun ripple(fill: Int, radius: Int = 12) = RippleDrawable(
        ColorStateList.valueOf(color("primary") and 0x00ffffff or 0x24000000),
        shape(fill, radius), shape(Color.WHITE, radius),
    )
    private fun emit(action: String, id: String = "", value: String = "") {
        onAction(mapOf("action" to action, "id" to id, "value" to value))
    }

    fun setCatalog(value: String) { rawCatalog = value; scheduleFilter() }
    fun setPlaybackOptions(value: Map<String, Any>) { playbackOptions = value }
    fun setLabels(value: Map<String, String>) {
        labels = value
        updateChrome()
        rows.notifyItemRangeChanged(0, rows.itemCount, "appearance")
        scheduleFilter()
    }
    // Album palettes ease across the page instead of repainting in a single frame.
    private val appearance = expo.modules.playerchrome.AppearanceTween(this) { applyAppearance(it) }
    fun setAppearance(value: Map<String, String>) = appearance.set(value)
    private fun applyAppearance(value: Map<String, String>) {
        colors = value
        tabs.motionEnabled = motionEnabled
        if (!motionEnabled) {
            list.animate().cancel(); list.alpha = 1f; list.translationY = 0f
            search.animate().cancel(); search.alpha = 1f; search.translationX = 0f
        }
        songPalette = buildSongPalette()
        updateChrome()
        rows.notifyItemRangeChanged(0, rows.itemCount, "appearance")
    }
    fun setScanning(value: Boolean) {
        val finished = scanning && !value
        scanning = value
        updateEmpty()
        if (finished && tab == "artists") emit("artistsVisible")
    }
    fun setTopInset(value: Double) {
        title.setPadding(dp(24), dp(value.toInt().coerceAtLeast(0)) + dp(24), dp(24), dp(16))
    }
    fun setBottomInset(value: Double) {
        val bottom = dp(value.toInt().coerceAtLeast(0))
        list.setPadding(dp(16), dp(4), dp(16), bottom)
        empty.setPadding(dp(28), dp(16), dp(28), bottom)
    }
    fun setCurrentTrack(value: String) {
        val previous = currentTrack
        currentTrack = value
        // A playback change only rebinds the old and new rows, not the catalog.
        rows.currentList.forEachIndexed { index, item ->
            if (item.kind == "songs" && (item.id == previous || item.id == value))
                rows.notifyItemChanged(index, "playing")
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        worker = Executors.newSingleThreadExecutor()
        runCatching { LibraryPlaybackController.instance?.connect() }
        scheduleFilter()
    }
    override fun onDetachedFromWindow() {
        generation++
        list.animate().cancel(); list.alpha = 1f; list.translationY = 0f
        search.animate().cancel(); search.alpha = 1f; search.translationX = 0f
        main.removeCallbacksAndMessages(null)
        work?.cancel(true)
        worker?.shutdownNow()
        worker = null
        dialog?.dismiss()
        dialog = null
        trackSheet?.dispose(); trackSheet = null
        super.onDetachedFromWindow()
    }

    private fun scheduleFilter(delay: Long = 0) {
        filtering = true
        generation++ // Invalidate in-flight work immediately, including during debounce.
        main.removeCallbacks(submitWork)
        if (isAttachedToWindow) {
            main.postDelayed(submitWork, delay)
            main.removeCallbacks(showLoading)
            if (rows.itemCount == 0) main.postDelayed(showLoading, 180L)
        }
    }
    private fun filter() {
        val version = generation
        val snapshot = rawCatalog
        val selectedTab = tab
        val searchQuery = query
        val localeTag = labels["locale"] ?: "es-MX"
        work?.cancel(true)
        work = worker?.submit {
            try {
                val cached = parsed.get()
                val nextCatalog = if (cached?.raw == snapshot && cached.locale == localeTag) cached.catalog
                    else LibraryCatalog.parse(snapshot, Locale.forLanguageTag(localeTag)).also {
                        parsed.set(ParsedCatalog(snapshot, localeTag, it))
                    }
                val result = nextCatalog.search(selectedTab, searchQuery)
                main.post {
                    if (version != generation || !isAttachedToWindow) return@post
                    catalog = nextCatalog
                    loadFailed = false
                    rows.submitList(result) {
                        if (version == generation) {
                            if (resetScroll) list.scrollToPosition(0)
                            resetScroll = false
                            filtering = false
                            updateEmpty()
                            if (sectionTransition) {
                                sectionTransition = false
                                list.animate().cancel()
                                if (motionEnabled && result.isNotEmpty()) {
                                    list.alpha = .72f; list.translationY = dp(8).toFloat()
                                    list.animate().alpha(1f).translationY(0f).setDuration(280L)
                                        .setInterpolator(LibraryPressRow.SETTLE).start()
                                }
                            }
                        }
                    }
                }
            } catch (_: InterruptedException) {
                // Detach or a newer catalog superseded this work.
            } catch (_: Exception) {
                main.post {
                    if (version == generation && isAttachedToWindow) {
                        loadFailed = true
                        filtering = false; sectionTransition = false
                        updateEmpty()
                    }
                }
            }
        }
    }

    private fun selectTab(value: String) {
        if (tab == value) return
        tab = value
        sectionTransition = true; filtering = true
        list.animate().cancel(); list.alpha = 1f; list.translationY = 0f
        resetScroll = true
        // Clear before changing the span count so song holders never render as grid cards.
        rows.submitList(null)
        layout.spanCount = if (tab == "songs") 1 else gridColumns(width)
        setBottomInset(list.paddingBottom / resources.displayMetrics.density.toDouble())
        updateChrome()
        scheduleFilter()
        if (tab == "artists") emit("artistsVisible")
    }
    private fun gridColumns(pixels: Int): Int {
        val widthDp = pixels / resources.displayMetrics.density
        val minimumCardWidth = 156f * resources.configuration.fontScale.coerceAtLeast(1f)
        return ((widthDp - 32f) / minimumCardWidth).toInt().coerceAtLeast(1)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (tab != "songs") layout.spanCount = gridColumns(w)
    }
    private fun toggleSearch() {
        searchOpen = !searchOpen
        search.visibility = if (searchOpen) VISIBLE else GONE
        tabs.visibility = if (searchOpen) GONE else VISIBLE
        search.animate().cancel(); search.alpha = 1f; search.translationX = 0f
        if (searchOpen) {
            if (motionEnabled) {
                search.alpha = .7f; search.translationX = dp(8).toFloat()
                search.animate().alpha(1f).translationX(0f).setDuration(220L)
                    .setInterpolator(LibraryPressRow.SETTLE).start()
            }
            search.requestFocus()
            search.post { (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(search, InputMethodManager.SHOW_IMPLICIT) }
        } else {
            search.setText("")
            search.clearFocus()
            hideKeyboard()
        }
        updateChrome()
    }
    private fun hideKeyboard() {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(windowToken, 0)
    }
    private fun updateChrome() {
        title.text = label("title")
        title.setTextColor(color("onBackground", Color.WHITE))
        tabs.update(labels, tab, color("primary"), color("onSurfaceVariant"))
        search.hint = label("search")
        search.setTextColor(color("onSurface"))
        search.setHintTextColor(color("onSurfaceVariant"))
        search.background = shape(color("surfaceVariant"), 16)
        searchToggle.setImageDrawable(ui.stayIcon(if (searchOpen) "close" else "search"))
        searchToggle.imageTintList = ColorStateList.valueOf(color("onSurface"))
        searchToggle.background = ripple(Color.TRANSPARENT, 24)
        searchToggle.contentDescription = label(if (searchOpen) "closeSearch" else "search")
        emptyTitle.setTextColor(color("onSurface"))
        emptyDescription.setTextColor(color("onSurfaceVariant"))
        scanButton.backgroundTintList = ColorStateList.valueOf(color("primaryContainer"))
        scanButton.setTextColor(color("onPrimaryContainer"))
        loadingIndicator.indeterminateTintList = ColorStateList.valueOf(color("primary"))
        updateEmpty()
    }
    private fun updateEmpty() {
        if (!filtering) {
            main.removeCallbacks(showLoading)
            loadingIndicator.visibility = GONE
        }
        val show = loadFailed || rows.itemCount == 0
        empty.visibility = if (show && !filtering) VISIBLE else GONE
        list.visibility = if (show) GONE else VISIBLE
        val noEntries = catalog.entries(tab).isEmpty()
        val suffix = if (noEntries) "none" else "search"
        emptyTitle.text = label(if (loadFailed) "loadError" else "$tab.$suffix.title")
        emptyDescription.text = label(if (loadFailed) "loadErrorDescription" else "$tab.$suffix.description")
        scanButton.visibility = if (noEntries || loadFailed) VISIBLE else GONE
        scanButton.isEnabled = !scanning
        scanButton.text = label(if (loadFailed) "retry" else if (scanning) "scanning" else "scan")
    }
    private fun showScanFolders() {
        val paths = arrayOf("/storage/emulated/0/Download/", "/storage/emulated/0/Music/", "")
        var selected = 0
        dialog = MaterialAlertDialogBuilder(ui)
            .setTitle(label("scanWhere"))
            .setSingleChoiceItems(arrayOf(label("downloads"), label("music"), label("allFolders")), 0) { _, which -> selected = which }
            .setNegativeButton(label("cancel"), null)
            .setPositiveButton(label("scan")) { _, _ -> emit("scan", value = paths[selected]) }
            .show()
    }
    private fun showActions(entry: LibraryEntry) {
        trackSheet?.dispose()
        trackSheet = TrackActionsSheet(ui, entry.title, entry.subtitle, entry.displayArtwork, entry.fallbackThumbnail,
            ColorUtils.blendARGB(color("background"), color("surfaceVariant"), .55f),
            color("onSurface"), color("onSurfaceVariant"), color("primary"), label("cancel"), motionEnabled,
            listOf("queue", "playlist", "remove", "deleteFile").map { action ->
                TrackActionsSheet.Action(label(action), when (action) {
                    "queue" -> "queue"; "playlist" -> "playlist-add"; else -> "trash"
                }, if (action == "queue") label("queueHint") else "",
                    destructive = action == "remove" || action == "deleteFile") {
                when (action) {
                    "queue" -> emit("queue", entry.id)
                    "playlist" -> showPlaylists(entry)
                    else -> confirmRemoval(entry, action == "deleteFile")
                }
            } }).also { it.show() }
    }
    private fun showPlaylists(entry: LibraryEntry) {
        val choices = catalog.playlists.toList()
        dialog = MaterialAlertDialogBuilder(ui).setTitle(label("playlist"))
            .setItems((listOf(label("newPlaylist")) + choices.map { it.name }).toTypedArray()) { _, index ->
                if (index == 0) {
                    val input = EditText(ui).apply { setSingleLine(true); hint = label("playlistName") }
                    dialog = MaterialAlertDialogBuilder(ui).setTitle(label("newPlaylist")).setView(input)
                        .setNegativeButton(label("cancel"), null)
                        .setPositiveButton(label("create"), null).show().also { alert ->
                            alert.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                                val name = input.text.toString().trim()
                                if (name.isEmpty()) input.error = label("playlistName")
                                else { emit("createPlaylist", entry.id, name); alert.dismiss() }
                            }
                        }
                } else emit("playlist", entry.id, choices[index - 1].id)
            }.setNegativeButton(label("cancel"), null).show()
    }
    private fun confirmRemoval(entry: LibraryEntry, file: Boolean) {
        dialog = MaterialAlertDialogBuilder(ui).setTitle(label(if (file) "deleteFile" else "remove"))
            .setMessage(label(if (file) "deleteFileMessage" else "removeMessage").replace("{title}", entry.title))
            .setNegativeButton(label("cancel"), null)
            .setPositiveButton(label(if (file) "deleteFile" else "remove")) { _, _ -> emit(if (file) "deleteFile" else "remove", entry.id) }
            .show()
    }

    private inner class LibraryAdapter : ListAdapter<LibraryEntry, Holder>(object : DiffUtil.ItemCallback<LibraryEntry>() {
        override fun areItemsTheSame(a: LibraryEntry, b: LibraryEntry) = a.id == b.id && a.kind == b.kind
        override fun areContentsTheSame(a: LibraryEntry, b: LibraryEntry) = a == b
    }) {
        override fun getItemViewType(position: Int) = when (getItem(position).kind) { "songs" -> 0; "albums" -> 1; else -> 2 }
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(viewType)
        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))
        override fun onBindViewHolder(holder: Holder, position: Int, payloads: MutableList<Any>) {
            if (payloads.isEmpty()) holder.bind(getItem(position)) else holder.paint(getItem(position))
        }
        override fun onViewRecycled(holder: Holder) { Glide.with(context.applicationContext).clear(holder.art); holder.bound = null; holder.root.resetMotion() }
    }

    private inner class Holder(val kind: Int) : RecyclerView.ViewHolder(LibraryPressRow(ui) { motionEnabled }) {
        val song = kind == 0
        val artist = kind == 2
        val root = itemView as LibraryPressRow
        val art = ImageView(ui)
        val media = object : FrameLayout(ui) {
            override fun onMeasure(w: Int, h: Int) {
                super.onMeasure(w, if (!song) MeasureSpec.makeMeasureSpec(MeasureSpec.getSize(w), MeasureSpec.EXACTLY) else h)
            }
        }
        val name = text(if (song) 16f else 15f, true)
        val subtitle = text(if (artist) 12f else 13f)
        val detail = text(12f)
        val more = ImageButton(ui)
        var bound: LibraryEntry? = null
        init {
            root.orientation = if (song) HORIZONTAL else VERTICAL
            root.gravity = Gravity.CENTER_VERTICAL
            root.setPadding(dp(8), dp(8), dp(8), dp(if (song) 8 else 20))
            root.layoutParams = RecyclerView.LayoutParams(-1, -2)
            root.minimumHeight = dp(if (song) 80 else 48)
            root.isFocusable = true
            root.clipToOutline = song
            art.scaleType = ImageView.ScaleType.CENTER_CROP
            art.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            media.clipToOutline = true
            media.addView(art, FrameLayout.LayoutParams(-1, -1))
            root.addView(media, LayoutParams(if (song) dp(56) else -1, if (song) dp(56) else -2))
            val copy = LinearLayout(ui).apply {
                orientation = VERTICAL
                setPadding(if (song) dp(14) else 0, if (song) 0 else dp(12), if (song) dp(8) else 0, 0)
            }
            name.typeface = font(600)
            name.maxLines = 2
            name.letterSpacing = if (song) -0.009f else -0.011f
            name.ellipsize = TextUtils.TruncateAt.END
            subtitle.maxLines = 1
            subtitle.ellipsize = TextUtils.TruncateAt.END
            subtitle.setPadding(0, dp(4), 0, 0)
            name.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            subtitle.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            detail.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            copy.addView(name, LayoutParams(-1, -2))
            copy.addView(subtitle, LayoutParams(-1, -2))
            if (artist) { name.gravity = Gravity.CENTER; subtitle.gravity = Gravity.CENTER }
            root.addView(copy, if (song) LayoutParams(0, -2, 1f) else LayoutParams(-1, -2))
            if (song) {
                root.addView(detail, LayoutParams(-2, -2))
                more.setImageDrawable(ui.stayIcon("queue"))
                more.setPadding(dp(14), dp(14), dp(14), dp(14))
                root.addView(more, LayoutParams(dp(48), dp(48)))
                more.setOnClickListener { bound?.let(::showActions) }
                root.setOnLongClickListener { bound?.let(::showActions); true }
            }
            root.setOnClickListener { bound?.let { entry ->
                if (entry.kind != "songs") emit(entry.kind, entry.id)
                else {
                    val source = catalog.songs
                    val options = playbackOptions
                    LibraryPlaybackController.instance?.play("library") {
                        PlaybackPlan.create(source.mapNotNull { it.playback }, entry.id,
                            options["shuffle"] as? Boolean ?: false,
                            (options["contextLimit"] as? Number)?.toInt() ?: 700,
                            (options["recentIds"] as? List<*>)?.filterIsInstance<String>() ?: emptyList())
                    }
                }
            } }
        }
        fun paint(entry: LibraryEntry) {
            val playing = song && currentTrack == entry.id
            val titleInk = if (playing) songPalette.activeTitle else songPalette.title
            val secondaryInk = if (playing) songPalette.activeSecondary else songPalette.secondary
            root.background = ripple(if (playing) songPalette.fill else Color.TRANSPARENT, 16)
            name.setTextColor(if (song) titleInk else songPalette.title)
            subtitle.setTextColor(if (song) secondaryInk else songPalette.secondary)
            subtitle.alpha = 1f
            detail.setTextColor(secondaryInk)
            detail.alpha = 1f
            detail.compoundDrawableTintList = ColorStateList.valueOf(
                if (playing) songPalette.activeFavorite else songPalette.favorite)
            more.imageTintList = ColorStateList.valueOf(secondaryInk)
            more.background = ripple(Color.TRANSPARENT, 24)
            more.contentDescription = "${label("options")}: ${entry.title}"
            media.background = shape(color(if (artist) "primaryContainer" else "surfaceVariant"), if (song) 12 else if (artist) 1000 else 16)
            if (artist) {
                subtitle.text = "${entry.count} ${label(if (entry.count == 1) "album" else "albums").lowercase()}"
            }
            root.isActivated = playing
            root.isSelected = playing
            root.contentDescription = listOfNotNull(
                entry.title, subtitle.text.toString(),
                if (entry.favorite) label("favorite") else null,
                if (playing) label("nowPlaying") else null,
            ).joinToString(", ")
        }
        fun bind(entry: LibraryEntry) {
            root.resetMotion()
            bound = entry
            name.text = entry.title
            subtitle.text = entry.subtitle
            detail.setCompoundDrawablesRelativeWithIntrinsicBounds(null, null,
                if (entry.favorite) context.stayIcon("heart", 14f, interactive = false) else null, null,
            )
            detail.compoundDrawablePadding = dp(6)
            val seconds = entry.duration / 1000
            detail.text = "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
            paint(entry)
            val request = Glide.with(context.applicationContext).load(entry.displayArtwork.ifEmpty { null })
                .override(dp(if (song) 56 else 240)).centerCrop().dontAnimate()
                .placeholder(context.stayIcon("music", interactive = false)).error(context.stayIcon("music", interactive = false))
            if (entry.fallbackThumbnail.isNotEmpty()) {
                request.error(Glide.with(context.applicationContext).load(entry.fallbackThumbnail)
                    .override(dp(if (song) 56 else 240)).centerCrop().dontAnimate().error(context.stayIcon("music", interactive = false)))
            }
            if (motionEnabled) request.transition(DrawableTransitionOptions.withCrossFade(160))
            request.into(art)
        }
    }
}
