package expo.modules.equalizerview

/** UI boundary only; DSP remains in the existing StaySoundEqualizer module. */
internal object EqualizerPolicy {
    fun level(value: Float, min: Float, max: Float): Float {
        val low = min.coerceAtMost(max)
        val high = max.coerceAtLeast(min)
        return if (value.isFinite()) value.coerceIn(low, high) else 0f.coerceIn(low, high)
    }
    fun mode(value: String?) = if (value in listOf("off", "app", "system")) value!! else "off"
    fun nativePresetIndex(value: String?, available: Set<Int>): Int? =
        value?.removePrefix("native:")?.takeIf { value.startsWith("native:") }?.toIntOrNull()?.takeIf { it in available }
}
