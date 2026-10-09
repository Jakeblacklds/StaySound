package expo.modules.karaokeview

import java.text.BreakIterator

/**
 * Data classes for karaoke lyrics
 */

enum class BackgroundPlacement {
    BEFORE,
    AFTER,
}

data class LyricWord(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val trailingSpace: Boolean = true,
    val isBackground: Boolean = false,
    val isPart: Boolean = false,
    var xOffset: Float = 0f,    // Pre-computed X position within line
    var yOffset: Float = 0f,    // Pre-computed Y offset (for multi-line)
    var width: Float = 0f,      // Pre-computed width
    var glyphUnits: List<LyricGlyphUnit> = emptyList(),
    var drawableGlyphCount: Int = 0,
    var isGap: Boolean = false,
    var romanizedText: String? = null,
)

data class LyricGlyphUnit(
    val text: String,
    val width: Float,
    val advanceX: Float,
    val centerRatio: Float,
    val isWhitespace: Boolean,
)

data class LyricLine(
    val words: MutableList<LyricWord>,
    val backgroundWords: MutableList<LyricWord> = mutableListOf(),
    var startMs: Long = 0,
    var endMs: Long = 0,
    var y: Float = 0f,          // Pre-computed Y position
    var totalWidth: Float = 0f, // Pre-computed total width
    var totalHeight: Float = 0f,
    var mainTopOffset: Float = 0f,
    var mainHeight: Float = 0f,
    var backgroundTopOffset: Float = 0f,
    var backgroundHeight: Float = 0f,
    var focusCenterYOffset: Float = 0f,
    var backgroundPlacement: BackgroundPlacement = BackgroundPlacement.AFTER,
    var isGap: Boolean = false,
    var translatedText: String? = null,
    var romanizedText: String? = null,
    var translationRows: List<String> = emptyList(),
    var translationY: Float = 0f,
    var translationHeight: Float = 0f,
    var romanizationRows: List<String> = emptyList(),
    var romanizationY: Float = 0f,
    var romanizationHeight: Float = 0f,
)

internal object LyricsVisualWords {
    private val punctuationRegex = Regex("^[,.;:!?)]")
    private val rtlRegex = Regex("[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\u0590-\\u05FF]")

    fun shouldInsertSpacing(previous: LyricWord?, current: LyricWord): Boolean {
        if (previous == null) return false
        if (previous.trailingSpace) return true
        if (current.isPart) return false

        val prevText = previous.text
        val currentText = current.text

        if (prevText.endsWith("-")) return false
        if (prevText.endsWith("'") || prevText.endsWith("’")) return false
        if (currentText.startsWith("'") || currentText.startsWith("’")) return false
        if (punctuationRegex.matches(currentText)) return false

        // KPoe/Apple syllable payloads use spacing markers to separate visual words.
        // If there is no explicit boundary, keep the fragments attached like binimum does.
        return false
    }

    fun findVisualWordRange(words: List<LyricWord>, anchorIndex: Int): IntRange {
        if (words.isEmpty() || anchorIndex !in words.indices) {
            return IntRange.EMPTY
        }

        var start = anchorIndex
        while (start > 0 && !shouldInsertSpacing(words[start - 1], words[start])) {
            start -= 1
        }

        var end = anchorIndex
        while (end < words.lastIndex && !shouldInsertSpacing(words[end], words[end + 1])) {
            end += 1
        }

        return start..end
    }

    fun isGrowableVisualWord(text: String, startMs: Long, endMs: Long): Boolean {
        val combinedText = text.replace(Regex("\\s+"), "").trim()
        if (combinedText.isEmpty()) return false

        val durationMs = (endMs - startMs).coerceAtLeast(0L)
        val isRtl = rtlRegex.containsMatchIn(combinedText)
        val graphemeCount = countGraphemes(combinedText)

        // am-lyrics / desktop only promotes compact, held visual words. Keeping this
        // gate identical matters: growable words switch to per-grapheme scale, delay
        // and glow, so a broader Android heuristic changes the whole line's rhythm.
        return !isRtl && graphemeCount in 1..7 && durationMs >= 1_000L
    }

    private fun countGraphemes(text: String): Int {
        val iterator = BreakIterator.getCharacterInstance()
        iterator.setText(text)
        var count = 0
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            count += 1
            end = iterator.next()
        }
        return count
    }
}

