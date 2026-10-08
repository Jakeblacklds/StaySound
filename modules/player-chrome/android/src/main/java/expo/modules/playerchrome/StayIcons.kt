package expo.modules.playerchrome

import expo.modules.playerchrome.TabBeats.hop
import expo.modules.playerchrome.TabBeats.seg
import expo.modules.playerchrome.TabBeats.wobble
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.tan

/**
 * Drawing surface for [StayIcons]. Kept free of android.graphics so the catalogue can be
 * rendered and bounds-checked on the JVM (see StayIconsTest); [CanvasPen] is the device side.
 * Transforms pre-concatenate like Canvas; shape calls append to one current path.
 */
interface IconPen {
    fun save()
    fun restore()
    fun translate(x: Float, y: Float)
    fun rotate(degrees: Float, px: Float, py: Float)
    fun scale(sx: Float, sy: Float, px: Float, py: Float)
    fun skewX(k: Float)
    fun begin()
    fun moveTo(x: Float, y: Float)
    fun lineTo(x: Float, y: Float)
    fun quadTo(x1: Float, y1: Float, x: Float, y: Float)
    fun cubicTo(x1: Float, y1: Float, x2: Float, y2: Float, x: Float, y: Float)
    /** Appends an arc of the circle ([cx], [cy], [r]); clockwise for positive [sweep]. */
    fun arc(cx: Float, cy: Float, r: Float, start: Float, sweep: Float)
    fun circle(cx: Float, cy: Float, r: Float)
    fun roundRect(left: Float, top: Float, right: Float, bottom: Float, radius: Float)
    /** Appends SVG path data (used for the S mark, authored in its own 1024 space). */
    fun svgPath(d: String)
    fun close()
    fun stroke(width: Float, opacity: Float = 1f)
    fun fill(opacity: Float = 1f)
    /** Fill plus a round-joined stroke, which softens hard polygon corners. */
    fun solid(round: Float = 2f, opacity: Float = 1f)
    /** Strokes the leading [end] fraction (0..1) of the current path. */
    fun strokeTrim(width: Float, end: Float)
}

/**
 * Android port of web/src/icons/stayIcons.ts, which is the source of truth: the golden fixture
 * (scripts/tests/stay-icons-golden-cases.ts → StayIconsGoldenTest) pins every pen call. Change both.
 *
 * Every icon in the StaySound S language: the logo's -20° lean, round 2.1–2.4
 * strokes, solid wedges and slabs, the tapered speed tail. 24-unit grid.
 *
 * Inputs match the dock and transport glyphs: [press] squashes while held and swings past
 * rest on the spring release; [flourish] runs 0→1 once per tap and rests at 1, where every
 * pose is its rest pose; [state] is an icon's own 0..1 (heart filled, chip checked).
 * Icons outside [ANIMATED] only get the press squash.
 */
object StayIcons {
    const val W = 2.1f
    /** tan(-20°): the logo's forward lean. */
    const val ITALIC = -.36397f
    private const val K = ITALIC

    /** MaterialCommunityIcons and legacy drawable names → catalogue kinds. */
    private val ALIASES = mapOf(
        "chevron-down" to "down", "chevron-right" to "forward", "arrow-left" to "back",
        "dots-horizontal" to "more", "dots-vertical" to "more-vertical",
        "heart-outline" to "heart", "trash-can-outline" to "trash",
        "playlist-play" to "queue", "playlist-music" to "lyrics", "playlist-plus" to "playlist-add",
        "layers-outline" to "layers", "format-font" to "font", "magnify" to "search",
        "account-music" to "artist", "person" to "artist", "album" to "disc", "music-note" to "music",
        "share-variant" to "share", "star-four-points" to "stardust", "cricket" to "neon",
        "candle" to "ember", "water" to "silk", "blur" to "aurora", "spotlight-beam" to "columns",
        "sine-wave" to "caustics", "diamond-stone" to "refraction", "check-circle" to "check-circle",
        "circle-outline" to "circle", "done" to "check", "success" to "check", "skip-next" to "next",
        "skip-previous" to "previous", "repeat-once" to "repeat-one",
    )
    val KINDS = setOf(
        "back", "forward", "down", "close", "add", "more", "more-vertical", "check", "search",
        "settings", "refresh", "download", "heart", "trash", "drag", "queue", "lyrics", "playlist",
        "playlist-add", "disc", "artist", "music", "edit", "playing", "play", "pause", "shuffle",
        "next", "previous", "error", "alert", "warning", "info", "equalizer", "share", "layers",
        "check-circle", "circle", "font", "stardust", "aurora", "neon", "ember", "silk", "columns",
        "caustics", "refraction",
        // Dock, transport and desktop-only kinds.
        "tab-home", "tab-library", "tab-search", "tab-playlists", "play-pause", "repeat", "repeat-one",
        "volume", "volume-mute", "mic", "seek-back", "seek-forward", "keyboard", "phone", "folder",
        "sync", "spinner", "undo", "redo",
        // The one mark that is not ours: it has to be recognised, so it keeps its own shape.
        "github",
    )
    /** Kinds that play a bespoke beat on release; the rest only squash under the finger. */
    val ANIMATED = setOf(
        "back", "forward", "down", "close", "add", "more", "more-vertical", "check", "search",
        "settings", "refresh", "download", "heart", "trash", "queue", "lyrics", "playlist",
        "playlist-add", "disc", "artist", "music", "edit", "share", "equalizer", "play", "next",
        "previous", "shuffle", "check-circle", "stardust", "aurora", "neon", "ember", "silk",
        "columns", "caustics", "refraction",
        "tab-home", "tab-library", "tab-search", "tab-playlists", "play-pause", "repeat", "repeat-one",
        "volume", "volume-mute", "mic", "seek-back", "seek-forward", "sync", "undo", "redo",
    )
    /** Icons whose selected/filled variant is expressed through [draw]'s state. */
    fun stateOf(name: String): Float = when (name) { "heart", "check-circle" -> 1f; else -> 0f }
    fun resolve(name: String): String? = (ALIASES[name] ?: name).takeIf { it in KINDS }

