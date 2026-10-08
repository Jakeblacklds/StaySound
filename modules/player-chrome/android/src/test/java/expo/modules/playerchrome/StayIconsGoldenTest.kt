package expo.modules.playerchrome

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * Pins the Android catalogue to web/src/icons/stayIcons.ts: the golden holds every pen call the
 * TypeScript makes for every kind in six poses (node scripts/generate-goldens.mjs icons).
 */
class StayIconsGoldenTest {
    @Test fun everyIconDrawsTheSameAsTheWeb() {
        val text = javaClass.classLoader!!.getResource("stay-icons-golden.txt")!!.readText()
        val cases = text.split("\n# ").map { it.removePrefix("# ").trim().lines() }
        assertTrue("golden is empty", cases.size > 100)
        val kinds = mutableSetOf<String>()
        cases.forEach { case ->
            val (kind, press, flourish, state) = case.first().split(" ")
            kinds += kind
            val pen = RecordingPen()
            StayIcons.draw(pen, kind, press.toFloat(), flourish.toFloat(), state.toFloat())
            val expected = case.drop(1)
            val label = "$kind p=$press f=$flourish s=$state"
            assertEquals("$label: number of pen calls\n${diff(expected, pen.ops)}", expected.size, pen.ops.size)
            expected.zip(pen.ops).forEachIndexed { index, (want, got) -> assertTrue("$label call $index: want `$want`, got `$got`", same(want, got)) }
        }
        assertEquals("kinds the web draws but Android lacks", kinds, StayIcons.KINDS.toSet())
    }

    private fun same(want: String, got: String): Boolean {
        val a = want.split(" "); val b = got.split(" ")
        if (a.size != b.size || a[0] != b[0]) return false
        // Kotlin draws in Float, TypeScript in double: agree to a hundredth of a grid unit.
        return a.drop(1).zip(b.drop(1)).all { (x, y) -> x == y || abs(x.toFloat() - y.toFloat()) < .01f }
    }
    private fun diff(want: List<String>, got: List<String>) =
        (0 until maxOf(want.size, got.size)).firstOrNull { want.getOrNull(it)?.substringBefore(' ') != got.getOrNull(it)?.substringBefore(' ') }
            ?.let { "first divergence at call $it: want `${want.getOrNull(it)}`, got `${got.getOrNull(it)}`" } ?: ""
}

private class RecordingPen : IconPen {
    val ops = mutableListOf<String>()
    private fun rec(op: String, vararg args: Any) {
        ops += (listOf(op) + args.map { if (it is Float) (Math.round(it * 1e4) / 1e4).toString() else it.toString() }).joinToString(" ")
    }
    override fun save() = rec("save")
    override fun restore() = rec("restore")
    override fun translate(x: Float, y: Float) = rec("translate", x, y)
    override fun rotate(degrees: Float, px: Float, py: Float) = rec("rotate", degrees, px, py)
    override fun scale(sx: Float, sy: Float, px: Float, py: Float) = rec("scale", sx, sy, px, py)
    override fun skewX(k: Float) = rec("skewX", k)
    override fun begin() = rec("begin")
    override fun moveTo(x: Float, y: Float) = rec("moveTo", x, y)
    override fun lineTo(x: Float, y: Float) = rec("lineTo", x, y)
    override fun quadTo(x1: Float, y1: Float, x: Float, y: Float) = rec("quadTo", x1, y1, x, y)
    override fun cubicTo(x1: Float, y1: Float, x2: Float, y2: Float, x: Float, y: Float) = rec("cubicTo", x1, y1, x2, y2, x, y)
    override fun arc(cx: Float, cy: Float, r: Float, start: Float, sweep: Float) = rec("arc", cx, cy, r, start, sweep)
    override fun circle(cx: Float, cy: Float, r: Float) = rec("circle", cx, cy, r)
    override fun roundRect(left: Float, top: Float, right: Float, bottom: Float, radius: Float) = rec("roundRect", left, top, right, bottom, radius)
    override fun svgPath(d: String) = rec("svgPath", d.length)
    override fun close() = rec("close")
    override fun stroke(width: Float, opacity: Float) = rec("stroke", width, opacity)
    override fun fill(opacity: Float) = rec("fill", opacity)
    override fun solid(round: Float, opacity: Float) = rec("solid", round, opacity)
    override fun strokeTrim(width: Float, end: Float) = rec("strokeTrim", width, end)
}