internal object LyricsSweepPhysics {
    /** Desktop pre-wipe distance: exactly 0.375em at the source fragment's velocity. */
    fun preHighlightProgress(
        sourceWidthPx: Float,
        fontSizePx: Float,
        sourceStartMs: Long,
        sourceEndMs: Long,
        currentTimeMs: Long,
        preWipeDistanceEm: Float = 0.375f,
    ): Float {
        val durationMs = (sourceEndMs - sourceStartMs).coerceAtLeast(1L).toFloat()
        if (sourceWidthPx <= 0.1f || fontSizePx <= 0f) return 0f
        val preDurationMs = (durationMs * (preWipeDistanceEm * fontSizePx) / sourceWidthPx)
            .coerceIn(1f, durationMs)
        val preStartMs = sourceEndMs.toFloat() - preDurationMs
        return ((currentTimeMs.toFloat() - preStartMs) / preDurationMs).coerceIn(0f, 1f)
    }
}

/**
 * O(1) lookup table for finding active line by time
 * Uses 10ms buckets for fast access
 */
class LyricsLookupTable(private val lines: List<LyricLine>) {
    private val buckets: IntArray
    private val bucketSizeMs = 10

    init {
        val maxTime = lines.lastOrNull()?.endMs ?: 0L
        val numBuckets = ((maxTime / bucketSizeMs) + 1).toInt().coerceAtLeast(1)
        buckets = IntArray(numBuckets) { -1 }

        // Fill buckets with line indices
        lines.forEachIndexed { index, line ->
            val startBucket = (line.startMs / bucketSizeMs).toInt()
            val endBucket = (line.endMs / bucketSizeMs).toInt().coerceAtMost(numBuckets - 1)
            for (b in startBucket..endBucket) {
                if (b in buckets.indices) {
                    buckets[b] = index
                }
            }
        }

        // Fill gaps with previous line (for silences between lyrics)
        var lastFilled = -1
        for (i in buckets.indices) {
            if (buckets[i] >= 0) {
                lastFilled = buckets[i]
            } else if (lastFilled >= 0) {
                buckets[i] = lastFilled
            }
        }
        
        // Fill pre-lyrics buckets with line 0
        if (lines.isNotEmpty()) {
            val firstLineStart = (lines[0].startMs / bucketSizeMs).toInt()
            for (b in 0 until firstLineStart.coerceAtMost(buckets.size)) {
                if (buckets[b] < 0) buckets[b] = 0
            }
        }
    }

    fun getLineIndexAt(timeMs: Long): Int {
        val bucket = (timeMs / bucketSizeMs).toInt()
        return if (bucket in buckets.indices) buckets[bucket] else -1
    }
}