    fun draw(pen: IconPen, kind: String, press: Float = 0f, flourish: Float = 1f, state: Float = 0f) {
        val p = press; val f = flourish
        pen.save()
        // The generic squash: every icon gives a little under the finger.
        val squash = if (kind in SELF_PRESSED) 0f else p
        pen.scale(1f - .1f * squash, 1f - .1f * squash, 12f, 12f)
        when (kind) {
            "back" -> { pen.scale(-1f, 1f, 12f, 12f); forward(pen, p, f, true) }
            "forward" -> forward(pen, p, f, false)
            "down" -> italic(pen) {
                val y = 1.2f * p + 2.2f * hop(f, 0f, .4f) - .6f * hop(f, .4f, .25f)
                pen.begin(); pen.moveTo(5f, 9f + y); pen.lineTo(12f, 16f + y); pen.lineTo(19f, 9f + y); pen.stroke(2.4f)
            }
            "close", "add" -> italic(pen) {
                pen.rotate(90f * outBack(seg(f, 0f, .55f)) - 90f, 12f, 12f)
                pen.begin()
                if (kind == "close") { pen.moveTo(6.2f, 6.2f); pen.lineTo(17.8f, 17.8f); pen.moveTo(17.8f, 6.2f); pen.lineTo(6.2f, 17.8f) }
                else { pen.moveTo(12f, 4.5f); pen.lineTo(12f, 19.5f); pen.moveTo(4.5f, 12f); pen.lineTo(19.5f, 12f) }
                pen.stroke(2.4f)
            }
            "more", "more-vertical" -> {
                if (kind == "more-vertical") pen.rotate(90f, 12f, 12f)
                italic(pen) {
                    for (i in 0..2) {
                        val x = 3.6f + i * 6.4f; val y = -1.8f * hop(f, i * .1f, .35f)
                        pen.begin(); pen.roundRect(x, 10.3f + y, x + 3.6f, 13.7f + y, 1.2f); pen.fill()
                    }
                }
            }
            "check" -> italic(pen) {
                pen.begin(); pen.moveTo(5f, 12.6f); pen.lineTo(10f, 17.6f); pen.lineTo(19.6f, 6.6f)
                pen.strokeTrim(2.5f, outCubic(seg(f, 0f, .45f)))
            }
            "check-circle", "circle" -> italic(pen) {
                pen.begin(); pen.circle(12f, 12f, 9f)
                if (state > 0f) pen.fill(.22f * state)
                pen.stroke(W)
                if (kind == "check-circle") {
                    pen.begin(); pen.moveTo(7.8f, 12.4f); pen.lineTo(10.8f, 15.4f); pen.lineTo(16.4f, 8.8f)
                    pen.strokeTrim(2.3f, outCubic(seg(f, 0f, .45f)))
                }
            }
            "search" -> italic(pen) {
                val dash = hop(f, 0f, .45f)
                val cx = 14.4f - 1.4f * p + 1.6f * dash + .6f * wobble(f, .3f, .6f)
                pen.begin(); pen.circle(cx, 10.4f, 5f); pen.stroke(2.4f)
                val h = cx + 5.6f * DIAGONAL; val hy = 10.4f + 5.6f * DIAGONAL
                pen.begin(); pen.moveTo(h, hy); pen.lineTo(h + 3.2f, hy + 3.2f); pen.stroke(2.6f)
                val reach = 2.6f * dash - 1.6f * p
                streak(pen, 1.6f - reach, cx - 7.2f, 8.4f, 1.5f, .9f)
                streak(pen, 3.4f - reach, cx - 7.2f, 12.6f, 1.3f, .6f)
            }
            "settings" -> italic(pen) {
                for (i in 0..2) {
                    val y = 5.5f + i * 6.5f
                    pen.begin(); pen.moveTo(3.5f, y); pen.lineTo(20.5f, y); pen.stroke(1.9f, .55f)
                    val x = SLIDER_KNOB[i] + 2.6f * wobble(f, i * .1f, .7f) * (if (i == 1) -1f else 1f)
                    pen.begin(); pen.roundRect(x - 1.8f, y - 2.6f, x + 1.8f, y + 2.6f, 1.2f); pen.fill()
                }
            }
            "equalizer" -> italic(pen) {
                for (i in 0..2) {
                    val x = 6f + i * 6f
                    pen.begin(); pen.moveTo(x, 3.5f); pen.lineTo(x, 20.5f); pen.stroke(1.9f, .55f)
                    val y = EQ_KNOB[i] + 3f * wobble(f, i * .1f, .7f) * (if (i == 1) 1f else -1f)
                    pen.begin(); pen.roundRect(x - 2.6f, y - 1.7f, x + 2.6f, y + 1.7f, 1.1f); pen.fill()
                }
            }
            "refresh" -> italic(pen) {
                pen.rotate(360f * outCubic(seg(f, 0f, .7f)) - 360f + 30f * p, 12f, 12f)
                pen.begin(); pen.arc(12f, 12f, 7.4f, -50f, 272f); pen.stroke(2.3f)
                arrowOnCircle(pen, 12f, 12f, 7.4f, 230f, 1f)
            }
            "sync" -> italic(pen) {
                // Two half-loops chasing each other; the pair turns half a lap on release.
                pen.rotate(180f * outCubic(seg(f, 0f, .7f)) - 180f + 24f * p, 12f, 12f)
                for (start in floatArrayOf(200f, 20f)) {
                    pen.begin(); pen.arc(12f, 12f, 7.2f, start, 118f); pen.stroke(2.2f)
                    arrowOnCircle(pen, 12f, 12f, 7.2f, start + 124f, .85f)
                }
            }
            "spinner" -> italic(pen) {
                pen.begin(); pen.arc(12f, 12f, 8.2f, -90f, 270f); pen.stroke(2.3f)
                pen.begin(); pen.circle(12f + 8.2f, 12f, 1.45f); pen.fill()
            }
            "download" -> italic(pen) {
                val drop = 1.4f * p + 3f * hop(f, 0f, .35f)
                val squashBase = hop(f, .28f, .25f)
                pen.begin(); pen.moveTo(12f, 3.4f + drop * .5f); pen.lineTo(12f, 12.6f + drop); pen.stroke(2.4f)
                wedge(pen, 7f, 10.4f + drop, 17f, 10.4f + drop, 12f, 16.4f + drop)
                pen.begin(); pen.roundRect(4.2f - squashBase, 18.4f + .6f * squashBase, 19.8f + squashBase, 21f, 1.2f); pen.fill()
            }
            "heart" -> italic(pen) {
                // The lean throws the lobes right; pull the heart back onto the grid's centre.
                val pump = .9f * (1f + .2f * hop(f, 0f, .3f) + .07f * hop(f, .32f, .22f))
                pen.translate(-1.1f, 0f); pen.scale(pump, pump, 12f, 12.5f)
                pen.begin(); heart(pen)
                if (state > 0f) pen.fill(state)
                pen.stroke(W)
            }
            "trash" -> italic(pen) {
                val lift = hop(f, 0f, .5f)
                pen.save(); pen.translate(0f, -2.2f * lift); pen.rotate(-14f * lift, 4f, 6.4f)
                pen.begin(); pen.moveTo(4f, 6.4f); pen.lineTo(20f, 6.4f); pen.moveTo(9.4f, 6.4f); pen.lineTo(9.8f, 3.8f)
                pen.lineTo(14.2f, 3.8f); pen.lineTo(14.6f, 6.4f); pen.stroke(W)
                pen.restore()
                pen.begin(); pen.moveTo(6.1f, 8.9f); pen.lineTo(7.3f, 19.1f); pen.quadTo(7.5f, 20.8f, 9.1f, 20.8f)
                pen.lineTo(14.9f, 20.8f); pen.quadTo(16.5f, 20.8f, 16.7f, 19.1f); pen.lineTo(17.9f, 8.9f); pen.stroke(W)
                pen.begin(); pen.moveTo(10.4f, 11.6f); pen.lineTo(10.6f, 17.6f); pen.moveTo(13.6f, 11.6f); pen.lineTo(13.4f, 17.6f); pen.stroke(1.6f, .7f)
            }
            "drag" -> italic(pen) {
                pen.begin(); pen.moveTo(5f, 9f); pen.lineTo(19f, 9f); pen.moveTo(5f, 15f); pen.lineTo(19f, 15f); pen.stroke(2.3f)
            }
            "queue" -> italic(pen) {
                strokes(pen, p, f, 2, floatArrayOf(20.4f, 15.6f))
                val dash = 2f * hop(f, .1f, .4f) - p
                wedge(pen, 14.2f + dash, 13.8f, 14.2f + dash, 21.2f, 21.2f + dash, 17.5f)
            }
            "playlist" -> italic(pen) { strokes(pen, p, f, 3, floatArrayOf(20.2f, 17f, 13.8f)) }
            "playlist-add" -> italic(pen) {
                strokes(pen, p, f, 2, floatArrayOf(20.2f, 12.6f))
                pen.save(); pen.rotate(90f * outBack(seg(f, 0f, .55f)) - 90f, 17.2f, 18.2f)
                pen.begin(); pen.moveTo(17.2f, 14.6f); pen.lineTo(17.2f, 21.8f); pen.moveTo(13.6f, 18.2f); pen.lineTo(20.8f, 18.2f)
                pen.stroke(2.3f); pen.restore()
            }
            "lyrics" -> italic(pen) {
                for (i in 0..1) {
                    val x = 7.6f + i * 8f; val y = -2f * hop(f, i * .12f, .36f)
                    pen.begin(); pen.circle(x, 8.6f + y, 3.3f); pen.fill()
                    pen.begin(); pen.moveTo(x + 3.1f, 9.2f + y); pen.cubicTo(x + 3f, 13.6f + y, x + .6f, 16.8f + y, x - 3f, 18.4f + y)
                    pen.stroke(2.3f)
                }
            }
            "disc" -> italic(pen) {
                pen.begin(); pen.circle(12f, 12f, 8.6f); pen.stroke(W)
                pen.begin(); pen.circle(12f, 12f, 2.2f); pen.fill()
                pen.begin(); pen.arc(12f, 12f, 5.4f, 205f + 720f * outCubic(seg(f, 0f, .85f)), 62f); pen.stroke(1.6f, .65f)
            }
            "artist" -> italic(pen) {
                val bob = -1.6f * hop(f, 0f, .34f) + .5f * hop(f, .34f, .2f)
                pen.begin(); pen.circle(12f, 7.8f + bob, 3.9f); pen.stroke(2.2f)
                pen.begin(); pen.moveTo(4.6f, 20.2f); pen.cubicTo(5.4f, 15.8f, 8.4f, 13.6f, 12f, 13.6f)
                pen.cubicTo(15.6f, 13.6f, 18.6f, 15.8f, 19.4f, 20.2f); pen.stroke(2.2f)
            }
            "music" -> italic(pen) {
                val air = hop(f, 0f, .42f); val land = hop(f, .42f, .2f)
                pen.translate(0f, -3f * air)
                pen.scale(1f + .08f * land, 1f - .12f * land, 12f, 20.4f)
                pen.begin(); pen.moveTo(11.8f, 17.4f); pen.lineTo(11.8f, 3.8f); pen.cubicTo(14.8f, 4.6f, 17.8f, 5.8f, 18.4f, 9.6f); pen.stroke(2.2f)
                pen.save(); pen.rotate(-20f, 8.6f, 17.4f)
                pen.begin(); pen.roundRect(5.2f, 15f, 12f, 19.8f, 2.4f); pen.fill()
                pen.restore()
            }
            "mic" -> italic(pen) {
                val lift = -1.6f * hop(f, 0f, .36f) + .4f * hop(f, .36f, .2f)
                pen.begin(); pen.roundRect(9f, 2.8f + lift, 15f, 14.2f + lift, 3f); pen.fill(.22f + .78f * state); pen.stroke(W)
                pen.begin(); pen.moveTo(5.6f, 10.8f); pen.quadTo(5.6f, 17.6f, 12f, 17.6f); pen.quadTo(18.4f, 17.6f, 18.4f, 10.8f); pen.stroke(W)
                pen.begin(); pen.moveTo(12f, 17.6f); pen.lineTo(12f, 21f); pen.moveTo(8.6f, 21f); pen.lineTo(15.4f, 21f); pen.stroke(W)
            }
            "edit" -> italic(pen) {
                pen.rotate(-12f * wobble(f, 0f, .7f), 5f, 19f)
                pen.begin(); pen.moveTo(14.6f, 4.6f); pen.lineTo(19.4f, 9.4f); pen.lineTo(9f, 19.8f); pen.lineTo(4.2f, 19.8f)
                pen.lineTo(4.2f, 15f); pen.close(); pen.stroke(W)
                pen.begin(); pen.moveTo(12.4f, 6.8f); pen.lineTo(17.2f, 11.6f); pen.stroke(W)
            }
            "playing", "columns" -> italic(pen) {
                val heights = if (kind == "playing") PLAYING else COLUMNS
                for (i in 0..2) {
                    val x = 4.2f + i * 5.8f
                    val h = heights[i] * (1f + .25f * wobble(f, i * .08f, .6f))
                    pen.begin(); pen.roundRect(x, 20.4f - h, x + 3.6f, 20.4f, 1.2f); pen.fill(if (kind == "columns") .55f + .45f * (i % 2) else 1f)
                }
            }
            "play", "pause" -> italic(pen) {
                val dash = hop(f, 0f, .45f)
                pen.translate(-p + 1.2f * dash, 0f)
                pen.begin()
                if (kind == "play") { pen.moveTo(6.5f, 4.5f); pen.lineTo(20f, 12f); pen.lineTo(6.5f, 19.5f); pen.close(); pen.solid(2.2f) }
                else { pen.roundRect(5f, 4.6f, 10.2f, 19.4f, 1.3f); pen.roundRect(13.8f, 4.6f, 19f, 19.4f, 1.3f); pen.fill() }
            }
            "play-pause" -> {
                // A leaning wedge that splits into two leaning slabs (state 0 = play, 1 = pause).
                val dash = hop(f, 0f, .45f)
                if (dash > .02f) italic(pen) {
                    streak(pen, 1.5f - 2f * dash, 6.5f, 9f, 1.1f, .5f * dash)
                    streak(pen, 2.5f - 2f * dash, 6.8f, 15f, 1f, .4f * dash)
                }
                pen.save()
                pen.translate(-p + 1.2f * dash, 0f)
                pen.scale(1f - .1f * p + .12f * dash, 1f - .06f * p - .08f * dash, 12f, 12f)
                italic(pen) {
                    for (half in 0..1) {
                        pen.begin()
                        for (corner in 0..3) {
                            val i = half * 8 + corner * 2
                            val x = PLAY_QUADS[i] + (PAUSE_QUADS[i] - PLAY_QUADS[i]) * state
                            val y = PLAY_QUADS[i + 1] + (PAUSE_QUADS[i + 1] - PLAY_QUADS[i + 1]) * state
                            if (corner == 0) pen.moveTo(x, y) else pen.lineTo(x, y)
                        }
                        pen.close(); pen.solid(2.2f)
                    }
                }
                pen.restore()
            }
            "next", "previous" -> {
                if (kind == "previous") pen.scale(-1f, 1f, 12f, 12f)
                italic(pen) {
                    val x = -1.6f * p + 2.6f * hop(f, 0f, .4f)
                    val reach = 3f * hop(f, 0f, .4f) - 1.5f * p
                    val echo = hop(f, .05f, .5f)
                    streak(pen, 2.2f - reach, 8.6f + x * .4f, 9.2f, 1.4f, .75f)
                    streak(pen, 3.8f - reach, 8.6f + x * .4f, 14.8f, 1.2f, .5f)
                    if (echo > .02f) wedge(pen, 9f + x - 3.4f * echo, 6.5f, 9f + x - 3.4f * echo, 17.5f, 18f + x - 3.4f * echo, 12f, .35f * echo)
                    wedge(pen, 10f + x, 6f, 10f + x, 18f, 19.2f + x, 12f)
                }
            }
            "seek-back", "seek-forward" -> {
                italic(pen) {
                    // Ten seconds either way: a loop that kicks round with the digits riding inside.
                    // Only the loop mirrors for seek-back; the digits must still read "10".
                    pen.save()
                    if (kind == "seek-back") pen.scale(-1f, 1f, 12f, 12f)
                    pen.rotate(-26f * p + 30f * wobble(f, 0f, .7f), 12f, 12f)
                    pen.begin(); pen.arc(12f, 12f, 8.4f, -5f, 290f); pen.stroke(2.2f)
                    arrowOnCircle(pen, 12f, 12f, 8.4f, 291f, .9f)
                    pen.restore()
                    pen.begin(); pen.roundRect(8.3f, 9.2f, 10.1f, 15f, .8f); pen.fill()
                    pen.begin(); pen.circle(14.1f, 12.1f, 2.35f); pen.stroke(1.8f)
                }
            }
            "shuffle" -> italic(pen) {
                val head = 18.6f + 1.8f * hop(f, 0f, .4f) - 1.2f * p
                val slide = 2.2f * wobble(f, .05f, .8f)
                for (lane in 0..1) {
                    val y0 = if (lane == 0) 17.2f else 6.8f; val y1 = if (lane == 0) 6.8f else 17.2f
                    pen.begin(); pen.moveTo(3.2f, y0); pen.cubicTo(9f + slide, y0, 12.4f + slide, y1, head - 1.4f, y1); pen.stroke(2.3f)
                    wedge(pen, head - 1.6f, y1 - 2.9f, head - 1.6f, y1 + 2.9f, head + 2.2f, y1)
                }
            }
            "repeat", "repeat-one" -> {
                // A leaning loop whose gap and arrowhead run one full lap on release.
                val s = 1f - .1f * p
                val start = .22f + outCubic(seg(f, 0f, .85f))
                pen.save(); pen.scale(s, s, 12f, 12f)
                italic(pen) {
                    pen.begin()
                    val from = start + .02f; val to = start + .9f
                    for (i in 0..LOOP_SAMPLES) {
                        val (x, y) = loopPoint(from + (to - from) * i / LOOP_SAMPLES)
                        if (i == 0) pen.moveTo(x, y) else pen.lineTo(x, y)
                    }
                    pen.stroke(2.2f)
                    val (hx, hy, angle) = loopPoint(to)
                    pen.save(); pen.translate(hx, hy); pen.rotate(angle, 0f, 0f)
                    pen.begin(); pen.moveTo(-1.2f, -3f); pen.lineTo(3f, 0f); pen.lineTo(-1.2f, 3f); pen.close(); pen.solid(1.4f)
                    pen.restore()
                    if (kind == "repeat-one") { pen.begin(); pen.roundRect(11f, 9.6f, 13f, 14.4f, .9f); pen.fill() }
                }
                pen.restore()
            }
            "github" -> {
                pen.scale(.9f, .9f, 12f, 12f)
                pen.begin(); pen.svgPath(GITHUB_MARK); pen.fill()
            }
            "undo", "redo" -> {
                if (kind == "redo") pen.scale(-1f, 1f, 12f, 12f)
                italic(pen) {
                    val dash = -1.8f * hop(f, 0f, .4f) + 1.2f * p
                    pen.begin(); pen.moveTo(7.4f + dash, 9.4f); pen.lineTo(14.6f, 9.4f); pen.cubicTo(18.2f, 9.4f, 20.4f, 11.8f, 20.4f, 14.9f)
                    pen.cubicTo(20.4f, 18.1f, 18.1f, 20.4f, 14.6f, 20.4f); pen.lineTo(10.6f, 20.4f); pen.stroke(2.2f)
                    wedge(pen, 8.8f + dash, 5.4f, 8.8f + dash, 13.4f, 3.4f + dash, 9.4f)
                }
            }
            "error", "alert", "info", "warning" -> italic(pen) {
                if (kind == "error") { pen.begin(); pen.circle(12f, 12f, 9f); pen.stroke(W) }
                if (kind == "warning") {
                    pen.begin(); pen.moveTo(12f, 3.8f); pen.lineTo(21f, 19.6f); pen.lineTo(3f, 19.6f); pen.close(); pen.stroke(W)
                }
                val (top, bottom, dot) = when (kind) {
                    "info" -> Triple(10.6f, 17.4f, 6.8f)
                    "warning" -> Triple(9.4f, 14.2f, 17f)
                    "error" -> Triple(6.8f, 13.2f, 16.8f)
                    else -> Triple(5f, 14f, 18.6f)
                }
                pen.begin(); pen.roundRect(10.9f, top, 13.1f, bottom, 1f); pen.fill()
                pen.begin(); pen.circle(12f, dot, 1.35f); pen.fill()
            }
            "share" -> italic(pen) {
                val launch = -3f * hop(f, 0f, .4f) + 1.2f * p
                pen.begin(); pen.moveTo(5f, 12.6f); pen.lineTo(5f, 18.6f); pen.quadTo(5f, 20.6f, 7f, 20.6f)
                pen.lineTo(17f, 20.6f); pen.quadTo(19f, 20.6f, 19f, 18.6f); pen.lineTo(19f, 12.6f); pen.stroke(W)
                pen.begin(); pen.moveTo(12f, 15.4f); pen.lineTo(12f, 6f + launch); pen.stroke(2.3f)
                wedge(pen, 7.8f, 8.6f + launch, 16.2f, 8.6f + launch, 12f, 3f + launch)
            }
            "layers" -> italic(pen) {
                for (i in 0..2) {
                    val x = 4.2f + (2 - i) * 1.1f; val y = 4.8f + i * 5.2f
                    pen.begin(); pen.roundRect(x, y, x + 12.6f, y + 4f, 1.2f); pen.fill(SLEEVES[i])
                }
            }
            "font" -> italic(pen) {
                pen.begin(); pen.moveTo(4.6f, 20f); pen.lineTo(12f, 4f); pen.lineTo(19.4f, 20f); pen.moveTo(7.8f, 14.4f); pen.lineTo(16.2f, 14.4f)
                pen.stroke(2.3f)
            }
            "keyboard" -> italic(pen) {
                pen.begin(); pen.roundRect(2.8f, 6.4f, 21.2f, 17.6f, 2.4f); pen.stroke(W)
                for (i in 0..3) { val x = 5.9f + i * 3.6f; pen.begin(); pen.roundRect(x, 8.9f, x + 1.9f, 10.8f, .6f); pen.fill() }
                pen.begin(); pen.roundRect(8f, 13.3f, 16f, 14.9f, .8f); pen.fill()
            }
            "phone" -> italic(pen) {
                pen.begin(); pen.roundRect(7f, 2.8f, 17f, 21.2f, 2.6f); pen.stroke(W)
                pen.begin(); pen.roundRect(10.4f, 17.3f, 13.6f, 18.5f, .6f); pen.fill()
            }
            "folder" -> italic(pen) {
                pen.begin(); pen.moveTo(3.4f, 7f); pen.quadTo(3.4f, 5.4f, 5f, 5.4f); pen.lineTo(9.2f, 5.4f); pen.lineTo(11.2f, 7.8f)
                pen.lineTo(19f, 7.8f); pen.quadTo(20.6f, 7.8f, 20.6f, 9.4f); pen.lineTo(20.6f, 17.4f); pen.quadTo(20.6f, 19f, 19f, 19f)
                pen.lineTo(5f, 19f); pen.quadTo(3.4f, 19f, 3.4f, 17.4f); pen.close(); pen.stroke(W)
            }
            "volume", "volume-mute" -> italic(pen) {
                speaker(pen)
                if (kind == "volume-mute") {
                    pen.save(); pen.rotate(90f * outBack(seg(f, 0f, .55f)) - 90f, 17.6f, 12f)
                    pen.begin(); pen.moveTo(15.2f, 9.6f); pen.lineTo(20f, 14.4f); pen.moveTo(20f, 9.6f); pen.lineTo(15.2f, 14.4f); pen.stroke(2.2f)
                    pen.restore()
                } else {
                    // state is the level: the near wave shows from 0, the far one fades in past half.
                    for (i in 0..1) {
                        val level = if (i == 0) minOf(1f, state * 3f) else maxOf(0f, state * 2f - 1f)
                        if (level <= .01f) continue
                        val r = (if (i == 0) 4.2f else 7.6f) + 1.2f * hop(f, i * .12f, .4f)
                        pen.begin(); pen.arc(11.4f, 12f, r, -48f, 96f); pen.stroke(2.1f, level)
                    }
                }
            }
            "tab-home" -> {
                // The S itself: winds back (upright, drawn in) while held, dashes forward trailing speed lines.
                val dash = hop(f, 0f, .5f)
                if (dash > .01f) {
                    streak(pen, 1.2f - 2.2f * dash, 7.6f, 9.2f, 1.2f, .55f * dash)
                    streak(pen, 2.6f - 2.2f * dash, 8.4f, 14.8f, 1.1f, .4f * dash)
                }
                pen.save()
                pen.translate(12f - 1.2f * p + 1.4f * dash, 12f)
                pen.skewX(tan(Math.toRadians((14f * p - 11f * dash).toDouble())).toFloat())
                pen.scale(1f - .1f * p + .12f * dash, 1f, 0f, 0f)
                pen.scale(S_SCALE, S_SCALE, 0f, 0f)
                pen.translate(-503f, -511f)
                pen.begin(); pen.svgPath(S_MARK); pen.fill()
                pen.restore()
            }
            "tab-library" -> for (i in 0..2) {
                // Three sleeves in a crate, the front one brightest; flicked forward in turn on release.
                val flick = hop(f, i * .1f, .34f)
                val x = 3.8f + (2 - i) * 1.2f - 1.3f * p * (1f + i * .3f) + 1.8f * flick
                val y = 4.6f + i * 5.4f
                italic(pen) {
                    if (flick > .05f) streak(pen, x - 6f * flick, x - .9f, y + 2.1f, .9f, .55f * flick)
                    pen.begin(); pen.roundRect(x, y, x + 13f, y + 4.2f, 1.2f); pen.fill(SLEEVES[i])
                }
            }
            "tab-search" -> italic(pen) {
                // A lens on the move: pulls back while held, lunges forward on release and settles.
                val dash = hop(f, 0f, .45f)
                val cx = 14.4f - 1.4f * p + 1.6f * dash + .6f * wobble(f, .3f, .6f)
                val r = 5f * (1f - .06f * p)
                pen.begin(); pen.circle(cx, 10.4f, r)
                if (state > 0f) pen.fill(.22f * state)
                pen.stroke(2.5f)
                val hx = cx + (r + .6f) * DIAGONAL; val hy = 10.4f + (r + .6f) * DIAGONAL
                val handle = 3.2f * (1f - .3f * p)
                pen.begin(); pen.moveTo(hx, hy); pen.lineTo(hx + handle, hy + handle); pen.stroke(2.7f)
                val reach = 2.6f * dash - 1.6f * p
                streak(pen, 1.6f - reach, cx - r - 2.2f, 8.4f, 1.5f, .9f)
                streak(pen, 3.4f - reach, cx - r - 2.2f, 12.6f, 1.3f, .6f)
            }
            "tab-playlists" -> for (i in 0..2) {
                // The S's tail three times: heads draw in while held, then the strokes whip out in turn.
                val x0 = TAB_TAIL[i]; val x1 = TAB_HEAD[i]
                val head = x1 - 1.8f * p * (1f + .2f * i) + (x1 - x0) * .14f * wobble(f, i * .09f, .6f)
                val tail = x0 + 1.2f * p - 1.6f * hop(f, i * .09f, .35f)
                italic(pen) { streak(pen, tail, head, 5.8f + i * 6.2f, 2.5f, 1f) }
            }
            "stardust" -> italic(pen) {
                val tw = 1f + .3f * hop(f, 0f, .35f); val tw2 = 1f + .5f * hop(f, .18f, .35f)
                star(pen, 10.4f, 13f, 7.6f * tw); pen.fill()
                star(pen, 18.6f, 5.2f, 3.2f * tw2); pen.fill(.7f)
            }
            "aurora", "silk", "caustics" -> italic(pen) {
                val phase = 3f * wobble(f, 0f, .8f)
                when (kind) {
                    "aurora" -> for (i in 0..2) {
                        val y = 6.4f + i * 5.6f; val sh = phase * (1f - i * .3f)
                        pen.begin(); pen.moveTo(3f, y + 1.6f); pen.cubicTo(8f + sh, y - 3f, 13f + sh, y + 4.4f, 21f, y - .6f)
                        pen.stroke(2.2f, AURORA[i])
                    }
                    "silk" -> for (i in 0..1) {
                        val y = 9f + i * 6f
                        pen.begin(); pen.moveTo(3f, y); pen.cubicTo(8f + phase, y - 5f, 12f - phase, y + 5f, 21f, y - 1.8f)
                        pen.stroke(if (i == 0) 2.3f else 1.8f, if (i == 0) 1f else .6f)
                    }
                    else -> { pen.begin(); pen.moveTo(2.4f, 12f); pen.cubicTo(5.4f, 4.6f + phase, 8.6f, 4.6f + phase, 12f, 12f)
                        pen.cubicTo(15.4f, 19.4f - phase, 18.6f, 19.4f - phase, 21.6f, 12f); pen.stroke(2.3f) }
                }
            }
            "neon" -> italic(pen) {
                val flick = 1f - .6f * hop(f, .05f, .12f) + .4f * hop(f, .2f, .2f)
                pen.begin(); pen.moveTo(3f, 15.4f); pen.lineTo(7.6f, 8.4f); pen.lineTo(12.2f, 15.4f); pen.lineTo(16.8f, 8.4f); pen.lineTo(21f, 13f)
                pen.stroke(5.4f, .18f * flick); pen.stroke(2.3f, flick.coerceAtMost(1f))
            }
            "ember" -> italic(pen) {
                val flick = hop(f, 0f, .3f) - .5f * hop(f, .3f, .3f)
                pen.scale(1f - .06f * flick, 1f + .14f * flick, 12f, 20.5f)
                pen.begin(); pen.moveTo(12f, 3f); pen.cubicTo(16.2f, 7.8f, 18.6f, 11f, 18.6f, 14.4f)
                pen.cubicTo(18.6f, 18f, 15.6f, 20.8f, 12f, 20.8f); pen.cubicTo(8.4f, 20.8f, 5.4f, 18f, 5.4f, 14.4f)
                pen.cubicTo(5.4f, 11.6f, 7.2f, 9.6f, 8.8f, 8.2f); pen.cubicTo(9.2f, 10.6f, 10.4f, 11.6f, 11.6f, 12f)
                pen.cubicTo(10.8f, 9f, 11f, 6f, 12f, 3f); pen.close(); pen.fill()
            }
            "refraction" -> italic(pen) {
                pen.rotate(8f * wobble(f, 0f, .7f), 12f, 12f)
                pen.begin(); pen.moveTo(4.6f, 9.2f); pen.lineTo(8.8f, 4.4f); pen.lineTo(15.2f, 4.4f); pen.lineTo(19.4f, 9.2f)
                pen.lineTo(12f, 20.2f); pen.close(); pen.stroke(W)
                pen.begin(); pen.moveTo(4.6f, 9.2f); pen.lineTo(19.4f, 9.2f); pen.moveTo(8.8f, 4.4f); pen.lineTo(12f, 9.2f)
                pen.lineTo(15.2f, 4.4f); pen.moveTo(12f, 9.2f); pen.lineTo(12f, 20.2f); pen.stroke(1.5f, .6f)
            }
        }
        pen.restore()
    }

