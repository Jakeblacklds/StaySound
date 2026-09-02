package expo.modules.karaokeview

internal enum class LyricsTypography(
    val id: String,
    val assetPath: String,
    val fallbackFamily: String,
    val weight: Int,
    val variationSettings: String,
    val fontScale: Float,
    val lineHeight: Float,
    val letterSpacingEm: Float,
    val wipeWidthEm: Float,
    val preWipeDistanceEm: Float,
    val foregroundLiftRatio: Float,
) {
    NEWSREADER(
        id = "newsreader",
        assetPath = "fonts/Newsreader-Variable.ttf",
        fallbackFamily = "serif",
        weight = 700,
        variationSettings = "'opsz' 32, 'wght' 700",
        fontScale = 1.00f,
        lineHeight = 1.20f,
        letterSpacingEm = 0f,
        wipeWidthEm = 0.78f,
        preWipeDistanceEm = 0.39f,
        foregroundLiftRatio = 0.037f,
    ),
    CLASSIC(
        id = "classic",
        assetPath = "fonts/Inter-Variable.ttf",
        fallbackFamily = "sans-serif",
        weight = 700,
        variationSettings = "'opsz' 32, 'wght' 700",
        fontScale = 1.00f,
        lineHeight = 1.18f,
        letterSpacingEm = -0.01f,
        wipeWidthEm = 0.70f,
        preWipeDistanceEm = 0.35f,
        foregroundLiftRatio = 0.034f,
    ),
    SYNE(
        id = "syne",
        assetPath = "fonts/Syne-Variable.ttf",
        fallbackFamily = "sans-serif",
        weight = 700,
        variationSettings = "'wght' 700",
        fontScale = 0.95f,
        lineHeight = 1.16f,
        letterSpacingEm = -0.012f,
        wipeWidthEm = 0.68f,
        preWipeDistanceEm = 0.34f,
        foregroundLiftRatio = 0.032f,
    ),
    GROTESK(
        id = "grotesk",
        assetPath = "fonts/SpaceGrotesk-Variable.ttf",
        fallbackFamily = "sans-serif",
        weight = 700,
        variationSettings = "'wght' 700",
        fontScale = 0.98f,
        lineHeight = 1.18f,
        letterSpacingEm = -0.008f,
        wipeWidthEm = 0.70f,
        preWipeDistanceEm = 0.35f,
        foregroundLiftRatio = 0.034f,
    ),
    FRAUNCES(
        id = "fraunces",
        assetPath = "fonts/Fraunces-Variable.ttf",
        fallbackFamily = "serif",
        weight = 700,
        variationSettings = "'SOFT' 50, 'WONK' 1, 'opsz' 32, 'wght' 700",
        fontScale = 1.01f,
        lineHeight = 1.21f,
        letterSpacingEm = -0.004f,
        wipeWidthEm = 0.80f,
        preWipeDistanceEm = 0.40f,
        foregroundLiftRatio = 0.038f,
    ),
    NUNITO(
        id = "nunito",
        assetPath = "fonts/Nunito-Variable.ttf",
        fallbackFamily = "sans-serif-rounded",
        weight = 750,
        variationSettings = "'wght' 750",
        fontScale = 0.99f,
        lineHeight = 1.17f,
        letterSpacingEm = -0.006f,
        wipeWidthEm = 0.72f,
        preWipeDistanceEm = 0.36f,
        foregroundLiftRatio = 0.033f,
    );

    val backgroundLiftRatio: Float
        get() = foregroundLiftRatio * 0.72f

    companion object {
        fun from(value: String?): LyricsTypography =
            entries.firstOrNull { it.id == value?.trim()?.lowercase() } ?: CLASSIC
    }
}
