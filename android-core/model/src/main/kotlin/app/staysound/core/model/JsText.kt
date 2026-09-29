package app.staysound.core.model

import java.net.URLDecoder
import java.util.Locale

/**
 * The few JavaScript string/number behaviors the Kotlin ports of TypeScript code must reproduce exactly, so a port
 * cannot drift on Unicode whitespace, `decodeURIComponent` or `Math.round`.
 */
object JsText {
    /** Character-class body for JavaScript's `\s`: NBSP, BOM and the Unicode space separators count as whitespace. */
    const val SPACE_CLASS = "\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"

    fun isSpace(c: Char) = c in "\t\u000b\u000c  ﻿\n\r  " || Character.getType(c) == Character.SPACE_SEPARATOR.toInt()

    /** `String.prototype.trim` */
    fun trim(value: String) = value.trim { isSpace(it) }

    /** `String.prototype.toLowerCase` (locale independent). */
    fun lower(value: String) = value.lowercase(Locale.ROOT)

    /**
     * `decodeURIComponent`, except that a malformed escape returns the input unchanged instead of throwing
     * (a thrown URIError would abort a whole scan or request over one odd name). `+` stays a plus.
     */
    fun decodeUriComponent(value: String): String = try {
        URLDecoder.decode(value.replace("+", "%2B"), Charsets.UTF_8)
    } catch (_: IllegalArgumentException) { value }

    /** `Math.round`: halves round toward +infinity, unlike Kotlin's roundToLong (away from zero). */
    fun round(value: Double): Long = Math.floor(value + 0.5).toLong()
}
