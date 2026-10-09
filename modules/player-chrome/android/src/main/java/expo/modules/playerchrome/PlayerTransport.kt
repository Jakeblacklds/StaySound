package expo.modules.playerchrome

import android.content.Context
import android.graphics.Color
import android.widget.FrameLayout
import org.json.JSONObject

internal class PlayerTransport(context: Context, private val send: (String) -> Unit, private val lyrics: Boolean = false) : FrameLayout(context) {
    val shuffle = PlayerControl(context, "shuffle", if (lyrics) 27f else 24f, "Aleatorio") { send("shuffle") }.apply { toggleControl = true }
    val previous = PlayerControl(context, "skip-previous", if (lyrics) 34f else 36f, "Pista anterior") { send("previous") }
    val play = PlayerControl(context, "play", if (lyrics) 34f else 45f, "Reproducir") { send("toggle") }.apply { playControl = true }
    val next = PlayerControl(context, "skip-next", if (lyrics) 34f else 36f, "Siguiente pista") { send("next") }
    val repeat = PlayerControl(context, "repeat", if (lyrics) 27f else 24f, "Repetir") { send("repeat") }.apply { toggleControl = true }
    private val controls=listOf(shuffle,previous,play,next,repeat)
    private val glow=android.view.View(context)
    private val glowMotion=ChromeMotion(0f) { glow.alpha=.05f+it*.11f;glow.scaleX=.82f+it*.18f;glow.scaleY=glow.scaleX }
    private var lastPlaying: Boolean? = null
    init {
        clipChildren=false
        if(lyrics) addView(glow,LayoutParams(px(104),px(104)))
        controls.forEach { it.lyricsControl=lyrics;addView(it) }
        previous.pressedScale=.88f;next.pressedScale=.88f
        play.elevation=dp(if(lyrics)0f else 8f)
    }
    fun state(model: JSONObject, playing: Boolean) {
        shuffle.selected(model.optBoolean("shuffle")); val mode = model.optString("repeat", "off")
        shuffle.setLabel(if (model.optBoolean("shuffle")) "Desactivar aleatorio" else "Activar aleatorio")
        repeat.setIcon(if (mode == "one") "repeat-once" else "repeat")
        repeat.selected(mode != "off")
        repeat.setLabel(when(mode) { "off" -> "Activar repetición"; "one" -> "Repetir una vez, toca para desactivar"; else -> "Repetir cola, toca para repetir una vez" })
        if (lastPlaying != playing) { play.playing(playing); if(lyrics)glowMotion.timing(if(playing)1f else 0f,380,true); lastPlaying = playing }
    }
    fun colors(accent: Int, text: Int, onPrimary: Int) {
        shuffle.colors(alphaColor(text, if(lyrics).74f else .4f), accent); repeat.colors(alphaColor(text, if(lyrics).74f else .4f), accent)
        previous.colors(text); next.colors(text); play.colors(onPrimary)
        play.background = roundSurface(accent, dp(40f));glow.background=roundSurface(accent,dp(52f))
    }
    override fun onMeasure(w: Int, h: Int) {
        super.onMeasure(w, h)
        val sizes = if (lyrics) intArrayOf(54, 54, 78, 54, 54) else intArrayOf(52, 60, 76, 60, 52)
        val factor = minOf(1f, measuredWidth / dp(sizes.sum().toFloat()))
        for (i in controls.indices) { val size = (dp(sizes[i].toFloat()) * factor).toInt(); controls[i].measure(MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY)) }
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        var total = 0; for (control in controls) total += control.measuredWidth
        val gap = ((width - total) / 4f).coerceAtLeast(0f); var x = 0f
        for (v in controls) { val y = (height - v.measuredHeight) / 2; v.layout(x.toInt(), y, x.toInt() + v.measuredWidth, y + v.measuredHeight); x += v.measuredWidth + gap }
        if(lyrics) { val s=px(104);glow.layout((width-s)/2,(height-s)/2,(width+s)/2,(height+s)/2) }
    }
    override fun onDetachedFromWindow() { glowMotion.cancel();super.onDetachedFromWindow() }
}
