package expo.modules.androidshell

import androidx.activity.BackEventCompat
import org.junit.Assert.*
import org.junit.Test

class NavigationBackTest {
    private val state = NavigationState()
    private var preview: String? = null
    private var progress = 0f
    private var changes = 0
    private var panel = false
    private val callback = NavigationBackCallback({ state }, { panel.also { panel = false } }, { changes++ },
        { preview = it; if (it == null) progress = 0f }, { progress = it.progress })
    private fun go(path: String) = state.navigate(requireNotNull(Destination.parse(path)))
    private fun gesture(value: Float) = BackEventCompat(0f, 0f, value, BackEventCompat.EDGE_LEFT)

    @Test fun cancelledPredictiveBackPreservesEveryRouteAndArgument() {
        go("/tidal"); go("/tidal-album/1?source=qobuz&name=Blue")
        val before = state.snapshot()
        callback.handleOnBackStarted(gesture(0f)); callback.handleOnBackProgressed(gesture(.65f))
        assertNotNull(preview); assertEquals(.65f, progress); assertEquals(before, state.snapshot())
        callback.handleOnBackCancelled()
        assertNull(preview); assertEquals(0f, progress); assertEquals(before, state.snapshot()); assertEquals(0, changes)
    }
    @Test fun committedPredictiveBackPopsExactlyOnce() {
        go("/library"); val root = state.current; go("/album/1")
        callback.handleOnBackStarted(gesture(0f)); callback.handleOnBackProgressed(gesture(.8f))
        assertEquals(root.key, preview)
        callback.handleOnBackPressed()
        assertEquals(root, state.current); assertNull(preview); assertEquals(1, changes)
    }
    @Test fun hardwareAndToolbarBackUseTheSamePopOrder() {
        go("/library"); go("/artist/a"); go("/album/b")
        callback.handleOnBackPressed(); assertEquals("a", state.current.destination.arguments["id"])
        callback.handleOnBackPressed(); assertEquals("/library", state.current.destination.path)
    }
    @Test fun playerPanelConsumesBackBeforeThePlayerRoute() {
        state.player(true); panel = true
        callback.handleOnBackStarted(gesture(0f)); assertNull(preview)
        callback.handleOnBackPressed(); assertEquals("/player", state.current.destination.path)
        callback.handleOnBackPressed(); assertEquals("/", state.current.destination.path)
    }
    @Test fun incomingLinkDuringGestureCannotPopTheNewDestination() {
        go("/album/1"); callback.handleOnBackStarted(gesture(0f))
        go("staysound://tidal-artist/2?name=New")
        callback.handleOnBackPressed()
        assertEquals("2", state.current.destination.arguments["id"]); assertEquals(0, changes)
    }
    @Test fun onboardingBackDoesNotEscapeTheGate() {
        state.setOnboarding(true); callback.handleOnBackStarted(gesture(0f)); callback.handleOnBackPressed()
        assertNull(preview); assertEquals("/onboarding", state.current.destination.path)
    }
}
