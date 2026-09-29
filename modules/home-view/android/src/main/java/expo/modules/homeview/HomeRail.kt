package expo.modules.homeview

import android.os.Parcelable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.core.view.ViewCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView

internal class HomeRail(
    private val style: HomeStyle,
    private val album: Boolean,
    private val action: (HomeItem, Boolean) -> Unit,
    seeAll: () -> Unit,
) : LinearLayout(style.context) {
    private val title = style.text(20f, 700)
    private val more = style.text(13f, 600)
    private val rail = RecyclerView(context)
    private val manager = LinearLayoutManager(context, RecyclerView.HORIZONTAL, false)
    private val cards = Cards()
    var key = ""
        private set
    init {
        orientation = VERTICAL
        setPadding(0, style.dp(8), 0, style.dp(20))
        val header = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(style.dp(24), 0, style.dp(16), style.dp(12))
        }
        title.letterSpacing = -.4f / 20f
        ViewCompat.setAccessibilityHeading(title, true)
        header.addView(title, LayoutParams(0, -2, 1f))
        more.gravity = Gravity.CENTER
        more.minWidth = style.dp(64); more.minHeight = style.dp(48)
        more.setPadding(style.dp(8), 0, style.dp(8), 0)
        more.isFocusable = true; more.setOnClickListener { seeAll() }
        header.addView(more, LayoutParams(-2, -2))
        title.maxLines = 2
        addView(header, LayoutParams(-1, -2))
        rail.layoutManager = manager; rail.adapter = cards; rail.itemAnimator = null
        rail.isNestedScrollingEnabled = false; rail.isHorizontalScrollBarEnabled = false
        rail.overScrollMode = OVER_SCROLL_NEVER
        rail.clipToPadding = false
        rail.setPadding(style.dp(24), style.dp(2), style.dp(8), 0)
        // Enough space for the full sp-scaled captions, including two-line album names.
        val captionHeight = (76 * resources.configuration.fontScale).toInt()
        addView(rail, LayoutParams(-1, style.dp((if (album) 164 else 116) + captionHeight)))
    }
    fun bind(row: HomeRow, saved: Parcelable?) {
        val changed = key != row.key
        key = row.key
        cards.submitList(row.items) {
            if (changed) {
                if (saved != null) manager.onRestoreInstanceState(saved) else manager.scrollToPositionWithOffset(0, 0)
            }
        }
        paint()
    }
    fun saveScroll(): Parcelable? = manager.onSaveInstanceState()
    fun paint() {
        title.text = style.label(key); title.setTextColor(style.color("onBackground", style.ink))
        more.text = style.label("seeAll"); more.setTextColor(style.primary); more.background = style.ripple()
        more.contentDescription = "${style.label("seeAll")}: ${style.label(key)}"
        cards.notifyItemRangeChanged(0, cards.itemCount, "appearance")
    }
    private inner class Cards : ListAdapter<HomeItem, Card>(object : DiffUtil.ItemCallback<HomeItem>() {
        override fun areItemsTheSame(a: HomeItem, b: HomeItem) = a.id == b.id
        override fun areContentsTheSame(a: HomeItem, b: HomeItem) = a == b
    }) {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Card()
        override fun onBindViewHolder(holder: Card, position: Int) = holder.bind(getItem(position))
        override fun onBindViewHolder(holder: Card, position: Int, payloads: MutableList<Any>) {
            if (payloads.isEmpty()) holder.bind(getItem(position)) else holder.paint()
        }
    }
    private inner class Card : RecyclerView.ViewHolder(HomePressLayout(style)) {
        private val root = itemView as LinearLayout
        private val art = HomeArtwork(style, !album)
        private val name = style.text(14f, 600)
        private val artist = style.text(12f)
        private var bound: HomeItem? = null
        init {
            root.orientation = VERTICAL
            root.gravity = if (album) Gravity.START else Gravity.CENTER_HORIZONTAL
            root.layoutParams = RecyclerView.LayoutParams(style.dp(if (album) 152 else 104), -1).apply {
                marginEnd = style.dp(16)
            }
            root.setPadding(0, 0, 0, style.dp(8))
            val size = style.dp(if (album) 152 else 104)
            root.addView(art, LayoutParams(size, size).apply { bottomMargin = style.dp(12) })
            name.maxLines = 2
            artist.maxLines = 1
            name.gravity = if (album) Gravity.START else Gravity.CENTER
            artist.gravity = name.gravity
            name.letterSpacing = -.15f / 14f
            root.addView(name, LayoutParams(-1, -2))
            root.addView(artist, LayoutParams(-1, -2).apply { topMargin = style.dp(4) })
            root.isFocusable = true
            root.setOnClickListener { bound?.let { action(it, false) } }
            if (!album) root.setOnLongClickListener { bound?.let { action(it, true) }; true }
            name.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            artist.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        fun bind(item: HomeItem) {
            bound = item; name.text = item.title; artist.text = item.artist
            art.bind(item, style.dp(if (album) 152 else 104))
            paint()
        }
        fun paint() {
            art.paint(); name.setTextColor(style.ink); artist.setTextColor(style.secondary)
            root.foreground = style.ripple(16)
            bound?.let { root.contentDescription = "${it.title}, ${it.artist}" }
        }
    }
}
