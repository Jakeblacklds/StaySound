package expo.modules.onboardingview

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingMachineTest {
    private var sequence = 0L
    private fun OnboardingMachine.answer(action: String, id: Long, data: JSONObject) =
        reply(JSONObject().put("sequence", ++sequence).put("id", id).put("action", action).put("data", data))
    private fun OnboardingMachine.effect(action: String) = drainEffects().last { it.action == action }
    private fun OnboardingMachine.toAccount() { advance(); advance(); drainEffects() }
    private fun OnboardingMachine.toTrial() {
        toAccount(); username = "ana"; password = "secret"; saveAccount()
        answer("credentials", effect("credentials").id, JSONObject().put("saved", true)); drainEffects()
    }
    private val song = Found("m1", "Song", "Artist", "FLAC · 30 MB")

    @Test fun `welcome leads to music and asks for the current permission`() {
        val machine = OnboardingMachine(); machine.advance()
        assertEquals(OnboardingMachine.Step.music, machine.step)
        machine.answer("checkPermission", machine.effect("checkPermission").id, JSONObject().put("granted", true))
        assertTrue(machine.granted)
    }
    @Test fun `a denied permission never blocks the way forward`() {
        val machine = OnboardingMachine(); machine.advance(); machine.requestPermission()
        machine.answer("permission", machine.effect("permission").id, JSONObject().put("granted", false))
        machine.advance()
        assertEquals(OnboardingMachine.Step.account, machine.step)
    }
    @Test fun `the account step needs both fields and does not advance on its own`() {
        val machine = OnboardingMachine(); machine.toAccount()
        machine.username = "ana"; machine.saveAccount(); machine.advance()
        assertEquals(OnboardingMachine.Step.account, machine.step)
        assertTrue(machine.drainEffects().none { it.action == "credentials" })
    }
    @Test fun `saving the account trims it, moves to the trial and forgets the password`() {
        val machine = OnboardingMachine(); machine.toAccount()
        machine.username = " ana "; machine.password = " secret "; machine.saveAccount()
        val save = machine.effect("credentials")
        assertEquals("ana", save.payload.getString("username")); assertEquals("secret", save.payload.getString("password"))
        machine.answer("credentials", save.id, JSONObject().put("saved", true))
        assertEquals(OnboardingMachine.Step.tryIt, machine.step)
        assertEquals("", machine.password)
        assertFalse(machine.snapshot().contains("secret"))
    }
    @Test fun `a failed save stays on the step with the reason`() {
        val machine = OnboardingMachine(); machine.toAccount()
        machine.username = "ana"; machine.password = "x"; machine.saveAccount()
        machine.answer("credentials", machine.effect("credentials").id, JSONObject().put("error", "sin red"))
        assertEquals(OnboardingMachine.Step.account, machine.step)
        assertEquals("sin red", machine.accountError); assertFalse(machine.saving)
    }
    @Test fun `an account already stored lets continue without typing`() {
        val machine = OnboardingMachine(); machine.advance(); machine.advance()
        machine.answer("account", machine.effect("account").id, JSONObject().put("connected", true).put("username", "ana"))
        machine.advance()
        assertEquals(OnboardingMachine.Step.tryIt, machine.step); assertEquals("ana", machine.username)
    }
    @Test fun `skipping the account skips the trial too`() {
        val machine = OnboardingMachine(); machine.toAccount(); machine.skip()
        assertEquals(OnboardingMachine.Step.ready, machine.step)
        machine.back()
        assertEquals(OnboardingMachine.Step.account, machine.step)
    }
    @Test fun `search needs two characters and ignores a stale answer`() {
        val machine = OnboardingMachine(); machine.toTrial()
        machine.query = "a"; machine.search(); assertFalse(machine.searching)
        machine.query = "song"; machine.search()
        val first = machine.effect("search").id
        machine.answer("search", first - 1, JSONObject().put("results", JSONArray().put(song.json())))
        assertTrue(machine.searching)
        machine.answer("search", first, JSONObject().put("results", JSONArray().put(song.json())))
        assertFalse(machine.searching); assertEquals(listOf(song), machine.results)
    }
    @Test fun `a search error is kept and an empty result is not an error`() {
        val machine = OnboardingMachine(); machine.toTrial(); machine.query = "song"; machine.search()
        machine.answer("search", machine.effect("search").id, JSONObject().put("results", JSONArray()))
        assertTrue(machine.searched); assertEquals("", machine.searchError)
        machine.search()
        machine.answer("search", machine.effect("search").id, JSONObject().put("error", "INVALIDPASS"))
        assertEquals("INVALIDPASS", machine.searchError)
    }
    @Test fun `a download reports progress, never goes backwards and finishes once`() {
        val machine = OnboardingMachine(); machine.toTrial(); machine.download(song); machine.download(song)
        val effects = machine.drainEffects().filter { it.action == "download" }
        assertEquals(1, effects.size)
        val id = effects.single().id
        machine.answer("download", id, JSONObject().put("progress", 40))
        machine.answer("download", id, JSONObject().put("progress", 10))
        assertEquals(40, machine.progress)
        machine.advance(); machine.skip(); machine.back()
        assertEquals(OnboardingMachine.Step.tryIt, machine.step)
        machine.answer("download", id, JSONObject().put("done", true))
        assertEquals(OnboardingMachine.Transfer.done, machine.transfer)
        machine.advance()
        assertEquals(OnboardingMachine.Step.ready, machine.step)
    }
    @Test fun `a failed download can be retried with another result`() {
        val machine = OnboardingMachine(); machine.toTrial(); machine.download(song)
        machine.answer("download", machine.effect("download").id, JSONObject().put("error", "cola llena"))
        assertEquals(OnboardingMachine.Transfer.failed, machine.transfer); assertEquals("cola llena", machine.transferError)
        machine.download(song.copy(id = "m2"))
        assertEquals(OnboardingMachine.Transfer.running, machine.transfer); assertEquals("m2", machine.transferId)
    }
    @Test fun `finish is sent once and completes once`() {
        val machine = OnboardingMachine(); machine.toAccount(); machine.skip(); machine.name = "Ana"
        machine.finish(); machine.finish()
        val finishes = machine.drainEffects().filter { it.action == "finish" }
        assertEquals(1, finishes.size); assertEquals("Ana", finishes.single().payload.getString("name"))
        machine.answer("finish", finishes.single().id, JSONObject().put("success", true))
        machine.answer("finish", finishes.single().id, JSONObject().put("success", true))
        assertTrue(machine.completed)
        assertEquals(1, machine.drainEffects().count { it.action == "completed" })
    }
    @Test fun `a checkpoint restores the step, results and pending requests`() {
        val machine = OnboardingMachine(); machine.toTrial(); machine.query = "song"; machine.search()
        val pending = machine.effect("search").id
        val restored = OnboardingMachine().apply { restore(machine.snapshot()) }
        assertEquals(OnboardingMachine.Step.tryIt, restored.step); assertTrue(restored.searching)
        restored.reply(JSONObject().put("sequence", 99).put("id", pending).put("action", "search")
            .put("data", JSONObject().put("results", JSONArray().put(song.json()))))
        assertEquals(listOf(song), restored.results)
    }
}
