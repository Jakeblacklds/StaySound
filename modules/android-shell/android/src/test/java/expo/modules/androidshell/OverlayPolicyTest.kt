package expo.modules.androidshell

import org.junit.Assert.*
import org.junit.Test

class OverlayPolicyTest {
    private val confirmation = Overlay("confirmation", "1")
    private val sheet = Overlay("sheet", "1", 2)
    private val first = Overlay("notification", "1")
    private val second = Overlay("notification", "2")
    @Test fun notificationsFollowSnapshotFifo() {
        val policy = OverlayPolicy()
        policy.update(null, null, listOf(first, second))
        assertEquals(first, policy.notification())
        assertNotNull(policy.action(first, "dismiss"))
        assertTrue(policy.pending(first))
        // Native never advances a second queue ahead of TS acknowledgement.
        assertEquals(first, policy.notification())
        policy.update(null, null, listOf(second))
        assertEquals(second, policy.notification())
    }
    @Test fun notificationDismissIsExactlyOnce() {
        val policy = OverlayPolicy()
        policy.update(null, null, listOf(first, second))
        assertNotNull(policy.action(first, "dismiss"))
        assertNull(policy.action(first, "dismiss"))
        assertNull(policy.action(second, "dismiss"))
    }
    @Test fun identicalMessageInstancesCanBothDisplay() {
        val policy = OverlayPolicy()
        policy.update(null, null, listOf(first, first, second))
        assertEquals(first, policy.notification())
        policy.action(first, "dismiss")
        policy.update(null, null, listOf(second))
        assertNotNull(policy.action(second, "dismiss"))
    }
    @Test fun confirmationPreemptsSheetAndPausesNotifications() {
        val policy = OverlayPolicy()
        policy.update(confirmation, sheet, listOf(first))
        assertEquals(confirmation, policy.dialog())
        assertNull(policy.notification())
        assertNull(policy.action(sheet, "select", 0))
        assertNull(policy.action(first, "dismiss"))
        policy.update(null, sheet, listOf(first))
        assertEquals(sheet, policy.dialog())
        assertNull(policy.notification())
        policy.update(null, null, listOf(first))
        assertEquals(first, policy.notification())
    }
    @Test fun backDismissesOnlyTopDialogAndNeverConfirms() {
        val policy = OverlayPolicy()
        policy.update(confirmation, sheet, emptyList())
        assertEquals(ShellAction("confirmation", "1", "dismiss"), policy.back())
        assertNull(policy.back())
        policy.update(null, sheet, emptyList())
        assertEquals(ShellAction("sheet", "1", "dismiss"), policy.back())
        policy.update(null, null, listOf(first))
        assertNull(policy.back()) // Snackbars do not trap route Back.
    }
    @Test fun confirmActionDeliveredOnce() {
        val policy = OverlayPolicy()
        policy.update(confirmation, null, emptyList())
        assertEquals(ShellAction("confirmation", "1", "confirm"), policy.action(confirmation, "confirm"))
        assertNull(policy.action(confirmation, "confirm"))
        assertNull(policy.back())
    }
    @Test fun staleConfirmationCannotConfirmReplacement() {
        val policy = OverlayPolicy()
        val replacement = confirmation.copy(id = "2")
        policy.update(replacement, null, emptyList())
        assertNull(policy.action(confirmation, "confirm"))
        assertNotNull(policy.action(replacement, "confirm"))
    }
    @Test fun sheetSelectionValidatesBoundsAndCannotConfirm() {
        val policy = OverlayPolicy()
        policy.update(null, sheet, emptyList())
        assertNull(policy.action(sheet, "select", -1))
        assertNull(policy.action(sheet, "select", 2))
        assertNull(policy.action(sheet, "confirm"))
        assertEquals(ShellAction("sheet", "1", "select", 1), policy.action(sheet, "select", 1))
        assertNull(policy.action(sheet, "select", 0))
    }
    @Test fun unchangedSnapshotDoesNotResetDeliveryLatch() {
        val policy = OverlayPolicy()
        policy.update(confirmation, null, emptyList())
        policy.back()
        policy.update(confirmation, null, listOf(first))
        assertNull(policy.action(confirmation, "confirm"))
    }
    @Test fun externalRemovalDropsOldNotificationCallback() {
        val policy = OverlayPolicy()
        policy.update(null, null, listOf(first))
        policy.update(null, null, listOf(second))
        assertNull(policy.action(first, "dismiss"))
        assertNotNull(policy.action(second, "dismiss"))
    }
    @Test fun cancellationFromReplacedDialogCannotCloseCurrentDialog() {
        val policy = OverlayPolicy()
        policy.update(confirmation, sheet, emptyList())
        assertNull(policy.back(sheet))
        assertEquals(ShellAction("confirmation", "1", "dismiss"), policy.back(confirmation))
    }
    @Test fun preemptionDoesNotTrapSheetWithAnUnacknowledgedTap() {
        val policy = OverlayPolicy()
        policy.update(null, sheet, emptyList())
        assertNotNull(policy.action(sheet, "select", 0))
        // TS opened a newer confirmation and rejected the sheet event in transit.
        policy.update(confirmation, sheet, emptyList())
        policy.update(null, sheet, emptyList())
        assertFalse(policy.pending(sheet))
        assertNotNull(policy.back())
    }
    @Test fun emptyShellLetsBackReachRouter() {
        val policy = OverlayPolicy()
        assertNull(policy.dialog()); assertNull(policy.notification()); assertNull(policy.back())
    }
}
