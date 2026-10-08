package expo.modules.playerchrome

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Renders the real catalogue through an SVG pen: bounds are checked, and a preview sheet is left in build/. */
class StayIconsTest {
    private val presses = listOf(-.35f, 0f, .5f, 1f)
    private val flourishes = (0..20).map { it / 20f }

    /** Hosts never clip icons, but a pose must stay near its box: speed trails may poke out briefly, bodies may not. */
    @Test fun everyIconStaysInsideItsBoxThroughTheWholeMotion() {
        StayIcons.KINDS.forEach { kind ->
            // The flourish starts on release, so a full press only ever meets the rest pose (f = 1).
            presses.forEach { p -> flourishes.filter { p < 1f || it == 1f }.forEach { f -> listOf(0f, 1f).forEach { s ->
                val pen = SvgPen(); StayIcons.draw(pen, kind, p, f, s)
                assertTrue("$kind p=$p f=$f draws nothing", pen.drew)
                assertTrue("$kind p=$p f=$f leaves the box: ${pen.box()}", pen.minX > -3.5f && pen.minY > -3.5f && pen.maxX < 27.5f && pen.maxY < 27.5f)
            } } }
        }
    }

    @Test fun restPoseIsTheSameAtBothEndsOfTheFlourish() {
        StayIcons.ANIMATED.forEach { kind ->
            if (kind == "check" || kind == "check-circle") return@forEach // draw-on: empty at 0 by design
            val start = SvgPen().also { StayIcons.draw(it, kind, 0f, 0f, 0f) }.signature()
            val end = SvgPen().also { StayIcons.draw(it, kind, 0f, 1f, 0f) }.signature()
            assertTrue("$kind jumps when a tap starts", start == end)
        }
    }

    @Test fun writesPreviewSheet() {
        val frames = listOf(-1f to 1f, 1f to 1f, 0f to .12f, 0f to .25f, 0f to .4f, 0f to .6f, 0f to 1f)
        val cell = 96; val pad = 8; val kinds = StayIcons.KINDS.toList()
        val cols = 3; val perCol = (kinds.size + 2) / 3
        val colWidth = 150 + frames.size * (cell + pad)
        val width = cols * colWidth; val height = 20 + perCol * (cell + pad)
        val out = StringBuilder("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"$width\" height=\"$height\"><rect width=\"100%\" height=\"100%\" fill=\"#1d1b22\"/>")
        kinds.forEachIndexed { index, kind ->
            val x0 = (index / perCol) * colWidth; val y = 10 + (index % perCol) * (cell + pad)
            out.append("<text x=\"${x0 + 8}\" y=\"${y + cell / 2 + 5}\" fill=\"#aaa\" font-size=\"16\" font-family=\"Helvetica\">$kind${if (kind in StayIcons.ANIMATED) " ✦" else ""}</text>")
            frames.forEachIndexed { c, (p, f) ->
                val x = x0 + 150 + c * (cell + pad)
                val pen = SvgPen(if (c == 0) "#9c98a6" else "#c9a8ff")
                StayIcons.draw(pen, kind, max(p, 0f), f, if (c == 0) 0f else StayIcons.stateOf(kind))
                out.append("<rect x=\"$x\" y=\"$y\" width=\"$cell\" height=\"$cell\" rx=\"12\" fill=\"#26242c\"/>")
                out.append("<g transform=\"translate(${x + 20} ${y + 20}) scale(${(cell - 40) / 24f})\">${pen.body()}</g>")
            }
        }
        out.append("</svg>")
        File("build/stay-icons").mkdirs(); File("build/stay-icons/preview.svg").writeText(out.toString())
    }
}

private class SvgPen(private val ink: String = "#fff") : IconPen {
    private var m = floatArrayOf(1f, 0f, 0f, 1f, 0f, 0f) // a b c d e f
    private val stack = ArrayDeque<FloatArray>()
    private val d = StringBuilder()
    private val points = mutableListOf<Pair<Float, Float>>()
    private val body = StringBuilder()
    private var cx = 0f; private var cy = 0f
    var drew = false; var minX = 99f; var minY = 99f; var maxX = -99f; var maxY = -99f
    fun body() = body.toString()
    /** Every drawn point, device space, rounded: equal for poses that look identical (e.g. an X turned 90°). */
    private val drawn = sortedSetOf<String>()
    fun signature() = drawn.joinToString(";")
    fun box() = "[$minX,$minY]..[$maxX,$maxY]"

