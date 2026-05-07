package expo.modules.karaokeview

internal enum class HighlightPhase {
    PRE,
    ACTIVE,
    SETTLED,
    RELEASE,
}

internal data class HighlightState(
    val phase: HighlightPhase,
    val growEnvelope: Float,
    val peakEnvelope: Float,
    val holdEnvelope: Float,
    val glowEnvelope: Float,
)

internal object KaraokeHighlightStateMachine {
    fun resolve(progress: Float, sustained: Boolean, smootherStep: (Float) -> Float): HighlightState {
        val clamped = progress.coerceAtLeast(0f)
        val activeProgress = clamped.coerceIn(0f, 1f)
        val growEnvelope = smootherStep(activeProgress)

        if (!sustained) {
            val phase = when {
                progress < 0f -> HighlightPhase.PRE
                progress < 1f -> HighlightPhase.ACTIVE
                progress < 1.06f -> HighlightPhase.SETTLED
                else -> HighlightPhase.RELEASE
            }
            val settledFade = ((1.06f - progress) / 0.06f).coerceIn(0f, 1f)
            return HighlightState(
                phase = phase,
                growEnvelope = when (phase) {
                    HighlightPhase.SETTLED -> settledFade
                    HighlightPhase.RELEASE -> 0f
                    else -> growEnvelope
                },
                peakEnvelope = when (phase) {
                    HighlightPhase.SETTLED -> settledFade
                    HighlightPhase.RELEASE -> 0f
                    else -> growEnvelope
                },
                holdEnvelope = when (phase) {
                    HighlightPhase.SETTLED -> settledFade
                    HighlightPhase.RELEASE -> 0f
                    else -> growEnvelope
                },
                glowEnvelope = if (phase == HighlightPhase.ACTIVE) growEnvelope else 0f,
            )
        }

        val riseWindow = 0.30f
        val rise = smootherStep((activeProgress / riseWindow).coerceIn(0f, 1f))
        val settle = smootherStep(((activeProgress - riseWindow) / (1f - riseWindow)).coerceIn(0f, 1f))
        val peakEnvelope = (rise * (1f - settle)).coerceIn(0f, 1f)
        val holdEnvelope = smootherStep((activeProgress / 0.34f).coerceIn(0f, 1f))
        val phase = when {
            progress < 0f -> HighlightPhase.PRE
            progress < 1f -> HighlightPhase.ACTIVE
            progress < 1.08f -> HighlightPhase.SETTLED
            else -> HighlightPhase.RELEASE
        }
        val settledFade = ((1.08f - progress) / 0.08f).coerceIn(0f, 1f)
        val settledGrow = settledFade * 0.30f

        return HighlightState(
            phase = phase,
            growEnvelope = when (phase) {
                HighlightPhase.SETTLED -> settledGrow
                HighlightPhase.RELEASE -> 0f
                else -> growEnvelope
            },
            peakEnvelope = when (phase) {
                HighlightPhase.SETTLED -> 0f
                HighlightPhase.RELEASE -> 0f
                else -> peakEnvelope
            },
            holdEnvelope = when (phase) {
                HighlightPhase.SETTLED -> settledGrow
                HighlightPhase.RELEASE -> 0f
                else -> holdEnvelope
            },
            glowEnvelope = when (phase) {
                HighlightPhase.ACTIVE -> peakEnvelope
                else -> 0f
            },
        )
    }

    fun shouldRenderWipeShader(progress: Float): Boolean = progress < 1f
}
