package app.staysound.core.tidal

import org.json.JSONArray
import org.json.JSONObject

// Reads JSON the way the TypeScript did: a missing key and an explicit null are both "nullish" (`??`).

internal fun JSONObject.value(key: String): Any? = if (!has(key) || isNull(key)) null else get(key)
internal fun JSONObject.text(key: String): String? = value(key)?.let { if (it is String) it else it.toString() }
internal fun JSONObject.number(key: String): Number? = value(key) as? Number
internal fun JSONObject.long(key: String): Long? = number(key)?.toLong()
internal fun JSONObject.int(key: String): Int? = number(key)?.toInt()
internal fun JSONObject.double(key: String): Double? = number(key)?.toDouble()
internal fun JSONObject.flag(key: String): Boolean? = value(key) as? Boolean
internal fun JSONObject.obj(key: String): JSONObject? = value(key) as? JSONObject
internal fun JSONObject.array(key: String): JSONArray? = value(key) as? JSONArray
internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONArray.values(): List<Any?> = (0 until length()).map { if (isNull(it)) null else get(it) }

/** JavaScript truthiness of a parsed JSON value. */
internal fun truthy(value: Any?): Boolean = when (value) {
    null, JSONObject.NULL -> false
    is Boolean -> value
    is Number -> value.toDouble().let { it != 0.0 && !it.isNaN() }
    is String -> value.isNotEmpty()
    else -> true
}

/** `a || b` for strings: an empty string is falsy too. */
internal fun String?.orElse(other: String?): String? = if (isNullOrEmpty()) other else this
