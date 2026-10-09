package expo.modules.androidshell

import org.junit.Assert.*
import org.junit.Test

class NavigationStateTest {
    private fun route(path: String) = requireNotNull(Destination.parse(path))
    private fun NavigationState.go(path: String, mode: String = "push") = navigate(route(path), mode)

    @Test fun allMigratedScreensResolve() {
        val routes = listOf("/", "/library", "/tidal", "/playlists", "/settings", "/artist/local", "/album/local",
            "/playlist/local", "/playlist-create", "/tidal-artist/123", "/tidal-album/456", "/tidal-playlist/uuid",
            "/tidal-genre/rock", "/equalizer", "/onboarding", "/lyrics", "/player", "/modal")
        routes.forEach { path -> assertNotNull(path, Destination.parse(path)) }
    }
    @Test fun existingDeepLinkFormsResolveToTheSameDestination() {
        val expected = route("/tidal-album/123?name=Blue&source=qobuz")
        listOf("staysound://tidal-album/123?name=Blue&source=qobuz", "staysound:///tidal-album/123?name=Blue&source=qobuz",
            "exp+staysound://tidal-album/123?name=Blue&source=qobuz", "exp://localhost:8081/--/tidal-album/123?name=Blue&source=qobuz")
            .forEach { assertEquals(it, expected, route(it)) }
    }
    @Test fun groupedTabsAndSearchAliasAreAccepted() {
        assertEquals("/library", route("staysound://(tabs)/library").path)
        assertEquals("/", route("/(tabs)").path)
        assertEquals("/", route("/index").path)
        assertEquals("/tidal", route("/search").path)
    }
    @Test fun notificationLinkOpensPlayer() {
        assertEquals("/player", route("staysound://notification.click").path)
        val state = NavigationState(); state.go("/notification.click")
        assertEquals("/player", state.current.destination.path)
        assertTrue(state.back()); assertEquals("/", state.current.destination.path)
    }
    @Test fun argumentsAreDecodedExactlyOnceAndPathIdentityWins() {
        val value = route("/album/Bj%C3%B6rk%2F%252F%2B?id=wrong&name=Post+Live&source=qobuz&extra=a%26b%3Dc")
        assertEquals("Björk/%2F+", value.arguments["id"])
        assertEquals("Post Live", value.arguments["name"])
        assertEquals("a&b=c", value.arguments["extra"])
        assertEquals(value, NavigationState.restore(NavigationState().apply { navigate(value) }.snapshot()).current.destination)
    }
    @Test fun malformedOrUnrelatedLinksAreRejected() {
        listOf("https://example.org/album/1", "javascript:alert(1)", "/album", "/album/", "/album/1/extra", "/bogus", "/album/%ZZ",
            "exp+staysound://expo-development-client?url=http://localhost:8081").forEach { assertNull(it, Destination.parse(it)) }
    }
    @Test fun backAtRootIsNotConsumed() { assertFalse(NavigationState().back()) }
    @Test fun detailBackRetainsActiveTabAndRootKey() {
        val state = NavigationState(); state.go("/library?sort=artist")
        val root = state.current
        state.go("/artist/a"); state.go("/album/b")
        assertEquals("/library", state.activeTab)
        assertTrue(state.back()); assertEquals("a", state.current.destination.arguments["id"])
        assertTrue(state.back()); assertEquals(root, state.current)
        assertEquals("artist", state.current.destination.arguments["sort"])
    }
    @Test fun tabHistoryIsUniqueAndBackReturnsToPreviousTab() {
        val state = NavigationState(); state.go("/library"); state.go("/tidal"); state.go("/library")
        assertTrue(state.back()); assertEquals("/tidal", state.activeTab)
        assertTrue(state.back()); assertEquals("/", state.activeTab)
        assertFalse(state.back())
    }
    @Test fun selectingATabFromTheBarRetainsItsDeepLinkArguments() {
        val state = NavigationState(); state.go("/library?sort=artist"); val library = state.current
        state.go("/tidal"); state.go("/library", "navigate")
        assertEquals(library, state.current)
    }
    @Test fun switchingTabsClosesDetailsAndRetainsOtherRoots() {
        val state = NavigationState(); state.go("/library"); val library = state.current
        state.go("/album/a"); state.go("/tidal"); state.go("/library")
        assertEquals(library, state.current)
        assertFalse(state.entries.any { it.destination.path == "/album/[id]" })
    }
    @Test fun replaceDoesNotLeaveCreateScreenBehind() {
        val state = NavigationState(); state.go("/playlists"); state.go("/playlist-create")
        state.go("/playlist/new", "replace")
        assertTrue(state.back()); assertEquals("/playlists", state.current.destination.path)
    }
    @Test fun navigateReusesAnExistingEntryButDifferentArgumentsAreDistinct() {
        val state = NavigationState(); state.go("/tidal-album/1?source=tidal"); val original = state.current
        state.go("/tidal-album/1?source=qobuz"); assertNotEquals(original.key, state.current.key)
        state.navigate(original.destination, "navigate"); assertEquals(original, state.current)
        assertTrue(state.back()); assertEquals("/", state.current.destination.path)
    }
    @Test fun repeatedSameDestinationIsIdempotent() {
        val state = NavigationState(); state.go("/album/1"); val snapshot = state.snapshot()
        state.go("/album/1"); assertEquals(snapshot, state.snapshot())
    }
    @Test fun playerIsAStackEntryAndKeepsItsUnderlyingScreen() {
        val state = NavigationState(); state.go("/album/1"); val underlying = state.current
        state.player(true); state.player(true)
        assertEquals("/player", state.current.destination.path); assertEquals(underlying.key, state.contentKey)
        state.player(false); assertEquals(underlying, state.current)
        state.player(false); assertEquals(underlying, state.current)
    }
    @Test fun lyricsBackReturnsToPlayerThenItsOrigin() {
        val state = NavigationState(); state.go("/library"); state.player(true); state.go("/lyrics")
        assertTrue(state.back()); assertEquals("/player", state.current.destination.path)
        assertTrue(state.back()); assertEquals("/library", state.current.destination.path)
    }
    @Test fun requiredOnboardingBlocksBackAndPreservesColdAndWarmLinks() {
        val state = NavigationState(); state.go("staysound://album/cold"); state.setOnboarding(true)
        assertFalse(state.back()); state.go("staysound://tidal-artist/warm?name=Bj%C3%B6rk")
        assertEquals("/onboarding", state.current.destination.path)
        state.setOnboarding(false)
        assertEquals("warm", state.current.destination.arguments["id"])
        assertEquals("Björk", state.current.destination.arguments["name"])
        assertTrue(state.back()); assertEquals("cold", state.current.destination.arguments["id"])
    }
    @Test fun obsoleteOnboardingCompletionCannotErasePendingLink() {
        val state = NavigationState(); state.setOnboarding(true); state.go("/album/pending")
        state.go("/", "replace"); state.setOnboarding(false)
        assertEquals("pending", state.current.destination.arguments["id"])
    }
    @Test fun processRestorationRetainsKeysArgumentsTabHistoryAndBackOrder() {
        val before = NavigationState(); before.go("/library"); before.go("/tidal?query=test")
        before.go("/tidal-album/123?source=qobuz&name=Blue"); before.player(true)
        val after = NavigationState.restore(before.snapshot())
        assertEquals(before.snapshot(), after.snapshot())
        while (before.canGoBack) {
            assertEquals(before.current, after.current); assertEquals(before.activeTab, after.activeTab)
            assertEquals(before.back(), after.back())
        }
        assertFalse(after.canGoBack)
    }
    @Test fun processRestorationKeepsOnboardingGateAndPendingDestination() {
        val state = NavigationState(); state.go("/tidal-genre/jazz?name=Jazz"); state.setOnboarding(true)
        val restored = NavigationState.restore(state.snapshot())
        assertEquals(state.snapshot(), restored.snapshot()); assertFalse(restored.back())
        restored.setOnboarding(false); assertEquals("jazz", restored.current.destination.arguments["id"])
    }
    @Test fun restoredNewEntriesGetFreshKeys() {
        val state = NavigationState(); state.go("/album/1")
        val restored = NavigationState.restore(state.snapshot()); val oldKeys = restored.entries.map { it.key }
        restored.go("/album/2"); assertFalse(restored.current.key in oldKeys)
    }
    @Test fun corruptOrUnsupportedSavedStateFallsBackToHome() {
        listOf(null, "bad json", "{}", "{\"version\":999}", NavigationState().snapshot().replace("route-1", "").replace("\"history\":[\"/\"]", "\"history\":[]"))
            .forEach { assertEquals("/", NavigationState.restore(it).current.destination.path) }
    }
}
