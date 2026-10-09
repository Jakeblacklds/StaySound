package app.staysound.core.model

/** File-name rules shared by scanning (matching a file to a stored track) and downloading (naming it). */
object Filenames {
    private val reserved = Regex("[<>:\"/\\\\|?*]")
    private val spaces = Regex("[${JsText.SPACE_CLASS}]+")

    /** `sanitizeFilename` in `src/services/audioUtils.ts`. */
    fun sanitize(input: String): String = input.replace(reserved, "_").replace(spaces, " ").let(JsText::trim).take(160)
}
