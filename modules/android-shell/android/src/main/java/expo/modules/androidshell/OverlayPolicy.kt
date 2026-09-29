package expo.modules.androidshell

/** Render projection only: the owning TS stores retain all data and callbacks. */
data class Overlay(val kind: String, val id: String, val actionCount: Int = 0)
data class ShellAction(val kind: String, val id: String, val action: String, val index: Int = -1)
class OverlayPolicy {
    private var confirmation: Overlay? = null
    private var sheet: Overlay? = null
    private var notifications = emptyList<Overlay>()
    // Delivery latches, not a second queue. Await acknowledgement from the next TS snapshot.
    private val delivered = mutableSetOf<Pair<String, String>>()

    fun update(confirmation: Overlay?, sheet: Overlay?, notifications: List<Overlay>) {
        this.confirmation = confirmation
        this.sheet = sheet
        this.notifications = notifications.distinctBy { it.id }
        val live = (listOfNotNull(confirmation, sheet) + notifications).map { it.kind to it.id }.toSet()
        delivered.retainAll(live)
        // A newer confirmation can reject a sheet tap in TS before the event arrives.
        // Preemption ends that presentation, so its delivery latch must not trap it later.
        if (confirmation != null && sheet != null) delivered.remove(sheet.kind to sheet.id)
    }
    fun dialog(): Overlay? = confirmation ?: sheet
    fun notification(): Overlay? = if (dialog() == null) notifications.firstOrNull() else null
    fun pending(item: Overlay) = (item.kind to item.id) in delivered
    fun back(expected: Overlay? = dialog()): ShellAction? = expected?.let { action(it, "dismiss") }
    fun action(item: Overlay, action: String, index: Int = -1): ShellAction? {
        val current = if (item.kind == "notification") notification() else dialog()
        if (current != item || pending(item)) return null
        val valid = when (action) {
            "dismiss" -> true
            "confirm" -> item.kind == "confirmation"
            "select" -> item.kind == "sheet" && index in 0 until item.actionCount
            else -> false
        }
        if (!valid) return null
        delivered.add(item.kind to item.id)
        return ShellAction(item.kind, item.id, action, index)
    }
}
