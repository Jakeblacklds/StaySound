package expo.modules.karaokeview

internal object LyricsGapGenerator {
    private const val MIN_GAP_DURATION_MS = 7000L
    private const val IN_BETWEEN_GAP_START_OFFSET_MS = 310L
    private const val GAP_END_OFFSET_MS = 660L

    fun generateGaps(lines: List<LyricLine>): List<LyricLine> {
        if (lines.isEmpty()) return lines

        val result = mutableListOf<LyricLine>()
        val firstLine = lines.first()

        // 1. Intro Dots: check if first line starts at or after 7 seconds
        if (firstLine.startMs >= MIN_GAP_DURATION_MS) {
            val gapStart = 0L
            val gapEnd = firstLine.startMs - GAP_END_OFFSET_MS
            if (gapEnd > gapStart) {
                result.add(createGapLine(gapStart, gapEnd, inheritFrom = firstLine))
            }
        }

        // 2. In-between Dots: check gaps between consecutive lines
        for (i in 0 until lines.size - 1) {
            val currentLine = lines[i]
            val nextLine = lines[i + 1]
            result.add(currentLine)

            val gapStart = currentLine.endMs + IN_BETWEEN_GAP_START_OFFSET_MS
            val gapEnd = nextLine.startMs - GAP_END_OFFSET_MS
            val gapDuration = nextLine.startMs - currentLine.endMs

            if (gapDuration >= MIN_GAP_DURATION_MS && gapEnd > gapStart) {
                result.add(createGapLine(gapStart, gapEnd, inheritFrom = nextLine))
            }
        }

        result.add(lines.last())
        return result
    }

    private fun createGapLine(startMs: Long, endMs: Long, inheritFrom: LyricLine): LyricLine {
        val durationMs = endMs - startMs
        val segmentDurationMs = durationMs / 3
        val syllableDuration = (segmentDurationMs * 0.7f).toLong()
        val gapPadding = (segmentDurationMs * 0.3f).toLong()

        val words = mutableListOf<LyricWord>()
        for (i in 0 until 3) {
            val wordStart = startMs + (i * segmentDurationMs) + gapPadding
            val wordEnd = wordStart + syllableDuration
            words.add(
                LyricWord(
                    text = "•",
                    startMs = wordStart,
                    endMs = wordEnd,
                    trailingSpace = false,
                    isBackground = false
                ).apply {
                    isGap = true
                }
            )
        }

        // Inherit translation or direction properties if needed
        val isRtl = inheritFrom.words.firstOrNull()?.let { LyricsBidiHelper.isRtl(it.text) } ?: false

        return LyricLine(
            words = words,
            startMs = startMs,
            endMs = endMs
        ).apply {
            isGap = true
            // If the inherited line is RTL, we should wrap the text or handle it
        }
    }
}