enum class MotionProfile(val preset: MotionProfilePreset) {
    AMBIENT(
        MotionProfilePreset(
            glowAlphaBase = 16f,
            glowAlphaRange = 24f,
            glowAlphaMultiplier = 0.88f,
            glowAlphaClamp = 56,
            glowRadiusBase = 0.1f,
            glowRadiusRange = 0.06f,
            glowWidthScale = 1.28f,
            glowBandStartScale = 1.34f,
            glowBandEndScale = 0.82f,
            glowFadeScale = 1.15f,
            glowShadowBoost = 1.45f,
            glowShadowClamp = 90,
            starDustCount = 3,
            starDustAlphaBase = 18f,
            starDustAlphaRange = 34f,
            starDustAlphaMultiplier = 0.78f,
            starDustAlphaClamp = 68,
            starDustOrbitXBase = 0.86f,
            starDustOrbitXRange = 0.48f,
            starDustOrbitYBase = 0.17f,
            starDustOrbitYRange = 0.12f,
            starDustShadowRadius = 0.05f,
            starDustShadowBoost = 1.75f,
            starDustShadowClamp = 84,
            starDustPhaseSpeed = 4.8f,
            starDustPhaseStep = 1.11f,
            starDustLocalAlphaBase = 0.84f,
            starDustLocalAlphaDrop = 0.18f,
            starDustLocalAlphaClamp = 58,
            starDustWaveBase = 0.94f,
            starDustWaveStep = 0.04f,
            starDustRadiusBase = 0.9f,
            starDustRadiusRange = 0.72f,
            starDustRadiusDrop = 0.14f,
            starDustMinRadius = 0.5f,
            starDustDriftStepX = 0.75f,
            starDustDriftStepY = 1.2f,
            particleBucketScale = 1.5f,
            particleEmissionLow = 1,
            particleEmissionHigh = 1,
            particleSpreadX = 1.34f,
            particleSpreadY = 1.2f,
            particleLifetimeBaseMs = 1500L,
            particleLifetimeRangeMs = 1200f,
            particleLifetimeMinMs = 1400L,
            particleLifetimeMaxMs = 2700L,
            particleAlphaMultiplier = 0.82f,
            particleAlphaClamp = 112,
            particleRadiusScale = 1.08f,
            particleBlurScale = 1.18f,
            particleOffsetXScale = 0.9f,
            particleOffsetYScale = 0.72f,
            particleDriftXScale = 0.72f,
            particleRiseScale = 1.46f,
            particleWobbleAmplitudeScale = 1.28f,
            particleWobbleFrequencyScale = 0.88f,
        )
    ),
    PULSE(
        MotionProfilePreset(
            glowAlphaBase = 24f,
            glowAlphaRange = 36f,
            glowAlphaMultiplier = 1.02f,
            glowAlphaClamp = 78,
            glowRadiusBase = 0.092f,
            glowRadiusRange = 0.05f,
            glowWidthScale = 1.02f,
            glowBandStartScale = 1.05f,
            glowBandEndScale = 0.7f,
            glowFadeScale = 0.9f,
            glowShadowBoost = 1.9f,
            glowShadowClamp = 118,
            starDustCount = 4,
            starDustAlphaBase = 26f,
            starDustAlphaRange = 56f,
            starDustAlphaMultiplier = 1.05f,
            starDustAlphaClamp = 104,
            starDustOrbitXBase = 0.5f,
            starDustOrbitXRange = 0.28f,
            starDustOrbitYBase = 0.1f,
            starDustOrbitYRange = 0.06f,
            starDustShadowRadius = 0.05f,
            starDustShadowBoost = 2.24f,
            starDustShadowClamp = 122,
            starDustPhaseSpeed = 7.2f,
            starDustPhaseStep = 1.44f,
            starDustLocalAlphaBase = 0.96f,
            starDustLocalAlphaDrop = 0.16f,
            starDustLocalAlphaClamp = 92,
            starDustWaveBase = 1.22f,
            starDustWaveStep = 0.08f,
            starDustRadiusBase = 1.06f,
            starDustRadiusRange = 0.92f,
            starDustRadiusDrop = 0.14f,
            starDustMinRadius = 0.6f,
            starDustDriftStepX = 1f,
            starDustDriftStepY = 1.6f,
            particleBucketScale = 0.82f,
            particleEmissionLow = 1,
            particleEmissionHigh = 2,
            particleSpreadX = 0.94f,
            particleSpreadY = 0.9f,
            particleLifetimeBaseMs = 1080L,
            particleLifetimeRangeMs = 700f,
            particleLifetimeMinMs = 950L,
            particleLifetimeMaxMs = 1800L,
            particleAlphaMultiplier = 1f,
            particleAlphaClamp = 136,
            particleRadiusScale = 1f,
            particleBlurScale = 0.96f,
            particleOffsetXScale = 1f,
            particleOffsetYScale = 1f,
            particleDriftXScale = 0.9f,
            particleRiseScale = 1.04f,
            particleWobbleAmplitudeScale = 0.92f,
            particleWobbleFrequencyScale = 1.2f,
        )
    ),
    FIRE(
        MotionProfilePreset(
            glowAlphaBase = 30f,
            glowAlphaRange = 46f,
            glowAlphaMultiplier = 1.12f,
            glowAlphaClamp = 92,
            glowRadiusBase = 0.1f,
            glowRadiusRange = 0.06f,
            glowWidthScale = 0.94f,
            glowBandStartScale = 1.08f,
            glowBandEndScale = 0.76f,
            glowFadeScale = 0.86f,
            glowShadowBoost = 2.1f,
            glowShadowClamp = 132,
            starDustCount = 5,
            starDustAlphaBase = 32f,
            starDustAlphaRange = 62f,
            starDustAlphaMultiplier = 1.1f,
            starDustAlphaClamp = 116,
            starDustOrbitXBase = 0.42f,
            starDustOrbitXRange = 0.22f,
            starDustOrbitYBase = 0.16f,
            starDustOrbitYRange = 0.12f,
            starDustShadowRadius = 0.062f,
            starDustShadowBoost = 2.5f,
            starDustShadowClamp = 138,
            starDustPhaseSpeed = 8.4f,
            starDustPhaseStep = 1.16f,
            starDustLocalAlphaBase = 1f,
            starDustLocalAlphaDrop = 0.14f,
            starDustLocalAlphaClamp = 98,
            starDustWaveBase = 1.32f,
            starDustWaveStep = 0.1f,
            starDustRadiusBase = 1.12f,
            starDustRadiusRange = 1.14f,
            starDustRadiusDrop = 0.12f,
            starDustMinRadius = 0.65f,
            starDustDriftStepX = 0.68f,
            starDustDriftStepY = 1.9f,
            particleBucketScale = 0.72f,
            particleEmissionLow = 2,
            particleEmissionHigh = 3,
            particleSpreadX = 0.78f,
            particleSpreadY = 1.18f,
            particleLifetimeBaseMs = 860L,
            particleLifetimeRangeMs = 620f,
            particleLifetimeMinMs = 820L,
            particleLifetimeMaxMs = 1560L,
            particleAlphaMultiplier = 1.08f,
            particleAlphaClamp = 148,
            particleRadiusScale = 1.12f,
            particleBlurScale = 1.08f,
            particleOffsetXScale = 0.82f,
            particleOffsetYScale = 1.24f,
            particleDriftXScale = 0.54f,
            particleRiseScale = 1.72f,
            particleWobbleAmplitudeScale = 0.84f,
            particleWobbleFrequencyScale = 1.24f,
        )
    ),
    VELVET(
        MotionProfilePreset(
            glowAlphaBase = 20f,
            glowAlphaRange = 28f,
            glowAlphaMultiplier = 0.92f,
            glowAlphaClamp = 62,
            glowRadiusBase = 0.11f,
            glowRadiusRange = 0.055f,
            glowWidthScale = 1.14f,
            glowBandStartScale = 1.2f,
            glowBandEndScale = 0.78f,
            glowFadeScale = 1.06f,
            glowShadowBoost = 1.7f,
            glowShadowClamp = 98,
            starDustCount = 3,
            starDustAlphaBase = 22f,
            starDustAlphaRange = 38f,
            starDustAlphaMultiplier = 0.9f,
            starDustAlphaClamp = 78,
            starDustOrbitXBase = 0.62f,
            starDustOrbitXRange = 0.26f,
            starDustOrbitYBase = 0.11f,
            starDustOrbitYRange = 0.08f,
            starDustShadowRadius = 0.058f,
            starDustShadowBoost = 1.96f,
            starDustShadowClamp = 94,
            starDustPhaseSpeed = 5.3f,
            starDustPhaseStep = 1.52f,
            starDustLocalAlphaBase = 0.9f,
            starDustLocalAlphaDrop = 0.17f,
            starDustLocalAlphaClamp = 64,
            starDustWaveBase = 0.98f,
            starDustWaveStep = 0.05f,
            starDustRadiusBase = 1f,
            starDustRadiusRange = 0.82f,
            starDustRadiusDrop = 0.18f,
            starDustMinRadius = 0.56f,
            starDustDriftStepX = 0.9f,
            starDustDriftStepY = 1.28f,
            particleBucketScale = 1.2f,
            particleEmissionLow = 1,
            particleEmissionHigh = 1,
            particleSpreadX = 1f,
            particleSpreadY = 0.86f,
            particleLifetimeBaseMs = 1320L,
            particleLifetimeRangeMs = 940f,
            particleLifetimeMinMs = 1240L,
            particleLifetimeMaxMs = 2280L,
            particleAlphaMultiplier = 0.9f,
            particleAlphaClamp = 118,
            particleRadiusScale = 1.02f,
            particleBlurScale = 1.24f,
            particleOffsetXScale = 0.94f,
            particleOffsetYScale = 0.84f,
            particleDriftXScale = 0.66f,
            particleRiseScale = 1.1f,
            particleWobbleAmplitudeScale = 0.68f,
            particleWobbleFrequencyScale = 0.82f,
        )
    ),
    COSMIC(
        MotionProfilePreset(
            glowAlphaBase = 22f,
            glowAlphaRange = 34f,
            glowAlphaMultiplier = 1f,
            glowAlphaClamp = 72,
            glowRadiusBase = 0.09f,
            glowRadiusRange = 0.045f,
            glowWidthScale = 1f,
            glowBandStartScale = 1.15f,
            glowBandEndScale = 0.65f,
            glowFadeScale = 0.95f,
            glowShadowBoost = 1.75f,
            glowShadowClamp = 110,
            starDustCount = 4,
            starDustAlphaBase = 28f,
            starDustAlphaRange = 52f,
            starDustAlphaMultiplier = 1f,
            starDustAlphaClamp = 96,
            starDustOrbitXBase = 0.55f,
            starDustOrbitXRange = 0.35f,
            starDustOrbitYBase = 0.12f,
            starDustOrbitYRange = 0.08f,
            starDustShadowRadius = 0.055f,
            starDustShadowBoost = 2.1f,
            starDustShadowClamp = 110,
            starDustPhaseSpeed = 6.2f,
            starDustPhaseStep = 1.37f,
            starDustLocalAlphaBase = 0.92f,
            starDustLocalAlphaDrop = 0.14f,
            starDustLocalAlphaClamp = 90,
            starDustWaveBase = 1.08f,
            starDustWaveStep = 0.06f,
            starDustRadiusBase = 1.15f,
            starDustRadiusRange = 0.95f,
            starDustRadiusDrop = 0.16f,
            starDustMinRadius = 0.6f,
            starDustDriftStepX = 1.2f,
            starDustDriftStepY = 1.6f,
            particleBucketScale = 1f,
            particleEmissionLow = 1,
            particleEmissionHigh = 2,
            particleSpreadX = 1f,
            particleSpreadY = 1f,
            particleLifetimeBaseMs = 1200L,
            particleLifetimeRangeMs = 900f,
            particleLifetimeMinMs = 1200L,
            particleLifetimeMaxMs = 2200L,
            particleAlphaMultiplier = 1f,
            particleAlphaClamp = 130,
            particleRadiusScale = 1f,
            particleBlurScale = 1f,
            particleOffsetXScale = 1f,
            particleOffsetYScale = 1f,
            particleDriftXScale = 1f,
            particleRiseScale = 1f,
            particleWobbleAmplitudeScale = 1f,
            particleWobbleFrequencyScale = 1f,
        )
    );

