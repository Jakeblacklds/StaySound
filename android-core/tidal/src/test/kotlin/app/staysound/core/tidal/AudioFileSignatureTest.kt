package app.staysound.core.tidal

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioFileSignatureTest {
    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }
    private fun ascii(text: String, padBefore: Int = 0) = ByteArray(padBefore) + text.toByteArray(Charsets.ISO_8859_1)

    @Test fun flacNeedsItsMagicAnywhereInThePrefix() {
        assertEquals(true, AudioFileSignature.matches(ascii("fLaC"), "flac"))
        assertEquals(true, AudioFileSignature.matches(ascii("fLaC", padBefore = 40), "flac"))
        assertEquals(false, AudioFileSignature.matches(ascii("flac"), "flac"))
        assertEquals(false, AudioFileSignature.matches(ByteArray(0), "flac"))
    }

    @Test fun m4aNeedsAnIsoBmffBoxTypeAtAnOffsetOfFour() {
        assertEquals(true, AudioFileSignature.matches(bytes(0, 0, 0, 24) + "ftyp".toByteArray(), "m4a"))
        assertEquals(true, AudioFileSignature.matches(bytes(1, 2, 3, 4) + "moof".toByteArray() + bytes(0, 0), "m4a"))
        assertEquals(false, AudioFileSignature.matches("ftyp".toByteArray(), "m4a"))          // fewer than 8 bytes
        assertEquals(false, AudioFileSignature.matches(bytes(0, 0, 0, 0) + "free".toByteArray(), "m4a"))
    }

    @Test fun mp3AcceptsAnId3TagOrAFrameSync() {
        assertEquals(true, AudioFileSignature.matches(ascii("ID3"), "mp3"))
        assertEquals(true, AudioFileSignature.matches(bytes(0x00, 0xff, 0xfb, 0x90), "mp3"))
        assertEquals(false, AudioFileSignature.matches(bytes(0x00, 0xff, 0x1f, 0x90), "mp3"))
        assertEquals(false, AudioFileSignature.matches(bytes(0xff), "mp3"))
    }

    @Test fun otherExtensionsAreAccepted() {
        assertEquals(true, AudioFileSignature.matches(ByteArray(0), "ogg"))
    }
}
