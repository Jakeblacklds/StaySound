package expo.modules.soulseeknative

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.DeflaterOutputStream

class SoulseekSearchTest {
  private val identity = SoulseekSearchIdentity(listOf("found", "love"), listOf("rihanna"), listOf("flac", "mp3"))
  private fun match(user: String, filename: String = "Rihanna/Talk That Talk/We Found Love.flac") = SoulseekMatch.from(mapOf(
    "username" to user, "filename" to filename, "size" to 1000L, "slotsFree" to true, "speed" to 100000,
  ))

  @Test fun unrelatedFastPeersDoNotFillTheCapOrFinishTheSearch() {
    val collector = SoulseekSearchCollector(identity, 24)
    repeat(100) { collector.add(match("wrong$it", "Other Artist/Love I've Found You.mp3"), 1000L) }
    assertTrue(collector.matches.isEmpty())
    assertFalse(collector.isComplete(5000L))
    collector.add(match("correct"), 5000L)
    assertEquals("correct", collector.matches.single().username)
    assertFalse(collector.isComplete(6000L))
  }

  @Test fun onlyDistinctEligiblePeersCountAndDuplicatesDoNotResetTheQuietWindow() {
    val collector = SoulseekSearchCollector(identity, 24)
    val first = match("one")
    collector.add(first, 1000L)
    collector.add(match("one", "Rihanna/We Found Love.mp3"), 1000L)
    assertFalse(collector.isComplete(2000L))
    collector.add(match("two"), 2000L)
    collector.add(match("three"), 2000L)
    collector.add(first, 2349L)
    assertFalse(collector.isComplete(2349L))
    assertTrue(collector.isComplete(2350L))
  }

  @Test fun freeMp3PeersDoNotEndALosslessSearchEarly() {
    val collector = SoulseekSearchCollector(identity, 24)
    repeat(5) { collector.add(match("mp3$it", "Rihanna/We Found Love.mp3"), 1000L) }
    assertFalse(collector.isComplete(9000L))
    collector.add(match("flac"), 9000L)
    assertFalse(collector.isComplete(10_499L))
    assertTrue(collector.isComplete(10_500L))
  }

  @Test fun filtersUnsupportedFilesAndStemsButAcceptsFeaturedArtistFilenames() {
    assertTrue(identity.matches(match("a", "Rihanna/We Found Love (feat. Calvin Harris).flac")))
    assertFalse(identity.matches(match("a", "Rihanna/We Found Love.jpg")))
    assertFalse(identity.matches(match("a", "Rihanna/We Found Love/drums.mp3")))
    assertFalse(identity.matches(match("a", "Rihanna/Talk That Talk/Where Have You Been.flac")))
    val accented = SoulseekSearchIdentity(listOf("sone"), listOf("zoe"))
    assertTrue(accented.matches(match("a", "Zoé/Soñé.flac")))
  }

  @Test fun rawSearchesStillWorkWithoutIdentityAndTheCapIsRespected() {
    val collector = SoulseekSearchCollector(null, 2)
    repeat(3) { collector.add(match("user$it"), 1000L) }
    assertEquals(2, collector.matches.size)
    assertTrue(collector.isComplete(1000L))
  }

  @Test fun lateRepliesFromAnEarlierSearchAreIgnored() {
    val current = byteArrayOf(1, 2, 3, 4)
    val matches = CopyOnWriteArrayList<SoulseekMatch>()
    val received = CountDownLatch(1)
    ServerSocket(0).use { listener ->
      Socket("127.0.0.1", listener.localPort).use { sender ->
        listener.accept().use { receiver ->
          val peer = PeerSearchConnection(receiver,
            onMatch = { matches.add(it); received.countDown() },
            acceptSearchToken = { it.contentEquals(current) },
          )
          try {
            peer.start()
            sender.getOutputStream().write(reply(byteArrayOf(9, 8, 7, 6), "old"))
            sender.getOutputStream().write(reply(current, "current"))
            sender.getOutputStream().flush()
            assertTrue(received.await(3, TimeUnit.SECONDS))
            assertEquals(listOf("current"), matches.map { it.username })
          } finally { peer.close() }
        }
      }
    }
  }

  private fun reply(token: ByteArray, user: String): ByteArray {
    val body = SlskMessageBuilder().writeString(user).writeBytes(token).writeUInt32(1)
      .writeUInt8(1).writeString("Rihanna/We Found Love.flac").writeUInt64(1000)
      .writeString("").writeUInt32(0).writeUInt8(1).writeUInt32(100000).writeUInt32(0).toBytes()
    val compressed = ByteArrayOutputStream()
    DeflaterOutputStream(compressed).use { it.write(body) }
    return SlskMessageBuilder().writeUInt32(9).writeBytes(compressed.toByteArray()).toPacket()
  }
}