    private val SELF_PRESSED = setOf(
        "back", "forward", "search", "play", "pause", "next", "previous", "shuffle", "queue", "download", "share",
        "playlist", "playlist-add", "tab-home", "tab-library", "tab-search", "tab-playlists", "play-pause", "repeat",
        "repeat-one", "undo", "redo",
    )
    private val SLIDER_KNOB = floatArrayOf(8f, 15.4f, 10.4f)
    private val EQ_KNOB = floatArrayOf(14f, 8f, 12.4f)
    private val PLAYING = floatArrayOf(7f, 14.6f, 10.4f)
    private val COLUMNS = floatArrayOf(11f, 16.4f, 8.2f)
    private val SLEEVES = floatArrayOf(1f, .7f, .45f)
    private val AURORA = floatArrayOf(1f, .72f, .45f)
    private const val DIAGONAL = .70710677f
    private const val LOOP_SAMPLES = 72
    private const val S_SCALE = 19.5f / 610f
    private val TAB_TAIL = floatArrayOf(2.8f, 4.6f, 6.4f)
    private val TAB_HEAD = floatArrayOf(20.2f, 17f, 13.8f)
    // Play splits into two quads (a trapezoid and a degenerate tip) so it morphs vertex-for-vertex into pause.
    private val PLAY_QUADS = floatArrayOf(6.5f, 4.5f, 13.25f, 8.25f, 13.25f, 15.75f, 6.5f, 19.5f, 13.25f, 8.25f, 20f, 12f, 20f, 12f, 13.25f, 15.75f)
    private val PAUSE_QUADS = floatArrayOf(5f, 4.6f, 10.2f, 4.6f, 10.2f, 19.4f, 5f, 19.4f, 13.8f, 4.6f, 19f, 4.6f, 19f, 19.4f, 13.8f, 19.4f)
    /** assets/images/icon.png traced in its 1024 space, centred on (503, 511). */
    /** GitHub's mark, in its own 24-unit box. */
    const val GITHUB_MARK = "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
    const val S_MARK = "M198 510C250 508 280 500 300 490C380 440 430 340 580 320L808 320L715 400C700 412 680 418 660 418" +
        "L515 418C470 418 452 448 458 470C462 486 478 493 495 493L690 493C715 495 722 515 715 535" +
        "C700 570 650 640 560 680C520 698 470 702 430 702L232 702L365 592L490 592C540 592 568 565 572 540" +
        "C574 522 560 512 540 512L198 512Z"
    private operator fun FloatArray.component5() = this[4]

