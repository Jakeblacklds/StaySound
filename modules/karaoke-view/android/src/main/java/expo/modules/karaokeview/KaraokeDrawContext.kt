package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Paint

data class KaraokeAccentContext(
    val canvas: Canvas,
    val line: LyricLine,
    val words: List<LyricWord>,
    val sweepX: Float,
    val glowProgress: Float,
    val rowHeight: Float,
    val translateY: Float,
    val currentTimeMs: Long,
    val glowColor: Int,
    val density: Float,
    val marginLeft: Float,
    val sparklePaint: Paint,
    val preset: MotionProfilePreset,
    val leadingGlowWidthPx: Float,
)

data class KaraokeContinuousContext(
    val canvas: Canvas,
    val line: LyricLine,
    val words: List<LyricWord>,
    val currentTimeMs: Long,
    val rowHeight: Float,
    val translateY: Float,
    val glowColor: Int,
    val density: Float,
    val marginLeft: Float,
    val sparklePaint: Paint,
    val fireTrailFadeOutDurationMs: Float,
    val calculateContinuousSweepX: (List<LyricWord>, Long) -> Float,
    val smootherStep: (Float) -> Float,
)

interface MotionProfileRenderer {
    fun drawAccent(ctx: KaraokeAccentContext)
    fun drawContinuous(ctx: KaraokeContinuousContext)
}
