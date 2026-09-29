package expo.modules.homeview

import android.content.Context
import android.content.res.ColorStateList
import android.os.Handler
import android.os.Looper
import android.os.Parcelable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.view.ContextThemeWrapper
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Native Home island. Only catalog revisions and explicit actions cross the Expo bridge. */
class HomeView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val style = HomeStyle(ui)
    private val main = Handler(Looper.getMainLooper())
    private var worker: ExecutorService? = null
    private var work: Future<*>? = null
    private var generation = 0
    private var rawCatalog = "{}"
    private var rawRecent = "[]"
    private val seed = System.currentTimeMillis()
    private data class Cache(val raw: String, val catalog: HomeCatalog)
    private data class RecentCache(val raw: String, val items: List<HomeItem>)
    // A detached worker can finish late; its cache is never shared with a new attachment.
    private val parsed = ThreadLocal<Cache>()
    private val parsedRecent = ThreadLocal<RecentCache>()
    private var catalog: HomeCatalog? = null
    private var scanning = false
    private var lightweight = false
    private var userName = ""
    private var topInset = 0
    private var bottomInset = style.dp(180)
    private var dialog: AlertDialog? = null
    private val railPositions = mutableMapOf<String, Parcelable?>()
    private val list = RecyclerView(ui)
    private val rows = Rows()
    private val submitWork = Runnable { project() }
    private var scrollState: Parcelable? = null

    init {
        orientation = VERTICAL
        list.layoutManager = LinearLayoutManager(ui)
        list.adapter = rows; list.itemAnimator = null
        list.isVerticalScrollBarEnabled = false
        list.clipToPadding = false
        list.setPadding(0, style.dp(6), 0, bottomInset)
        addView(list, LayoutParams(-1, -1))
    }
    fun setCatalog(value: String) { if (rawCatalog != value) { rawCatalog = value; schedule() } }
    fun setRecentlyPlayed(value: String) { if (rawRecent != value) { rawRecent = value; schedule() } }
    // Album palettes ease across the page instead of repainting in a single frame.
    private val appearance = expo.modules.playerchrome.AppearanceTween(this) { style.colors = it; repaint() }
    fun setAppearance(value: Map<String, String>) = appearance.set(value)
    fun setLabels(value: Map<String, String>) { style.labels = value; repaint() }
    fun setUserName(value: String) { userName = value; rows.notifyItemRangeChanged(0, minOf(1, rows.itemCount)) }
    fun setScanning(value: Boolean) { scanning = value; repaint() }
    fun setLightweight(value: Boolean) { if (lightweight != value) { lightweight = value; style.lightweight = value; repaint(); schedule() } }
    fun setTopInset(value: Double) { topInset = style.dp(value.toFloat().coerceAtLeast(0f)); applyInsets() }
    fun setBottomInset(value: Double) { bottomInset = style.dp(value.toFloat().coerceAtLeast(0f)); applyInsets() }
    private fun applyInsets() { list.setPadding(0, topInset + style.dp(6), 0, bottomInset) }
    private fun repaint() { rows.notifyItemRangeChanged(0, rows.itemCount, "appearance") }
    private fun emit(action: String, id: String = "", value: String = "") {
        onAction(mapOf("action" to action, "id" to id, "value" to value))
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        worker = Executors.newSingleThreadExecutor()
        schedule()
    }
    override fun onDetachedFromWindow() {
        generation++
        scrollState = list.layoutManager?.onSaveInstanceState()
        main.removeCallbacksAndMessages(null); work?.cancel(true); worker?.shutdownNow(); worker = null
        dialog?.dismiss(); dialog = null
        super.onDetachedFromWindow()
    }
    private fun schedule() {
        generation++
        main.removeCallbacks(submitWork)
        if (isAttachedToWindow) main.post(submitWork)
    }
    private fun project() {
        val revision = generation
        val raw = rawCatalog; val history = rawRecent; val lite = lightweight
        work?.cancel(true)
        work = worker?.submit {
            val result = runCatching {
                val snapshot = parsed.get()?.takeIf { it.raw == raw }?.catalog
                    ?: HomeCatalog(raw, seed).also { parsed.set(Cache(raw, it)) }
                val recent = parsedRecent.get()?.takeIf { it.raw == history }?.items
                    ?: HomeItem.parseList(JSONArray(history)).also { parsedRecent.set(RecentCache(history, it)) }
                snapshot to snapshot.rows(recent, lite)
            }
            main.post {
                if (!isAttachedToWindow || revision != generation) return@post
                result.onSuccess { (snapshot, content) ->
                    catalog = snapshot
                    rows.submitList(content) {
                        scrollState?.let { list.layoutManager?.onRestoreInstanceState(it); scrollState = null }
                    }
                }.onFailure {
                    rows.submitList(listOf(HomeRow("hero"), HomeRow("error")))
                }
            }
        }
    }
    private fun trackAction(item: HomeItem, longPress: Boolean) {
        if (longPress) showActions(item) else emit("play", item.id)
    }
    private fun showActions(item: HomeItem) {
        val local = catalog?.songs?.any { it.id == item.id } == true
        val actions = if (local) listOf("queue", "playlist", "remove", "deleteFile") else listOf("queue", "playlist")
        dialog = MaterialAlertDialogBuilder(ui).setTitle(item.title)
            .setItems(actions.map(style::label).toTypedArray()) { _, index ->
                when (val action = actions[index]) {
                    "queue" -> emit(action, item.id)
                    "playlist" -> showPlaylists(item)
                    else -> confirmRemoval(item, action == "deleteFile")
                }
            }.setNegativeButton(style.label("cancel"), null).show()
    }
    private fun showPlaylists(item: HomeItem) {
        val choices = catalog?.playlists.orEmpty()
        dialog = MaterialAlertDialogBuilder(ui).setTitle(style.label("playlist"))
            .setItems((listOf(style.label("newPlaylist")) + choices.map { it.name }).toTypedArray()) { _, index ->
                if (index == 0) {
                    val input = EditText(ui).apply { setSingleLine(true); hint = style.label("playlistName") }
                    dialog = MaterialAlertDialogBuilder(ui).setTitle(style.label("newPlaylist")).setView(input)
                        .setNegativeButton(style.label("cancel"), null)
                        .setPositiveButton(style.label("create"), null).show().also { alert ->
                            alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                                val name = input.text.toString().trim()
                                if (name.isEmpty()) input.error = style.label("playlistName")
                                else { emit("createPlaylist", item.id, name); alert.dismiss() }
                            }
                        }
                } else emit("playlist", item.id, choices[index - 1].id)
            }.setNegativeButton(style.label("cancel"), null).show()
    }
    private fun confirmRemoval(item: HomeItem, file: Boolean) {
        val action = if (file) "deleteFile" else "remove"
        dialog = MaterialAlertDialogBuilder(ui).setTitle(style.label(action))
            .setMessage(style.label(if (file) "deleteFileMessage" else "removeMessage").replace("{title}", item.title))
            .setNegativeButton(style.label("cancel"), null)
            .setPositiveButton(style.label(action)) { _, _ -> emit(action, item.id) }.show()
    }

    private inner class Rows : ListAdapter<HomeRow, Holder>(object : DiffUtil.ItemCallback<HomeRow>() {
        override fun areItemsTheSame(a: HomeRow, b: HomeRow) = a.key == b.key
        override fun areContentsTheSame(a: HomeRow, b: HomeRow) = a == b
    }) {
        override fun getItemViewType(position: Int) = when (getItem(position).key) {
            "hero" -> 0; "albumsSection" -> 2; "empty", "error" -> 3; else -> 1
        }
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(viewType)
        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))
        override fun onBindViewHolder(holder: Holder, position: Int, payloads: MutableList<Any>) {
            if (payloads.isEmpty()) holder.bind(getItem(position)) else holder.paint()
        }
        override fun onViewRecycled(holder: Holder) { holder.savePosition() }
    }
    private inner class Holder(kind: Int) : RecyclerView.ViewHolder(when (kind) {
        0 -> HomeHero(style, ::trackAction)
        1 -> HomeRail(style, false, ::trackAction) { emit("library") }
        2 -> HomeRail(style, true, { item, _ -> emit("album", item.id) }) { emit("library") }
        else -> Empty()
    }) {
        init { itemView.layoutParams = RecyclerView.LayoutParams(-1, -2) }
        fun savePosition() { (itemView as? HomeRail)?.let { railPositions[it.key] = it.saveScroll() } }
        fun bind(row: HomeRow) {
            when (val view = itemView) {
                is HomeHero -> view.bind(row.items, userName)
                is HomeRail -> {
                    if (view.key != row.key) savePosition()
                    view.bind(row, railPositions[row.key])
                }
                is Empty -> view.bind(row.key == "error")
            }
        }
        fun paint() {
            when (val view = itemView) {
                is HomeHero -> view.paint()
                is HomeRail -> view.paint()
                is Empty -> view.paint()
            }
        }
    }
    private inner class Empty : LinearLayout(ui) {
        private val icon = HomeGlyph(style, false)
        private val title = style.text(20f, 800)
        private val description = style.text(14f)
        private val button = MaterialButton(ui)
        private var error = false
        init {
            orientation = VERTICAL; gravity = Gravity.CENTER
            setPadding(style.dp(48), style.dp(32), style.dp(48), style.dp(32))
            minimumHeight = style.dp(300)
            title.gravity = Gravity.CENTER; description.gravity = Gravity.CENTER
            addView(icon, LayoutParams(style.dp(64), style.dp(64)).apply { bottomMargin = style.dp(20) })
            addView(title, LayoutParams(-1, -2))
            addView(description, LayoutParams(-1, -2).apply { topMargin = style.dp(8); bottomMargin = style.dp(24) })
            button.isAllCaps = false; button.minimumHeight = style.dp(48); button.cornerRadius = style.dp(24)
            addView(button, LayoutParams(-2, -2))
            button.setOnClickListener { if (error) schedule() else if (!scanning) emit("scan") }
            icon.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        fun bind(failed: Boolean) { error = failed; paint() }
        fun paint() {
            icon.tint = style.primary
            title.text = style.label(if (error) "loadError" else "emptyTitle"); title.setTextColor(style.ink)
            description.text = style.label(if (error) "loadErrorDescription" else "emptyDescription")
            description.setTextColor(style.secondary)
            button.text = style.label(if (error) "retry" else if (scanning) "scanning" else "scan")
            button.isEnabled = error || !scanning
            button.backgroundTintList = ColorStateList.valueOf(style.primary); button.setTextColor(style.onAccent)
        }
    }
}
