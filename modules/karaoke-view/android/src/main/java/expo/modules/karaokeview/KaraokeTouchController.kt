package expo.modules.karaokeview

import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewParent
import kotlin.math.abs

internal data class KaraokeTouchLayout(
    val marginLeft: Float,
    val lineHeight: Float,
    val backgroundLineHeight: Float,
    val density: Float,
)

internal class KaraokeTouchController {
    var scrollY: Float = 0f
    var targetScrollY: Float = 0f
    var isManualScrolling: Boolean = false
        private set
    // True between ACTION_DOWN and ACTION_UP/CANCEL — i.e. the finger is physically
    // on the glass. While this holds, manual scrolling must NEVER time out, otherwise
    // auto-scroll re-targets the active line and the damping spring fights the finger.
    var isTouching: Boolean = false
        private set

    private var manualScrollTimeoutNanos: Long = 0L
    private var touchStartX = 0f
    private var touchStartY = 0f
    private var lastTouchY = 0f
    private var velocityTracker: VelocityTracker? = null
    private var scrollVelocity = 0f
    private var isTap = true
    private var seekOnTapEnabled = false

    // Fling physics — softer decay + higher cap so a flick coasts freely instead of
    // braking almost immediately (the old 0.88 decay made the list feel "stuck").
    private val flingDecay = 0.94f           // velocity multiplied each frame (~60fps target)
    private val flingMinSpeed = 0.4f         // px/frame below which fling stops
    private val flingMaxSpeed = 70f          // px/frame cap to avoid over-shoot

    // Longer browse window before auto-scroll snaps back to the active line — gives the
    // user room to read ahead/behind without the view yanking itself away.
    private val manualScrollTimeoutNs = 5_000_000_000L
    private val tapSlopPx: Float

    constructor(density: Float) {
        tapSlopPx = 10f * density
    }

    fun setSeekOnTapEnabled(enabled: Boolean) {
        seekOnTapEnabled = enabled
    }

    fun onFrame(nowNanos: Long) {
        // Only allow the browse window to expire once the finger is lifted. While the
        // finger is down the timeout must not fire, or the spring fights the drag.
        if (!isTouching && isManualScrolling && nowNanos > manualScrollTimeoutNanos) {
            isManualScrolling = false
            // Don't clear velocity here — let the fling coast after timeout
        }

        // Apply fling momentum when not actively touching
        if (!isManualScrolling && abs(scrollVelocity) > flingMinSpeed) {
            scrollY += scrollVelocity
            targetScrollY = scrollY
            scrollVelocity *= flingDecay
            if (abs(scrollVelocity) < flingMinSpeed) scrollVelocity = 0f
        }
    }

    fun dispatchTouchEvent(event: MotionEvent, parent: ViewParent?) {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            parent?.requestDisallowInterceptTouchEvent(true)
        }
    }

    fun onTouchEvent(
        event: MotionEvent,
        parent: ViewParent?,
        lines: List<LyricLine>,
        layout: KaraokeTouchLayout,
        invalidate: () -> Unit,
        onSeek: (Long) -> Unit,
    ): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchStartX = event.x
                touchStartY = event.y
                lastTouchY = event.y
                isTap = true
                isTouching = true
                scrollVelocity = 0f

                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain()
                velocityTracker?.addMovement(event)

                parent?.requestDisallowInterceptTouchEvent(true)
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)
                val dx = abs(event.x - touchStartX)
                val dy = abs(event.y - touchStartY)

                if (dx > tapSlopPx || dy > tapSlopPx) {
                    isTap = false
                }

                if (!isTap) {
                    isManualScrolling = true
                    val deltaY = event.y - lastTouchY
                    scrollY += deltaY
                    targetScrollY = scrollY
                    lastTouchY = event.y
                    invalidate()
                }
                return true
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val wasDrag = !isTap
                isTouching = false

                if (seekOnTapEnabled && isTap && event.actionMasked == MotionEvent.ACTION_UP) {
                    // Tap-to-seek: reset manual scroll so auto-scroll resumes
                    handleTap(
                        x = event.x,
                        y = event.y,
                        lines = lines,
                        layout = layout,
                        onSeek = onSeek,
                    )
                    scrollVelocity = 0f
                } else if (wasDrag) {
                    // Manual drag ended — compute fling velocity and set timeout
                    velocityTracker?.computeCurrentVelocity(16) // units per frame @60fps
                    val vy = velocityTracker?.yVelocity ?: 0f
                    scrollVelocity = vy.coerceIn(-flingMaxSpeed, flingMaxSpeed)
                    isManualScrolling = true
                    manualScrollTimeoutNanos = System.nanoTime() + manualScrollTimeoutNs
                } else {
                    // No-op tap with seekOnTap disabled — keep auto-scroll active
                    scrollVelocity = 0f
                }

                velocityTracker?.recycle()
                velocityTracker = null
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
        }

        return false
    }

    private fun handleTap(
        x: Float,
        y: Float,
        lines: List<LyricLine>,
        layout: KaraokeTouchLayout,
        onSeek: (Long) -> Unit,
    ) {
        val contentY = y - scrollY

        for (line in lines) {
            val lineTop = line.y
            val lineBottom = line.y + line.totalHeight
            if (contentY < lineTop || contentY > lineBottom) continue

            var bestWord: LyricWord? = null
            var bestDistance = Float.MAX_VALUE

            fun evaluateWords(words: List<LyricWord>) {
                for (word in words) {
                    val rowHeight = if (word.isBackground) layout.backgroundLineHeight else layout.lineHeight
                    val left = layout.marginLeft + word.xOffset
                    val right = left + word.width
                    val top = line.y + word.yOffset
                    val bottom = top + rowHeight
                    if (contentY < top - rowHeight * 0.35f || contentY > bottom + rowHeight * 0.35f) continue

                    val dx = when {
                        x < left -> left - x
                        x > right -> x - right
                        else -> 0f
                    }
                    val dy = when {
                        contentY < top -> top - contentY
                        contentY > bottom -> contentY - bottom
                        else -> 0f
                    }
                    val distance = dx + dy * 0.9f
                    if (distance < bestDistance) {
                        bestDistance = distance
                        bestWord = word
                    }
                }
            }

            evaluateWords(line.words)
            evaluateWords(line.backgroundWords)

            val targetTime = if (bestWord != null && bestDistance <= 46f * layout.density) {
                bestWord!!.startMs
            } else {
                line.startMs
            }
            onSeek(targetTime)
            return
        }
    }
}
