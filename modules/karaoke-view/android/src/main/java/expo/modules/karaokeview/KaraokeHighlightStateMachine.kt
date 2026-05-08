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

        // riseWindow: how much of the [0,1] progress is spent on the peak bounce.
        // 0.22 feels snappier (Apple Music-like) vs 0.26 which was sluggish.
        val riseWindow = 0.22f
        val rise = smootherStep((activeProgress / riseWindow).coerceIn(0f, 1f))
        val settle = smootherStep(((activeProgress - riseWindow) / (1f - riseWindow)).coerceIn(0f, 1f))
        val peakEnvelope = (rise * (1f - settle)).coerceIn(0f, 1f)
        // holdEnvelope reaches 1.0 quickly and stays there for the entire note duration.
        // This is what Apple Music / Binimum do: glow stays ON the whole sustained note.
        val holdEnvelope = smootherStep((activeProgress / 0.38f).coerceIn(0f, 1f))
        val phase = when {
            progress < 0f -> HighlightPhase.PRE
            progress < 1f -> HighlightPhase.ACTIVE
            progress < 1.16f -> HighlightPhase.SETTLED
            else -> HighlightPhase.RELEASE
        }
        val settledFade = ((1.16f - progress) / 0.16f).coerceIn(0f, 1f)
        val settledPeak = settledFade * 0.18f

        return HighlightState(
            phase = phase,
            growEnvelope = when (phase) {
                HighlightPhase.SETTLED -> settledFade * 0.44f
                HighlightPhase.RELEASE -> 0f
                else -> growEnvelope
            },
            peakEnvelope = when (phase) {
                HighlightPhase.SETTLED -> settledPeak
                HighlightPhase.RELEASE -> 0f
                else -> peakEnvelope
            },
            // holdEnvelope stays at 1.0 after settling so characters maintain
            // the same final lift position as non-sustained completed words.
            holdEnvelope = when (phase) {
                HighlightPhase.SETTLED -> 1f
                HighlightPhase.RELEASE -> 1f
                else -> holdEnvelope
            },
            // KEY FIX: drive glow with holdEnvelope (stays at 1.0 during the whole note)
            // NOT peakEnvelope (which peaks and then drops to 0 mid-note).
            glowEnvelope = when (phase) {
                HighlightPhase.ACTIVE -> holdEnvelope
                HighlightPhase.SETTLED -> settledFade * 0.28f
                else -> 0f
            },
        )
    }

    fun shouldRenderWipeShader(progress: Float): Boolean = progress < 1f
}