    private inline fun italic(pen: IconPen, draw: () -> Unit) {
        pen.save(); pen.translate(-K * 12f, 0f); pen.skewX(K); draw(); pen.restore()
    }
    /** A chevron that dashes the way it points, leaving a speed line behind. */
    private fun forward(pen: IconPen, p: Float, f: Float, back: Boolean) = italic(pen) {
        val dash = hop(f, 0f, .4f)
        val x = -1.2f * p + 2.2f * dash
        if (dash > .02f) streak(pen, 3f - 2f * dash, 8.2f + x, 12f, 1.3f, .6f * dash)
        pen.begin(); pen.moveTo(9f + x, 5f); pen.lineTo(16f + x, 12f); pen.lineTo(9f + x, 19f)
        pen.stroke(if (back) 2.4f else 2.3f)
    }
    /** The dock's Playlists strokes: heads draw in while held and whip out in turn. */
    private fun strokes(pen: IconPen, p: Float, f: Float, count: Int, heads: FloatArray) {
        for (i in 0 until count) {
            val x0 = 2.8f + i * 1.8f; val x1 = heads[i]
            val head = x1 - 1.8f * p * (1f + .2f * i) + (x1 - x0) * .14f * wobble(f, i * .09f, .6f)
            val tail = x0 + 1.2f * p - 1.6f * hop(f, i * .09f, .35f)
            streak(pen, tail, head, 5.8f + i * 6.2f, 2.5f, 1f)
        }
    }
    fun streak(pen: IconPen, x0: Float, x1: Float, y: Float, thickness: Float, opacity: Float) {
        val r = thickness / 2f
        pen.begin(); pen.moveTo(x0, y + r * .35f); pen.lineTo(x1 - r, y - r); pen.arc(x1 - r, y, r, -90f, 180f); pen.close()
        pen.fill(opacity)
    }
    private fun wedge(pen: IconPen, ax: Float, ay: Float, bx: Float, by: Float, tipX: Float, tipY: Float, opacity: Float = 1f) {
        pen.begin(); pen.moveTo(ax, ay); pen.lineTo(tipX, tipY); pen.lineTo(bx, by); pen.close(); pen.solid(1.6f, opacity)
    }
    /** An arrowhead sitting on a circle at [angle], pointing along the clockwise tangent. */
    private fun arrowOnCircle(pen: IconPen, cx: Float, cy: Float, r: Float, angle: Float, size: Float) {
        val a = Math.toRadians(angle.toDouble()); val c = cos(a).toFloat(); val s = sin(a).toFloat()
        val ex = cx + r * c; val ey = cy + r * s
        wedge(pen, ex - 2.9f * size * c, ey - 2.9f * size * s, ex + 2.9f * size * c, ey + 2.9f * size * s, ex - 3.4f * size * s, ey + 3.4f * size * c)
    }
    private fun speaker(pen: IconPen) {
        pen.begin(); pen.moveTo(3.4f, 9.4f); pen.lineTo(6.8f, 9.4f); pen.lineTo(11.4f, 5.2f); pen.lineTo(11.4f, 18.8f)
        pen.lineTo(6.8f, 14.6f); pen.lineTo(3.4f, 14.6f); pen.close(); pen.solid(1.6f)
    }
    /** The repeat loop (a rounded rect) walked clockwise from its top-left straight: x, y and tangent angle at [u] laps. */
    private fun loopPoint(u: Float): Triple<Float, Float, Float> {
        val x0 = 4f; val y0 = 6.8f; val x1 = 20f; val y1 = 17.2f; val r = 4.4f
        val w = x1 - x0 - 2 * r; val h = y1 - y0 - 2 * r; val q = (PI * r / 2).toFloat()
        val total = 2 * w + 2 * h + 4 * q
        var d = (((u % 1f) + 1f) % 1f) * total
        val parts = arrayOf(
            floatArrayOf(0f, w, x0 + r, y0, 0f), floatArrayOf(1f, q, x1 - r, y0 + r, -90f), floatArrayOf(0f, h, x1, y0 + r, 90f),
            floatArrayOf(1f, q, x1 - r, y1 - r, 0f), floatArrayOf(0f, w, x1 - r, y1, 180f), floatArrayOf(1f, q, x0 + r, y1 - r, 90f),
            floatArrayOf(0f, h, x0, y1 - r, 270f), floatArrayOf(1f, q, x0 + r, y0 + r, 180f),
        )
        for ((arc, length, ox, oy, angle) in parts) {
            if (d <= length) {
                if (arc == 1f) {
                    val theta = Math.toRadians((angle + 90f * d / length).toDouble())
                    return Triple(ox + r * cos(theta).toFloat(), oy + r * sin(theta).toFloat(), angle + 90f * d / length + 90f)
                }
                val rad = Math.toRadians(angle.toDouble())
                return Triple(ox + d * cos(rad).toFloat(), oy + d * sin(rad).toFloat(), angle)
            }
            d -= length
        }
        return Triple(x0 + r, y0, 0f)
    }
    private fun heart(pen: IconPen) {
        pen.moveTo(12f, 20.4f)
        pen.cubicTo(5.2f, 15.6f, 2.6f, 12.2f, 2.6f, 8.7f); pen.cubicTo(2.6f, 5.7f, 4.9f, 3.6f, 7.6f, 3.6f)
        pen.cubicTo(9.5f, 3.6f, 11f, 4.7f, 12f, 6.3f); pen.cubicTo(13f, 4.7f, 14.5f, 3.6f, 16.4f, 3.6f)
        pen.cubicTo(19.1f, 3.6f, 21.4f, 5.7f, 21.4f, 8.7f); pen.cubicTo(21.4f, 12.2f, 18.8f, 15.6f, 12f, 20.4f); pen.close()
    }
    private fun star(pen: IconPen, x: Float, y: Float, r: Float) {
        pen.begin(); pen.moveTo(x, y - r)
        pen.quadTo(x + r * .16f, y - r * .16f, x + r, y); pen.quadTo(x + r * .16f, y + r * .16f, x, y + r)
        pen.quadTo(x - r * .16f, y + r * .16f, x - r, y); pen.quadTo(x - r * .16f, y - r * .16f, x, y - r); pen.close()
    }
    private fun outCubic(u: Float) = 1f - (1f - u) * (1f - u) * (1f - u)
    private fun outBack(u: Float): Float { val c = 1.7f; val v = u - 1f; return 1f + (c + 1f) * v * v * v + c * v * v }
}
