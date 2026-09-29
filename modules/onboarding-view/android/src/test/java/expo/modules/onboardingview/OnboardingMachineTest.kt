package expo.modules.onboardingview

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OnboardingMachineTest {
    private fun artist(id: Int) = Artist(id.toLong(), "Artist $id", "https://example.com/$id.jpg")
    private fun taste() = OnboardingMachine().apply { advance(); advance(true) }
    private fun ready(count: Int = 0) = taste().apply {
        repeat(count) { toggle(artist(it + 1)) }; advance(true); advance(); drainEffects()
    }
    private fun response(effect: Effect, sequence: Long = 1, data: JSONObject = JSONObject()) =
        JSONObject().put("action", effect.action).put("id", effect.id).put("sequence", sequence).put("data", data)

    @Test fun `fresh launch starts at welcome and only hydrates saved artists`() {
        val machine = OnboardingMachine()
        machine.restore(JSONObject().put("artists", JSONArray(listOf(artist(1).json()))).toString())
        assertEquals(OnboardingMachine.Step.welcome, machine.step)
        assertEquals("", machine.name); assertEquals("", machine.avatarUri); assertEquals(1, machine.artists.size)
    }
    @Test fun `normal order includes library permission before ready`() {
        val machine = OnboardingMachine()
        machine.advance(); assertEquals(OnboardingMachine.Step.profile, machine.step)
        machine.name = "  Jacob  "; machine.advance()
        assertEquals(OnboardingMachine.Step.tasteArtists, machine.step)
        repeat(3) { machine.toggle(artist(it)) }; machine.advance()
        assertEquals(OnboardingMachine.Step.permissions, machine.step)
        assertTrue(machine.drainEffects().any { it.action == "checkPermission" })
        machine.advance(); assertEquals(OnboardingMachine.Step.ready, machine.step)
    }
    @Test fun `empty and whitespace name block continue but allow skip`() {
        val machine = OnboardingMachine(); machine.advance()
        listOf("", " \n\t", "\u00A0", "\uFEFF").forEach {
            machine.name = it; assertFalse(machine.canContinue); machine.advance()
            assertEquals(OnboardingMachine.Step.profile, machine.step)
        }
        machine.advance(true); assertEquals(OnboardingMachine.Step.tasteArtists, machine.step)
    }
    @Test fun `minimum is three maximum is eight and removal remains possible at cap`() {
        val machine = taste()
        repeat(2) { machine.toggle(artist(it)) }; machine.advance()
        assertEquals(OnboardingMachine.Step.tasteArtists, machine.step); assertFalse(machine.canContinue)
        machine.toggle(artist(2)); assertTrue(machine.canContinue)
        (3..12).forEach { machine.toggle(artist(it)) }; assertEquals(8, machine.artists.size)
        machine.toggle(artist(3)); assertEquals(7, machine.artists.size)
        machine.toggle(artist(50)); assertEquals(8, machine.artists.size)
    }
    @Test fun `skipping artists preserves partial selection`() {
        val machine = taste(); machine.toggle(artist(1)); machine.advance(true)
        assertEquals(OnboardingMachine.Step.permissions, machine.step); assertEquals(1, machine.artists.size)
        machine.advance(); machine.finish()
        assertEquals(OnboardingMachine.Step.ready, machine.step)
        assertEquals(1, machine.drainEffects().last().payload.getJSONArray("artists").length())
    }
    @Test fun `permission denied or scanner error never gates advancement`() {
        val machine = taste(); machine.advance(true); machine.requestPermission()
        val request = machine.drainEffects().last()
        machine.reply(response(request, data = JSONObject().put("granted", false)))
        assertFalse(machine.granted); assertTrue(machine.canContinue)
        machine.reply(response(request, 2, JSONObject().put("success", false)))
        machine.advance(); assertEquals(OnboardingMachine.Step.ready, machine.step)
    }
    @Test fun `scan failure preserves already granted access`() {
        val machine = taste(); machine.advance(true); machine.requestPermission()
        val request = machine.drainEffects().last()
        machine.reply(response(request, data = JSONObject().put("granted", true)))
        machine.reply(response(request, 2, JSONObject().put("success", false)))
        assertTrue(machine.granted)
    }
    @Test fun `search uses trimmed query and ignores late responses`() {
        val machine = taste(); machine.drainEffects()
        machine.setQuery("  ab  "); machine.searchNow(); val old = machine.drainEffects().single()
        assertEquals("ab", old.payload.getString("query"))
        machine.setQuery("cd"); machine.searchNow(); val current = machine.drainEffects().single()
        machine.reply(response(old, data = JSONObject().put("artists", JSONArray(listOf(artist(1).json())))))
        assertTrue(machine.search.isEmpty()); assertTrue(machine.artistLoading)
        machine.reply(response(current, 2, JSONObject().put("artists", JSONArray(listOf(artist(2).json())))))
        assertEquals(2L, machine.search.single().id); assertFalse(machine.artistLoading)
    }
    @Test fun `short query clears results and invalidates pending requests`() {
        val machine = taste(); machine.drainEffects(); machine.setQuery("aa"); machine.searchNow()
        val request = machine.drainEffects().single(); machine.setQuery("a"); machine.searchNow()
        machine.reply(response(request, data = JSONObject().put("error", "offline")))
        assertEquals("", machine.error); assertFalse(machine.searching); assertTrue(machine.drainEffects().isEmpty())
    }
    @Test fun `failed search can recover with another query`() {
        val machine = taste(); machine.drainEffects(); machine.setQuery("aa"); machine.searchNow()
        machine.reply(response(machine.drainEffects().single(), data = JSONObject().put("error", "offline")))
        assertEquals("offline", machine.error); assertFalse(machine.artistLoading)
        machine.setQuery("bb"); machine.searchNow(); assertEquals("", machine.error)
        machine.reply(response(machine.drainEffects().single(), 2, JSONObject().put("artists", JSONArray())))
        assertFalse(machine.artistLoading); assertEquals("", machine.error)
    }
    @Test fun `suggestions requested once and restored without duplicated requests`() {
        val machine = taste(); val request = machine.drainEffects().first { it.action == "quick" }
        machine.reply(response(request, data = JSONObject().put("artists", JSONArray(listOf(artist(1).json()))).put("loading", true)))
        machine.reply(response(request, 2, JSONObject().put("artists", JSONArray(listOf(artist(2).json()))).put("loading", false)))
        assertEquals(2L, machine.quick.single().id); assertFalse(machine.quickLoading)
        val restored = OnboardingMachine(); restored.restore(machine.snapshot()); restored.enter()
        assertTrue(restored.drainEffects().isEmpty()); assertEquals(machine.quick, restored.quick)
    }
    @Test fun `unknown seed respects cap and toggles resolved artist`() {
        val machine = taste(); machine.drainEffects()
        machine.toggle(Artist(null, "Seed")); val request = machine.drainEffects().single()
        machine.reply(response(request, data = JSONObject().put("artist", artist(1).json())))
        assertEquals(1, machine.artists.size)
        machine.toggle(Artist(null, "Seed")); val second = machine.drainEffects().single()
        machine.reply(response(second, 2, JSONObject().put("artist", artist(1).json())))
        assertTrue(machine.artists.isEmpty())
        repeat(8) { machine.toggle(artist(it)) }; machine.toggle(Artist(null, "Seed"))
        assertTrue(machine.drainEffects().isEmpty())
    }
    @Test fun `three artists finish through building and completion emits only once`() {
        val machine = ready(3); machine.finish(); machine.finish()
        assertEquals(OnboardingMachine.Step.building, machine.step); assertTrue(machine.finishing)
        val finish = machine.drainEffects().single(); assertEquals("finish", finish.action)
        machine.advance(); assertEquals(OnboardingMachine.Step.building, machine.step)
        val reply = response(finish, data = JSONObject().put("success", true))
        machine.reply(reply); machine.reply(reply); machine.reply(response(finish, 2, JSONObject().put("success", true)))
        assertTrue(machine.completed); assertFalse(machine.finishing)
        assertEquals(listOf("completed"), machine.drainEffects().map { it.action })
        machine.finish(); assertTrue(machine.drainEffects().isEmpty())
    }
    @Test fun `zero artists finish without building`() {
        val machine = ready(); machine.finish()
        assertEquals(OnboardingMachine.Step.ready, machine.step); assertFalse(machine.canContinue)
        machine.reply(response(machine.drainEffects().single(), data = JSONObject().put("success", true)))
        assertEquals("completed", machine.drainEffects().single().action)
    }
    @Test fun `playlist failure still permits completion as reported by adapter`() {
        val machine = ready(3); machine.finish()
        // Adapter catches playlist generation failure, persists failed, then reports successful finalization.
        machine.reply(response(machine.drainEffects().single(), data = JSONObject().put("success", true)))
        assertTrue(machine.completed); assertEquals("completed", machine.drainEffects().single().action)
    }
    @Test fun `unexpected finalization failure does not emit completed`() {
        val machine = ready(); machine.finish()
        machine.reply(response(machine.drainEffects().single(), data = JSONObject().put("success", false)))
        assertFalse(machine.completed); assertFalse(machine.finishing); assertTrue(machine.drainEffects().isEmpty())
        machine.finish(); assertEquals("finish", machine.drainEffects().single().action)
    }
    @Test fun `restores all ordinary steps and draft without writing persistent store`() {
        OnboardingMachine.Step.entries.filter { it != OnboardingMachine.Step.building }.forEach { step ->
            val machine = OnboardingMachine()
            machine.restore(JSONObject().put("step", step.name).put("name", "Jacob").put("avatarUri", "file:///photo.jpg")
                .put("artists", JSONArray(listOf(artist(1).json()))).put("query", "test").put("granted", true).toString())
            val restored = OnboardingMachine(); restored.restore(machine.snapshot())
            assertEquals(step, restored.step); assertEquals("Jacob", restored.name); assertEquals("file:///photo.jpg", restored.avatarUri)
            assertEquals(machine.artists, restored.artists); assertEquals("test", restored.query); assertTrue(restored.granted)
        }
    }
    @Test fun `restores in flight building and consumes same service completion once`() {
        val machine = ready(3); machine.finish(); val finish = machine.drainEffects().single()
        val restored = OnboardingMachine(); restored.restore(machine.snapshot()); restored.finish()
        assertTrue(restored.finishing); assertTrue(restored.drainEffects().isEmpty())
        restored.reply(response(finish, data = JSONObject().put("success", true)))
        assertEquals("completed", restored.drainEffects().single().action)
        val done = OnboardingMachine(); done.restore(restored.snapshot())
        done.reply(response(finish, 2, JSONObject().put("success", true)))
        assertTrue(done.drainEffects().isEmpty()); assertTrue(done.completed)
    }
    @Test fun `invalid or absent step falls back to welcome`() {
        val machine = OnboardingMachine(); machine.restore("not json")
        assertEquals(OnboardingMachine.Step.welcome, machine.step)
        machine.restore("{\"step\":\"unknown\"}"); assertEquals(OnboardingMachine.Step.welcome, machine.step)
    }
    @Test fun `avatar denial retains current photo`() {
        val machine = OnboardingMachine(); machine.pickAvatar(false); val request = machine.drainEffects().single()
        machine.reply(response(request, data = JSONObject().put("uri", "file:///photo.jpg")))
        machine.reply(response(request, 2)); assertEquals("file:///photo.jpg", machine.avatarUri)
    }
    @Test fun `restores pending debounce without repeating settled searches`() {
        val machine = taste(); machine.drainEffects(); machine.setQuery("abc")
        val restored = OnboardingMachine(); restored.restore(machine.snapshot())
        assertTrue(restored.searchQueued); restored.searchNow()
        val request = restored.drainEffects().single()
        restored.reply(response(request, data = JSONObject().put("artists", JSONArray())))
        val settled = OnboardingMachine(); settled.restore(restored.snapshot()); settled.searchNow()
        assertFalse(settled.searchQueued); assertTrue(settled.drainEffects().isEmpty())
    }
    @Test fun `restores active search identity and rejects completion for unrelated finish`() {
        val machine = taste(); machine.drainEffects(); machine.setQuery("abc"); machine.searchNow()
        val search = machine.drainEffects().single()
        val restored = OnboardingMachine(); restored.restore(machine.snapshot())
        assertTrue(restored.artistLoading)
        restored.reply(response(search, data = JSONObject().put("artists", JSONArray(listOf(artist(9).json())))))
        assertEquals(9L, restored.search.single().id)
        val ready = ready(); ready.finish(); val finish = ready.drainEffects().single()
        ready.reply(response(finish.copy(id = finish.id + 10), data = JSONObject().put("success", true)))
        assertFalse(ready.completed); assertTrue(ready.finishing); assertTrue(ready.drainEffects().isEmpty())
    }

}
