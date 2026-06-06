package expo.modules.karaokeview

internal object LyricsBidiHelper {
    private val RTL_RE = Regex("[\\u0600-\\u06FF\\u0750-\\u077F\\u0590-\\u05FF\\u08A0-\\u08FF\\uFB50-\\uFDCF\\uFDF0-\\uFDFF\\uFE70-\\uFEFF]")
    private val CJK_RE = Regex("[\\u4E00-\\u9FFF\\u3000-\\u303F\\u3040-\\u309F\\u30A0-\\u30FF\\uAC00-\\uD7AF]")
    private val LATIN_LTR_RE = Regex("[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}]")

    /**
     * Detects if the text contains any Right-to-Left character.
     */
    fun isRtl(text: String): Boolean {
        return RTL_RE.containsMatchIn(text)
    }

    /**
     * Detects if the text contains CJK characters.
     */
    fun isCjk(text: String): Boolean {
        return CJK_RE.containsMatchIn(text)
    }

    /**
     * Checks if the text has mixed directions (both LTR and RTL scripts).
     */
    fun isBiDi(text: String): Boolean {
        return isRtl(text) && LATIN_LTR_RE.containsMatchIn(text)
    }

    /**
     * Wraps a string with Unicode direction isolation characters.
     * RLI (Right-to-Left Isolate) = \u2067
     * LRI (Left-to-Right Isolate) = \u2066
     * PDI (Pop Directional Isolate) = \u2069
     */
    fun isolateText(text: String, isRtl: Boolean): String {
        if (text.isEmpty()) return text
        val prefix = if (isRtl) "\u2067" else "\u2066"
        return "$prefix$text\u2069"
    }

    /**
     * Flips the x-offsets for all words in a single row to layout right-to-left.
     *
     * Given LTR offsets, the flipped offset is computed as:
     * xOffset' = maxWidth - xOffset - width
     *
     * This shifts the words to the right side of the container (right-alignment)
     * and reverses their visual order in the row.
     */
    fun adjustOffsetsForRtl(words: List<LyricWord>, maxWidth: Float) {
        if (words.isEmpty()) return
        for (word in words) {
            word.xOffset = maxWidth - word.xOffset - word.width
        }
    }
}
