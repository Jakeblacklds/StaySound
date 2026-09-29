package expo.modules.libraryview

import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class PlaybackPlanTest {
    private fun track(id: String, uri: String = "content://media/external/audio/media/$id", format: String = "flac", cloud: Boolean = false) =
        PlaybackTrack(id, uri, "Song $id", "Artist ${id.hashCode() % 4}", "Album", "", 180000, format, cloudOnly = cloud)

    @Test fun largeLibraryStartsExactlyOnRequestedTrackAndBoundsHistory() {
        val source = (0 until 10000).map { track(it.toString()) }
        for (selected in listOf(0, 1, 499, 9500, 9999)) {
            val plan = PlaybackPlan.create(source, selected.toString())
            assertEquals(selected.toString(), plan.queue[plan.index].id)
            assertEquals(500, plan.queue.size)
            assertEquals(700, plan.linear.size)
            assertEquals(plan.queue.size, plan.queue.map { it.id }.distinct().size)
        }
        assertEquals(10000, source.size)
    }
    @Test fun filteringNeverChangesTheRequestedIdentity() {
        val source = listOf(track("bad", "spotify://track/1"), track("1"), track("2"), track("2"), track("3", format = "wma"))
        val plan = PlaybackPlan.create(source, "2")
        assertEquals(listOf("1", "2"), plan.queue.map { it.id })
        assertEquals(1, plan.index)
    }
    @Test(expected = IllegalArgumentException::class)
    fun unsupportedSelectionDoesNotSilentlyPlayAnotherSong() {
        PlaybackPlan.create(listOf(track("1"), track("bad", format = "dsf")), "bad")
    }
    @Test fun lightweightContextAndSmallQueuesKeepTheirOriginalLimits() {
        assertEquals(420, PlaybackPlan.create((0..999).map { track("$it") }, "990", contextLimit = 420).queue.size)
        val small = PlaybackPlan.create(listOf(track("1"), track("2")), "2")
        assertEquals(1, small.index)
        assertEquals(2, small.queue.size)
    }
    @Test fun shuffleKeepsSelectionFirstAndPreservesLinearOrderForRestoration() {
        val source = (0 until 400).map { track("$it") }
        val plan = PlaybackPlan.create(source, "201", shuffle = true, recent = listOf("5", "6"), random = Random(42))
        assertEquals("201", plan.queue.first().id)
        assertEquals(0, plan.index)
        assertEquals(source.map { it.id }.toSet(), plan.queue.map { it.id }.toSet())
        assertEquals(source, plan.linear)
        assertNotEquals(source, plan.queue)
    }
    @Test fun uriEligibilityCoversLocalStreamingAndCloudPlaceholders() {
        listOf("content://media/1", "file:///music/song.flac", "/music/song.flac", "https://audio/song.mp3").forEach {
            assertTrue(track("1", it).playable)
        }
        assertFalse(track("1", "cloud://1").playable)
        assertFalse(track("1", cloud = true).playable)
        assertFalse(track("1", "").playable)
    }
}
