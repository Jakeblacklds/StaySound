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

    private var manualScrollTimeoutNanos: Long = 0L
    private var touchStartX = 0f
    private var touchStartY = 0f
    private var lastTouchY = 0f
    private var velocityTracker: VelocityTracker? = null
    private var scrollVelocity = 0f
    private var isTap = true
    private var seekOnTapEnabled = false

    private val manualScrollTimeoutNs = 3_000_000_000L
    private val tapSlopPx: Float

    constructor(density: Float) {
        tapSlopPx = 10f * density
    }

    fun setSeekOnTapEnabled(enabled: Boolean) {
        seekOnTapEnabled = enabled
    }

    fun onFrame(nowNanos: Long) {
        if (isManualScrolling && nowNanos > manualScrollTimeoutNanos) {
            isManualScrolling = false
            scrollVelocity = 0f
        }

        if (!isManualScrolling && scrollVelocity != 0f) {
            // Reserved for fling behavior after finger lift.
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
                if (seekOnTapEnabled && isTap && event.actionMasked == MotionEvent.ACTION_UP) {
                    handleTap(
                        x = event.x,
                        y = event.y,
                        lines = lines,
                        layout = layout,
                        onSeek = onSeek,
                    )
                } else {
                    isManualScrolling = true
                    manualScrollTimeoutNanos = System.nanoTime() + manualScrollTimeoutNs
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
