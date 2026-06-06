package expo.modules.karaokeview

internal class LyricsParser {
    fun parse(data: List<Map<String, Any>>): List<LyricLine> {
        val result = mutableListOf<LyricLine>()
        var currentMainWords = mutableListOf<LyricWord>()
        var currentBackgroundWords = mutableListOf<LyricWord>()
        
        var currentLineTranslatedText: String? = null
        var currentLineRomanizedText: String? = null

        for (wordMap in data) {
            val text = wordMap["w"] as? String ?: ""
            val startSec = (wordMap["s"] as? Number)?.toDouble() ?: 0.0
            val endSec = (wordMap["e"] as? Number)?.toDouble() ?: startSec
            val startMs = (startSec * 1000).toLong()
            val endMs = (endSec * 1000).toLong()
            val hasSourceSpacing = wordMap.containsKey("sp")
            val trailingSpace = wordMap["sp"] as? Boolean ?: false
            val isBackground = wordMap["bg"] as? Boolean ?: false
            val isPart = wordMap["p"] as? Boolean ?: false
            val normalizedText = text.replace(Regex("\\s+"), " ").trim()
            val targetWords = if (isBackground) currentBackgroundWords else currentMainWords

            // Extract word-level synced romanization
            val wordRomanized = (wordMap["r"] as? String ?: wordMap["romanized"] as? String)?.trim()?.takeIf { it.isNotEmpty() }

            // Accumulate line-level properties if present
            val lineTranslated = (wordMap["translatedText"] as? String ?: wordMap["translation"] as? String ?: wordMap["t"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
            val lineRomanized = (wordMap["romanizedText"] as? String ?: wordMap["romanization"] as? String)?.trim()?.takeIf { it.isNotEmpty() }

            if (lineTranslated != null) {
                currentLineTranslatedText = lineTranslated
            }
            if (lineRomanized != null) {
                currentLineRomanizedText = lineRomanized
            }

            if (hasSourceSpacing) {
                if (normalizedText.isNotEmpty()) {
                    targetWords.add(
                        LyricWord(
                            text = normalizedText,
                            startMs = startMs,
                            endMs = endMs,
                            trailingSpace = trailingSpace,
                            isBackground = isBackground,
                            isPart = isPart,
                            romanizedText = wordRomanized
                        )
                    )
                }
            } else {
                val tokens = normalizedText
                    .split(Regex("\\s+"))
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }

                if (tokens.size <= 1) {
                    if (normalizedText.isNotEmpty()) {
                        targetWords.add(
                            LyricWord(
                                text = normalizedText,
                                startMs = startMs,
                                endMs = endMs,
                                trailingSpace = false,
                                isBackground = isBackground,
                                isPart = isPart,
                                romanizedText = wordRomanized
                            )
                        )
                    }
                } else {
                    val total = (endMs - startMs).coerceAtLeast(1L)
                    for (index in tokens.indices) {
                        val tokenStart = startMs + (total * index) / tokens.size
                        val tokenEnd = if (index == tokens.lastIndex) {
                            endMs
                        } else {
                            startMs + (total * (index + 1)) / tokens.size
                        }
                        targetWords.add(
                            LyricWord(
                                text = tokens[index],
                                startMs = tokenStart,
                                endMs = tokenEnd,
                                trailingSpace = index < tokens.lastIndex,
                                isBackground = isBackground,
                                isPart = isPart,
                                romanizedText = if (index == 0) wordRomanized else null // assign word-synced romanization to the first token
                            )
                        )
                    }
                }
            }

            if (wordMap["n"] as? Boolean == true) {
                finalizeParsedLine(result, currentMainWords, currentBackgroundWords, currentLineTranslatedText, currentLineRomanizedText)
                currentMainWords = mutableListOf()
                currentBackgroundWords = mutableListOf()
                currentLineTranslatedText = null
                currentLineRomanizedText = null
            }
        }

        finalizeParsedLine(result, currentMainWords, currentBackgroundWords, currentLineTranslatedText, currentLineRomanizedText)
        return result
    }

    private fun finalizeParsedLine(
        result: MutableList<LyricLine>,
        mainWords: MutableList<LyricWord>,
        backgroundWords: MutableList<LyricWord>,
        lineTranslatedText: String?,
        lineRomanizedText: String?,
    ) {
        val normalizedMainWords = if (mainWords.isNotEmpty()) {
            mainWords.toMutableList()
        } else {
            backgroundWords.map { it.copy(isBackground = false) }.toMutableList()
        }
        val normalizedBackgroundWords = if (mainWords.isNotEmpty()) {
            backgroundWords.toMutableList()
        } else {
            mutableListOf()
        }

        if (normalizedMainWords.isEmpty() && normalizedBackgroundWords.isEmpty()) {
            return
        }

        val allWords = normalizedMainWords + normalizedBackgroundWords
        result.add(
            LyricLine(
                words = normalizedMainWords,
                backgroundWords = normalizedBackgroundWords,
                startMs = allWords.minOf { it.startMs },
                endMs = allWords.maxOf { it.endMs },
            ).apply {
                translatedText = lineTranslatedText
                romanizedText = lineRomanizedText
            }
        )
    }
}