    private fun concat(a: Float, b: Float, c: Float, dd: Float, e: Float, f: Float) {
        val (A, B, C, D, E, F) = m
        m = floatArrayOf(A * a + C * b, B * a + D * b, A * c + C * dd, B * c + D * dd, A * e + C * f + E, B * e + D * f + F)
    }
    private operator fun FloatArray.component6() = this[5]
    override fun save() { stack.addLast(m.copyOf()) }
    override fun restore() { m = stack.removeLast() }
    override fun translate(x: Float, y: Float) = concat(1f, 0f, 0f, 1f, x, y)
    override fun rotate(degrees: Float, px: Float, py: Float) {
        val r = Math.toRadians(degrees.toDouble()); val c = cos(r).toFloat(); val s = sin(r).toFloat()
        translate(px, py); concat(c, s, -s, c, 0f, 0f); translate(-px, -py)
    }
    override fun scale(sx: Float, sy: Float, px: Float, py: Float) { translate(px, py); concat(sx, 0f, 0f, sy, 0f, 0f); translate(-px, -py) }
    override fun skewX(k: Float) = concat(1f, 0f, k, 1f, 0f, 0f)
    override fun begin() { d.clear(); points.clear() }
    private fun pt(x: Float, y: Float) { points += x to y; cx = x; cy = y }
    override fun moveTo(x: Float, y: Float) { d.append("M$x $y "); pt(x, y) }
    override fun lineTo(x: Float, y: Float) { d.append("L$x $y "); pt(x, y) }
    override fun quadTo(x1: Float, y1: Float, x: Float, y: Float) { d.append("Q$x1 $y1 $x $y "); points += x1 to y1; pt(x, y) }
    override fun cubicTo(x1: Float, y1: Float, x2: Float, y2: Float, x: Float, y: Float) {
        d.append("C$x1 $y1 $x2 $y2 $x $y "); points += x1 to y1; points += x2 to y2; pt(x, y)
    }
    override fun arc(cx: Float, cy: Float, r: Float, start: Float, sweep: Float) {
        fun at(a: Float) = Math.toRadians(a.toDouble()).let { (cx + r * cos(it).toFloat()) to (cy + r * sin(it).toFloat()) }
        val (sx, sy) = at(start)
        d.append(if (points.isEmpty()) "M$sx $sy " else "L$sx $sy ")
        var done = 0f; val step = if (sweep > 0) 90f else -90f
        while (abs(done) < abs(sweep)) {
            val next = if (abs(sweep - done) < 90f) sweep else done + step
            val (ex, ey) = at(start + next)
            d.append("A$r $r 0 0 ${if (sweep > 0) 1 else 0} $ex $ey ")
            for (i in 0..8) at(start + done + (next - done) * i / 8f).let { points += it }
            done = next; this.cx = ex; this.cy = ey
        }
    }
    override fun circle(cx: Float, cy: Float, r: Float) {
        d.append("M${cx + r} $cy A$r $r 0 1 1 ${cx - r} $cy A$r $r 0 1 1 ${cx + r} $cy Z ")
        points += (cx - r) to (cy - r); points += (cx + r) to (cy + r); points += (cx - r) to (cy + r); points += (cx + r) to (cy - r)
    }
    override fun roundRect(left: Float, top: Float, right: Float, bottom: Float, radius: Float) {
        val r = min(radius, min(right - left, bottom - top) / 2f)
        d.append("M${left + r} $top H${right - r} A$r $r 0 0 1 $right ${top + r} V${bottom - r} A$r $r 0 0 1 ${right - r} $bottom H${left + r} A$r $r 0 0 1 $left ${bottom - r} V${top + r} A$r $r 0 0 1 ${left + r} $top Z ")
        points += left to top; points += right to bottom; points += left to bottom; points += right to top
    }
    override fun svgPath(d: String) {
        this.d.append("$d ")
        // The S mark's bounding box in its 1024 space, for the bounds check.
        points += 198f to 320f; points += 808f to 702f
    }
    override fun close() { d.append("Z ") }
    private fun emit(attrs: String, pad: Float) {
        drew = true
        val scale = sqrt(abs(m[0] * m[3] - m[1] * m[2]))
        points.forEach { (x, y) ->
            val tx = m[0] * x + m[2] * y + m[4]; val ty = m[1] * x + m[3] * y + m[5]
            minX = min(minX, tx - pad * scale); maxX = max(maxX, tx + pad * scale)
            minY = min(minY, ty - pad * scale); maxY = max(maxY, ty + pad * scale)
            drawn += "%.1f,%.1f".format(tx + 0f, ty + 0f).replace("-0.0", "0.0")
        }
        body.append("<path transform=\"matrix(${m.joinToString(" ")})\" d=\"$d\" $attrs/>")
    }
    override fun stroke(width: Float, opacity: Float) = emit("fill=\"none\" stroke=\"$ink\" stroke-opacity=\"$opacity\" stroke-width=\"$width\" stroke-linecap=\"round\" stroke-linejoin=\"round\"", width / 2)
    override fun fill(opacity: Float) = emit("fill=\"$ink\" fill-opacity=\"$opacity\"", 0f)
    override fun solid(round: Float, opacity: Float) = emit("fill=\"$ink\" fill-opacity=\"$opacity\" stroke=\"$ink\" stroke-opacity=\"$opacity\" stroke-width=\"$round\" stroke-linejoin=\"round\"", round / 2)
    override fun strokeTrim(width: Float, end: Float) {
        if (end <= 0f) { drew = true; return }
        emit("fill=\"none\" stroke=\"$ink\" stroke-width=\"$width\" stroke-linecap=\"round\" stroke-linejoin=\"round\" pathLength=\"1\" stroke-dasharray=\"$end 2\"", width / 2)
    }
}
