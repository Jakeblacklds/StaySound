package expo.modules.androidshell

import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback

/** A cancelled or obsolete predictive gesture must never mutate the route stack. */
class NavigationBackCallback(
    private val state: () -> NavigationState?,
    private val consumePanel: () -> Boolean,
    private val changed: () -> Unit,
    private val preview: (String?) -> Unit,
    private val progress: (BackEventCompat) -> Unit,
) : OnBackPressedCallback(false) {
    private var startedAt: String? = null
    private var showingPreview = false
    private fun clear() { startedAt = null; showingPreview = false; preview(null) }
    override fun handleOnBackStarted(backEvent: BackEventCompat) {
        val current = state() ?: return
        startedAt = current.current.key
        if (current.current.destination.path == "/player") return
        val previous = NavigationState.restore(current.snapshot())
        if (previous.back()) { showingPreview = true; preview(previous.contentKey) }
    }
    override fun handleOnBackProgressed(backEvent: BackEventCompat) {
        if (showingPreview && startedAt == state()?.current?.key) progress(backEvent)
    }
    override fun handleOnBackCancelled() = clear()
    override fun handleOnBackPressed() {
        val obsolete = startedAt != null && startedAt != state()?.current?.key
        clear()
        if (obsolete || consumePanel()) return
        state()?.back()
        changed()
    }
}