    companion object {
        fun from(value: String?): MotionProfile {
            return when (value?.trim()?.lowercase()) {
                "ambient" -> AMBIENT
                "pulse" -> PULSE
                "fire" -> FIRE
                "velvet" -> VELVET
                else -> COSMIC
            }
        }
    }
}

data class MotionProfilePreset(
    val glowAlphaBase: Float,
    val glowAlphaRange: Float,
    val glowAlphaMultiplier: Float,
    val glowAlphaClamp: Int,
    val glowRadiusBase: Float,
    val glowRadiusRange: Float,
    val glowWidthScale: Float,
    val glowBandStartScale: Float,
    val glowBandEndScale: Float,
    val glowFadeScale: Float,
    val glowShadowBoost: Float,
    val glowShadowClamp: Int,
    val starDustCount: Int,
    val starDustAlphaBase: Float,
    val starDustAlphaRange: Float,
    val starDustAlphaMultiplier: Float,
    val starDustAlphaClamp: Int,
    val starDustOrbitXBase: Float,
    val starDustOrbitXRange: Float,
    val starDustOrbitYBase: Float,
    val starDustOrbitYRange: Float,
    val starDustShadowRadius: Float,
    val starDustShadowBoost: Float,
    val starDustShadowClamp: Int,
    val starDustPhaseSpeed: Float,
    val starDustPhaseStep: Float,
    val starDustLocalAlphaBase: Float,
    val starDustLocalAlphaDrop: Float,
    val starDustLocalAlphaClamp: Int,
    val starDustWaveBase: Float,
    val starDustWaveStep: Float,
    val starDustRadiusBase: Float,
    val starDustRadiusRange: Float,
    val starDustRadiusDrop: Float,
    val starDustMinRadius: Float,
    val starDustDriftStepX: Float,
    val starDustDriftStepY: Float,
    val particleBucketScale: Float,
    val particleEmissionLow: Int,
    val particleEmissionHigh: Int,
    val particleSpreadX: Float,
    val particleSpreadY: Float,
    val particleLifetimeBaseMs: Long,
    val particleLifetimeRangeMs: Float,
    val particleLifetimeMinMs: Long,
    val particleLifetimeMaxMs: Long,
    val particleAlphaMultiplier: Float,
    val particleAlphaClamp: Int,
    val particleRadiusScale: Float,
    val particleBlurScale: Float,
    val particleOffsetXScale: Float,
    val particleOffsetYScale: Float,
    val particleDriftXScale: Float,
    val particleRiseScale: Float,
    val particleWobbleAmplitudeScale: Float,
    val particleWobbleFrequencyScale: Float,
)
