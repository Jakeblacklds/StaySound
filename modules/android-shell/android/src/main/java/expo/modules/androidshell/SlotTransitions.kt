package expo.modules.androidshell

import android.view.View
import android.view.animation.PathInterpolator

/**
 * Material motion between route slots: shared axis X for push/pop, fade through between tabs.
 * The outgoing slot stays drawn (even after React removes it) until its exit finishes, and a
 * committed predictive-Back gesture is continued from wherever the finger left the page.
 */
internal class SlotTransitions(private val host: NavigationHostView) {
    var shownKey: String? = null
        private set
    private var shownDepth = 0
    private var shownTab: String? = null
    private var exiting: NavigationSlotView? = null
    private var exitingOnTop = false
    /** The page a Back gesture revealed; a commit arrives in the same frame the preview clears. */
    var revealed: String? = null

    fun isAnimating(key: String) = exiting?.entryKey == key
    fun elevation(key: String, active: Boolean) = when {
        isAnimating(key) -> if (exitingOnTop) 2f else 0f
        active -> 1f
        else -> 0f
    }

    /** [tab] is the active tab: changing it is a lateral move even when details were open. */
    fun settle(key: String, depth: Int, tab: String, animate: Boolean) {
        if (key == shownKey) return
        val fromDepth = shownDepth
        val lateral = shownTab != null && shownTab != tab
        val outgoing = host.slot(shownKey)
        shownKey = key; shownDepth = depth; shownTab = tab
        val incoming = host.slot(key) ?: return
        // Already on screen: it was the page revealed behind a predictive Back gesture.
        val previewed = key == revealed
        revealed = null
        finishExit()
        if (!animate || outgoing == null || outgoing === incoming) { reset(incoming); return }
        val width = host.width.toFloat().takeIf { it > 0f } ?: host.resources.displayMetrics.widthPixels.toFloat()
        exiting = outgoing
        host.content.startViewTransition(outgoing)
        when {
            !lateral && shownDepth > fromDepth -> {
                // Push: the new page glides in over the old one, which drifts back a little.
                exitingOnTop = false
                incoming.animate().cancel()
                incoming.alpha = 0f; incoming.translationX = width * .1f; incoming.scaleX = 1f; incoming.scaleY = 1f
                incoming.animate().alpha(1f).translationX(0f).setDuration(340).setStartDelay(0)
                    .setInterpolator(DECELERATE).withLayer().start()
                outgoing.animate().translationX(-width * .08f).setDuration(340).setStartDelay(0)
                    .setInterpolator(DECELERATE).withEndAction { endExit(outgoing) }.start()
            }
            !lateral && shownDepth < fromDepth -> {
                // Pop: the top page leaves on top, continuing a Back gesture in its own direction.
                exitingOnTop = true
                val side = if (outgoing.translationX < 0f) -1f else 1f
                outgoing.animate().alpha(0f).translationX(side * width * .16f).setDuration(if (previewed) 200 else 240)
                    .setStartDelay(0).setInterpolator(ACCELERATE).withLayer().withEndAction { endExit(outgoing) }.start()
                incoming.animate().cancel()
                incoming.alpha = 1f; incoming.scaleX = 1f; incoming.scaleY = 1f
                if (!previewed) incoming.translationX = -width * .08f
                incoming.animate().translationX(0f).setDuration(320).setStartDelay(0).setInterpolator(DECELERATE).start()
            }
            else -> {
                // Tabs: fade through — out quickly, then the destination settles up from 96%.
                exitingOnTop = false
                outgoing.animate().alpha(0f).setDuration(90).setStartDelay(0).setInterpolator(ACCELERATE)
                    .withLayer().withEndAction { endExit(outgoing) }.start()
                incoming.animate().cancel()
                incoming.translationX = 0f; incoming.alpha = 0f; incoming.scaleX = .96f; incoming.scaleY = .96f
                incoming.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(90).setDuration(230)
                    .setInterpolator(DECELERATE).withLayer().start()
            }
        }
    }

    /** A cancelled Back gesture eases the page back into place instead of snapping. */
    fun restore(slot: View, animate: Boolean) {
        if (!animate) { reset(slot); return }
        slot.animate().translationX(0f).scaleX(1f).scaleY(1f).alpha(1f).setStartDelay(0)
            .setDuration(220).setInterpolator(DECELERATE).start()
    }

    fun finish() {
        finishExit()
        host.slot(shownKey)?.let { reset(it) }
    }

    private fun finishExit() { exiting?.let { it.animate().cancel(); endExit(it) } }
    private fun endExit(slot: NavigationSlotView) {
        if (exiting !== slot) return
        exiting = null
        host.updateVisibility()
        reset(slot)
        host.content.endViewTransition(slot)
    }
    private fun reset(view: View) {
        view.animate().setListener(null).cancel()
        view.alpha = 1f; view.translationX = 0f; view.scaleX = 1f; view.scaleY = 1f
    }

    private companion object {
        val DECELERATE = PathInterpolator(0.05f, 0.7f, 0.1f, 1f)
        val ACCELERATE = PathInterpolator(0.3f, 0f, 0.8f, 0.15f)
    }
}
