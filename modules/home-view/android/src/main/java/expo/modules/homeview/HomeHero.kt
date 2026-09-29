package expo.modules.homeview

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.PagerSnapHelper
import androidx.recyclerview.widget.RecyclerView
import java.util.Calendar
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

internal class HomeHero(
    private val style: HomeStyle,
    private val action: (HomeItem, Boolean) -> Unit,
) : FrameLayout(style.context) {
    private val greeting = style.text(13f)
    private val name = style.text(30f, 700)
    private val header = LinearLayout(context)
    private val pager = RecyclerView(context)
    private val manager = LinearLayoutManager(context, RecyclerView.HORIZONTAL, false)
    private val pages = Pages()
    private val dots = Dots()
    private var pageWidth = 0
    private var username = ""
    private var introduced = false
    private val fontScale get() = resources.configuration.fontScale
    private val pageHeight get() = style.dp(354 + ((fontScale - 1f).coerceAtLeast(0f) * 250).toInt())
    private val headerHeight get() = style.dp(110 + ((fontScale - 1f).coerceAtLeast(0f) * 60).toInt())

    init {
        clipChildren = false
        pager.layoutManager = manager; pager.adapter = pages
        pager.itemAnimator = null
        pager.isHorizontalScrollBarEnabled = false
        pager.overScrollMode = OVER_SCROLL_NEVER
        pager.isNestedScrollingEnabled = false
        PagerSnapHelper().attachToRecyclerView(pager)
        pager.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) = updateProgress()
            override fun onScrollStateChanged(recyclerView: RecyclerView, newState: Int) {
                if (newState == RecyclerView.SCROLL_STATE_IDLE) updateProgress()
            }
        })
        addView(pager, LayoutParams(-1, pageHeight).apply { topMargin = headerHeight })
        dots.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        addView(dots, LayoutParams(-1, style.dp(21), Gravity.BOTTOM))
        header.orientation = LinearLayout.VERTICAL
        greeting.letterSpacing = .02f
        greeting.setPadding(0, 0, 0, style.dp(4))
        name.letterSpacing = -1.05f / 30f; name.maxLines = 1
        ViewCompat.setAccessibilityHeading(name, true)
        header.addView(greeting, LinearLayout.LayoutParams(-1, -2))
        header.addView(name, LinearLayout.LayoutParams(-1, -2))
        addView(header, LayoutParams(-1, -2).apply {
            leftMargin = style.dp(24); rightMargin = style.dp(24); topMargin = style.dp(24)
        })
    }

    fun bind(value: List<HomeItem>, user: String) {
        val selected = pages.currentList.getOrNull(manager.findFirstVisibleItemPosition())?.id
        username = user
        val desiredHeight = if (value.isEmpty()) headerHeight else headerHeight + pageHeight + style.dp(28)
        layoutParams = (layoutParams ?: RecyclerView.LayoutParams(-1, desiredHeight)).apply { height = desiredHeight }
        pager.visibility = if (value.isEmpty()) GONE else VISIBLE
        dots.visibility = pager.visibility
        pager.layoutParams = (pager.layoutParams as LayoutParams).apply { height = pageHeight; topMargin = headerHeight }
        pages.submitList(value) {
            if (selected != null && value.any { it.id == selected }) {
                manager.scrollToPositionWithOffset(value.indexOfFirst { it.id == selected }, 0)
            }
            dots.count = value.size
            pager.post { if (isAttachedToWindow) { updateProgress(); introduce() } }
        }
        paint()
    }
    fun paint() {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val locale = Locale.forLanguageTag(style.label("locale").ifEmpty { "es" })
        greeting.text = style.label(when (hour) { in 6..11 -> "morning"; in 12..17 -> "afternoon"; else -> "night" }).uppercase(locale)
        greeting.setTextColor(style.secondary)
        name.text = username.ifBlank { style.label("appName") }; name.setTextColor(style.color("onBackground", style.ink))
        pages.notifyItemRangeChanged(0, pages.itemCount, "appearance")
        dots.invalidate()
        if (!style.motionEnabled) {
            pager.animate().cancel(); pager.alpha = 1f; pager.translationY = 0f
        }
        updateProgress()
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w > 0 && w != pageWidth) {
            val selected = manager.findFirstVisibleItemPosition().coerceAtLeast(0)
            pageWidth = w
            pages.notifyItemRangeChanged(0, pages.itemCount)
            manager.scrollToPositionWithOffset(selected, 0)
        }
    }
    private fun updateProgress() {
        val width = pageWidth.takeIf { it > 0 } ?: return
        val first = manager.findFirstVisibleItemPosition()
        val firstView = manager.findViewByPosition(first) ?: return
        val progress = first - firstView.left.toFloat() / width
        dots.position = progress
        for (index in 0 until pager.childCount) {
            val child = pager.getChildAt(index)
            val holder = pager.getChildViewHolder(child) as Page
            val offset = (child.left.toFloat() / width).coerceIn(-1f, 1f)
            val distance = abs(offset)
            val motion = style.motionEnabled
            // Render properties only: no layout, bitmap work or allocations during a swipe.
            holder.itemView.scaleY = if (motion) 1f - .035f * distance else 1f
            holder.art.translationX = if (motion) -offset * style.dp(28) else 0f
            holder.art.scaleX = if (motion) 1f - .06f * distance else 1f
            holder.art.scaleY = holder.art.scaleX
            holder.copy.translationX = if (motion) -offset * style.dp(12) else 0f
            holder.copy.alpha = if (motion) 1f - .35f * distance else 1f
        }
    }
    private fun introduce() {
        if (introduced || pages.itemCount == 0 || !isAttachedToWindow) return
        introduced = true
        if (!style.motionEnabled) return
        pager.alpha = .72f
        pager.translationY = style.dp(10).toFloat()
        pager.animate().alpha(1f).translationY(0f).setDuration(380L)
            .setInterpolator(HomePressMotion.SETTLE).start()
    }
    override fun onDetachedFromWindow() {
        pager.animate().cancel(); pager.alpha = 1f; pager.translationY = 0f
        super.onDetachedFromWindow()
    }
    private inner class Pages : ListAdapter<HomeItem, Page>(object : DiffUtil.ItemCallback<HomeItem>() {
        override fun areItemsTheSame(a: HomeItem, b: HomeItem) = a.id == b.id
        override fun areContentsTheSame(a: HomeItem, b: HomeItem) = a == b
    }) {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Page()
        override fun onBindViewHolder(holder: Page, position: Int) = holder.bind(getItem(position))
        override fun onBindViewHolder(holder: Page, position: Int, payloads: MutableList<Any>) {
            if (payloads.isEmpty()) holder.bind(getItem(position)) else holder.paint()
        }
    }
    private inner class Page : RecyclerView.ViewHolder(FrameLayout(context)) {
        private val root = itemView as FrameLayout
        val panel = HomePressFrame(style)
        private val scrim = View(context)
        val art = HomeArtwork(style, true)
        val copy = LinearLayout(context)
        private val title = style.text(28f, 700)
        private val artist = style.text(15f, 500)
        private val meta = style.text(13f)
        private val play = LinearLayout(context)
        private val playCircle = FrameLayout(context)
        private val playIcon = HomeGlyph(style, true)
        private val playLabel = style.text(14f, 700)
        private var bound: HomeItem? = null
        init {
            root.addView(panel, LayoutParams(-1, -1).apply {
                leftMargin = style.dp(24); rightMargin = style.dp(24); bottomMargin = style.dp(8)
            })
            panel.clipToOutline = true
            panel.addView(art)
            panel.addView(scrim, LayoutParams(-1, -1))
            copy.orientation = LinearLayout.VERTICAL
            title.maxLines = 2; title.letterSpacing = -.7f / 28f
            artist.maxLines = 1; artist.setPadding(0, style.dp(6), 0, 0)
            meta.maxLines = 2; meta.setPadding(0, style.dp(8), 0, 0)
            copy.addView(title); copy.addView(artist); copy.addView(meta)
            play.gravity = Gravity.CENTER_VERTICAL
            play.setPadding(style.dp(14), 0, style.dp(18), 0)
            playCircle.addView(playIcon, LayoutParams(style.dp(18), style.dp(18), Gravity.CENTER))
            play.addView(playCircle, LinearLayout.LayoutParams(style.dp(24), style.dp(24)))
            play.addView(playLabel, LinearLayout.LayoutParams(-2, -2).apply { marginStart = style.dp(10) })
            play.minimumHeight = style.dp(48)
            copy.addView(play, LinearLayout.LayoutParams(-2, -2).apply { topMargin = style.dp(20) })
            panel.addView(copy)
            panel.isFocusable = true
            panel.setOnClickListener { bound?.let { action(it, false) } }
            panel.setOnLongClickListener { bound?.let { action(it, true) }; true }
            copy.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        }
        fun bind(item: HomeItem) {
            bound = item
            val width = pageWidth.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
            val widthDp = width / resources.displayMetrics.density
            root.layoutParams = RecyclerView.LayoutParams(width, -1)
            val size = style.dp((widthDp * .72f).coerceIn(230f, 340f))
            art.layoutParams = LayoutParams(size, size, Gravity.TOP or Gravity.RIGHT).apply {
                rightMargin = -style.dp(54); topMargin = -style.dp(42)
            }
            copy.layoutParams = LayoutParams(-1, -2, Gravity.BOTTOM or Gravity.START).apply {
                leftMargin = style.dp(20); rightMargin = style.dp(20); bottomMargin = style.dp(22)
            }
            art.bind(item, size, true)
            title.text = item.title; artist.text = item.artist
            val details = mutableListOf<String>()
            if (item.codec.isNotBlank()) details.add(item.codec.uppercase(Locale.ROOT))
            if (item.sampleRate > 0) {
                val rate = item.sampleRate / 1000.0
                val label = if (rate == rate.toInt().toDouble()) rate.toInt().toString() else String.format(Locale.ROOT, "%.1f", rate)
                details.add("$label kHz")
            }
            if (item.bitDepth > 0) details.add("${item.bitDepth}-bit")
            meta.text = details.joinToString(" · ")
            meta.visibility = if (details.isEmpty()) GONE else VISIBLE
            art.alpha = 1f; copy.alpha = 1f
            art.translationX = 0f; art.scaleX = 1f; art.scaleY = 1f
            copy.translationX = 0f; root.scaleY = 1f
            paint()
        }
        fun paint() {
            panel.background = style.shape(style.panel, 16)
            scrim.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.TRANSPARENT, style.panel, style.panel)).apply {
                gradientType = GradientDrawable.LINEAR_GRADIENT
            }
            title.setTextColor(style.ink)
            artist.setTextColor(style.secondary); meta.setTextColor(style.secondary)
            play.background = style.shape(style.primary, 24)
            playIcon.tint = style.onAccent; playLabel.text = style.label("play"); playLabel.setTextColor(style.onAccent)
            art.paint(); panel.foreground = style.ripple(16)
            bound?.let { item -> panel.contentDescription = "${style.label("play")}: ${item.title}, ${item.artist}" }
        }
    }
    private inner class Dots : View(context) {
        var count = 0
            set(value) { field = value; invalidate() }
        var position = 0f
            set(value) { field = value; invalidate() }
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(canvas: Canvas) {
            if (count == 0) return
            var totalWidth = 0f
            for (index in 0 until count) totalWidth += dotWidth(index)
            var x = (width - totalWidth - style.dp(8) * (count - 1)) / 2f
            val y = style.dp(2).toFloat()
            for (index in 0 until count) {
                val amount = (1 - abs(position - index)).coerceIn(0f, 1f)
                paint.color = ColorUtils.setAlphaComponent(style.primary, ((.34f + .66f * amount) * 255).roundToInt())
                val dotWidth = dotWidth(index)
                canvas.drawRoundRect(x, y, x + dotWidth, y + style.dp(5), style.dp(3).toFloat(), style.dp(3).toFloat(), paint)
                x += dotWidth + style.dp(8)
            }
        }
        private fun dotWidth(index: Int) = style.dp(8f + 16f * (1 - abs(position - index)).coerceIn(0f, 1f)).toFloat()
    }
}
