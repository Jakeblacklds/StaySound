package expo.modules.playerchrome

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.RecyclerView
import androidx.recyclerview.widget.LinearLayoutManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections

internal class PlayerQueueView(context: Context, private val action: (String, Map<String, Any>) -> Unit, close: () -> Unit) : LinearLayout(context) {
    private val heading = context.playerText(20f, 700).apply { text = "En cola" }
    private val count = context.playerText(12f, 400)
    private val nowLabel = context.playerText(11f, 700).apply { text = "SONANDO AHORA"; letterSpacing = 0.1f }
    private val nextLabel = context.playerText(11f, 700).apply { text = "A CONTINUACION"; letterSpacing = 0.1f }
    private val current = QueueRow(context, true)
    private val empty = context.playerText(13f, 400).apply { text = "Nada despues de esta cancion"; gravity = Gravity.CENTER }
    private val list = RecyclerView(context)
    private val rows = mutableListOf<JSONObject>()
    private var revision = ""
    private var accent = Color.WHITE
    private var ink = Color.WHITE
    private var draggingFrom = -1
    private var draggingTo = -1
    private var draggingRevision = ""
    private val adapter: RecyclerView.Adapter<QueueHolder> = object : RecyclerView.Adapter<QueueHolder>() {
        override fun getItemCount() = rows.size
        override fun onCreateViewHolder(parent: ViewGroup, type: Int) = QueueHolder(QueueRow(context, false))
        override fun onBindViewHolder(holder: QueueHolder, position: Int) {
            holder.row.bind(rows[position], accent, ink)
            holder.row.info.setOnClickListener {
                val at = holder.bindingAdapterPosition
                if (at != RecyclerView.NO_POSITION) { send("queuePlay", rows[at]); close() }
            }
            holder.row.remove.onTap {
                val at = holder.bindingAdapterPosition
                if (at != RecyclerView.NO_POSITION) send("queueRemove", rows[at])
            }
            holder.row.drag.onHold { helper.startDrag(holder) }
        }
    }
    private val helper = ItemTouchHelper(object : ItemTouchHelper.SimpleCallback(ItemTouchHelper.UP or ItemTouchHelper.DOWN, 0) {
        override fun isLongPressDragEnabled() = false
        override fun onSwiped(holder: RecyclerView.ViewHolder, direction: Int) {}
        override fun onSelectedChanged(holder: RecyclerView.ViewHolder?, state: Int) {
            if (state == ItemTouchHelper.ACTION_STATE_DRAG && holder != null) {
                draggingFrom = holder.bindingAdapterPosition; draggingTo = draggingFrom; draggingRevision = revision
                holder.itemView.animate().scaleX(1.02f).scaleY(1.02f).setDuration(120).start()
                holder.itemView.elevation = dp(12f)
                holder.itemView.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            }
            super.onSelectedChanged(holder, state)
        }
        override fun onMove(rv: RecyclerView, source: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder): Boolean {
            if (draggingRevision != revision) return false
            val from = source.bindingAdapterPosition; val to = target.bindingAdapterPosition
            if (from !in rows.indices || to !in rows.indices) return false
            val moving = rows.removeAt(from); rows.add(to, moving)
            adapter.notifyItemMoved(from, to); draggingTo = to; return true
        }
        override fun clearView(rv: RecyclerView, holder: RecyclerView.ViewHolder) {
            super.clearView(rv, holder)
            holder.itemView.animate().scaleX(1f).scaleY(1f).setDuration(150).start(); holder.itemView.elevation = 0f
            if (draggingRevision == revision && draggingFrom >= 0 && draggingFrom != draggingTo)
                action("queueReorder", mapOf("from" to draggingFrom, "to" to draggingTo, "revision" to revision))
            draggingFrom = -1; draggingTo = -1
        }
    })
    init {
        orientation = VERTICAL; clipToOutline = true; elevation = dp(18f)
        val header = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(px(18), px(14), px(12), px(2)) }
        val meta = LinearLayout(context).apply { orientation = VERTICAL; addView(heading); addView(count) }
        header.addView(meta, LayoutParams(0, -2, 1f))
        header.addView(PlayerControl(context, "close", 24f, "Cerrar cola", close), LayoutParams(px(48), px(48)))
        addView(header)
        listOf(nowLabel, nextLabel).forEach { it.setPadding(px(18), px(14), px(18), px(6)) }
        addView(nowLabel); addView(current, LayoutParams(-1, px(66)).apply { leftMargin=px(16);rightMargin=px(16);topMargin=px(2);bottomMargin=px(2) })
        addView(nextLabel)
        list.layoutManager = LinearLayoutManager(context); list.adapter = adapter; list.itemAnimator = null
        list.setPadding(px(10), 0, px(10), px(32)); list.clipToPadding = false
        helper.attachToRecyclerView(list)
        addView(empty, LayoutParams(-1, px(100))); addView(list, LayoutParams(-1, 0, 1f))
    }
    private fun send(name: String, item: JSONObject) = action(name, mapOf("index" to item.optInt("index"), "id" to item.optString("id"), "revision" to revision))
    fun setQueue(value: JSONObject) {
        val token = value.optString("revision")
        if (token == revision) return
        revision = token
        rows.clear(); val upcoming = value.optJSONArray("upcoming") ?: JSONArray()
        for (i in 0 until upcoming.length()) rows.add(upcoming.getJSONObject(i))
        count.text = "${rows.size} siguientes"
        val playing = value.optJSONObject("current")
        current.visibility = if (playing == null) GONE else VISIBLE; nowLabel.visibility = current.visibility
        if (playing != null) current.bind(playing, accent, ink)
        empty.visibility = if (rows.isEmpty()) VISIBLE else GONE
        adapter.notifyDataSetChanged()
    }
    fun colors(accent: Int, text: Int, surface: Int) {
        this.accent = accent; ink = text; background = android.graphics.drawable.GradientDrawable().apply { setColor(alphaColor(surface,240f/255f)); cornerRadii=floatArrayOf(dp(26f),dp(26f),dp(26f),dp(26f),0f,0f,0f,0f) }
        heading.setTextColor(text); count.setTextColor(alphaColor(text, 0.5f)); nowLabel.setTextColor(alphaColor(text, 0.5f))
        nextLabel.setTextColor(alphaColor(text, 0.5f)); empty.setTextColor(alphaColor(text, 0.7f))
        current.recolor(accent, text); adapter.notifyDataSetChanged()
    }
    private class QueueHolder(val row: QueueRow) : RecyclerView.ViewHolder(row)
    private class QueueRow(context: Context, private val current: Boolean) : LinearLayout(context) {
        val info = LinearLayout(context).apply { orientation = VERTICAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, px(10), 0, px(10)); isClickable = !current }
        val title = context.playerText(15f, 600)
        val artist = context.playerText(13f, 400)
        private val number = context.playerText(11f, 700).apply { gravity = Gravity.CENTER }
        private val bars = QueuePlayingBars(context)
        val remove = PlayerControl(context, "trash-can-outline", 18f, "Quitar de la cola") {}
        val drag = PlayerControl(context, "drag", 20f, "Reordenar") {}
        init {
            orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(px(10), px(5), px(2), px(5)); minimumHeight = px(66)
            layoutParams = RecyclerView.LayoutParams(-1, -2).apply { setMargins(px(16), px(2), px(16), px(2)) }
            addView(if(current) bars else number, LayoutParams(px(if(current)14 else 24), px(32)).apply { rightMargin = px(if(current)10 else 8) })
            info.addView(title,LayoutParams(-1,-2).apply { bottomMargin=px(3) }); info.addView(artist); addView(info, LayoutParams(0, -2, 1f))
            if (!current) { addView(remove, LayoutParams(px(40), px(48))); addView(drag, LayoutParams(px(40), px(48))) }
            remove.colors(0xffff4d4d.toInt())
        }
        fun bind(item: JSONObject, accent: Int, ink: Int) {
            title.text = item.optString("title"); artist.text = item.optString("artist")
            number.text = (item.optInt("index") + 1).toString()
            recolor(accent, ink)
        }
        fun recolor(accent: Int, ink: Int) {
            bars.ink = accent
            title.setTextColor(if (current) accent else ink); artist.setTextColor(alphaColor(ink, 0.7f))
            number.setTextColor(if (current) accent else alphaColor(ink, 0.5f)); drag.colors(alphaColor(ink, 0.5f))
            background = roundSurface(if (current) alphaColor(accent, 0.125f) else Color.TRANSPARENT, dp(14f))
        }
    }
}

private class QueuePlayingBars(context: Context) : View(context) {
    var ink = Color.WHITE
    private val paint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val start=android.os.SystemClock.uptimeMillis()
    override fun onDraw(canvas: android.graphics.Canvas) {
        paint.color=ink
        val time=android.os.SystemClock.uptimeMillis()-start
        for(i in 0..2) {
            val phase=((time-i*150).coerceAtLeast(0)%800)/400f
            val linear=if(phase<=1) phase else 2-phase
            val p=if(linear<.5f) 2*linear*linear else 1-2*(1-linear)*(1-linear)
            val min=if(i==1) 6f else 4f; val max=when(i){0->12f;1->16f;else->14f}
            val h=dp(min+(max-min)*p); val x=width/2f+dp((i-1)*5.5f)-dp(1.5f)
            canvas.drawRoundRect(x,height/2f+dp(8f)-h,x+dp(3f),height/2f+dp(8f),dp(1.5f),dp(1.5f),paint)
        }
        if(isShown && windowVisibility==VISIBLE && (android.os.Build.VERSION.SDK_INT<26 || android.animation.ValueAnimator.areAnimatorsEnabled())) postInvalidateOnAnimation()
    }
}
