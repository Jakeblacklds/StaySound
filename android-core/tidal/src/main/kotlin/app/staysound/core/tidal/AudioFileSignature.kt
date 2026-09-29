package app.staysound.core.tidal

/**
 * Port of the byte checks in `src/features/tidal/data/audioFileValidation.ts`: does the start of a downloaded file look
 * like the format its extension claims? Callers read the first 96 bytes.
 */
object AudioFileSignature {
    private val isoBmffBoxes = setOf("ftyp", "styp", "moov", "moof", "mdat")

    private fun includesAscii(bytes: ByteArray, value: String): Boolean {
        if (value.isEmpty() || bytes.size < value.length) return false
        return (0..bytes.size - value.length).any { offset -> value.indices.all { (bytes[offset + it].toInt() and 0xff) == value[it].code } }
    }

    private fun hasIsoBmffHeader(bytes: ByteArray): Boolean {
        if (bytes.size < 8) return false
        return (0..bytes.size - 8).any { offset ->
            isoBmffBoxes.contains(String(CharArray(4) { (bytes[offset + 4 + it].toInt() and 0xff).toChar() }))
        }
    }

    private fun hasMp3FrameSync(bytes: ByteArray) = (0 until bytes.size - 1).any { (bytes[it].toInt() and 0xff) == 0xff && (bytes[it + 1].toInt() and 0xe0) == 0xe0 }

    /** Unknown extensions are accepted, as before. */
    fun matches(prefix: ByteArray, extension: String): Boolean = when (extension) {
        "flac" -> includesAscii(prefix, "fLaC")
        "m4a" -> hasIsoBmffHeader(prefix)
        "mp3" -> includesAscii(prefix, "ID3") || hasMp3FrameSync(prefix)
        else -> true
    }
}
