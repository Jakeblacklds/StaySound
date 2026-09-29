package expo.modules.androidshell

import java.net.URI
import java.net.URLDecoder
import org.json.JSONArray
import org.json.JSONObject

/** The only route stack on Android. Contains no catalog, playback or persisted business state. */
data class Destination(val path: String, val arguments: Map<String, String> = emptyMap()) {
    val tab get() = path.takeIf { it in tabs }
    fun json() = JSONObject().put("path", path).put("arguments", JSONObject(arguments))
    companion object {
        val tabs = listOf("/", "/library", "/tidal", "/playlists", "/settings")
        private val screens = setOf("/equalizer", "/onboarding", "/lyrics", "/player", "/modal", "/playlist-create")
        private val details = setOf("artist", "album", "playlist", "tidal-artist", "tidal-album", "tidal-playlist", "tidal-genre")
        fun parse(raw: String): Destination? = runCatching {
            val uri = URI(raw)
            val scheme = uri.scheme
            if (scheme != null && scheme !in setOf("staysound", "exp+staysound", "exp", "exps")) return null
            val path = if (scheme in setOf("staysound", "exp+staysound")) {
                "/" + listOfNotNull(uri.rawAuthority, uri.rawPath?.trimStart('/')).filter { it.isNotEmpty() }.joinToString("/")
            } else if (scheme != null) uri.rawPath?.substringAfter("/--/", "") ?: "" else uri.rawPath ?: "/"
            val segments = path.split('/').filter { it.isNotEmpty() }.map { decode(it) }.filter { it != "(tabs)" }
            val args = linkedMapOf<String, String>()
            uri.rawQuery?.split('&')?.filter { it.isNotEmpty() }?.forEach {
                args[URLDecoder.decode(it.substringBefore('='), "UTF-8")] = URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
            }
            var canonical = "/" + segments.joinToString("/")
            if (canonical == "/index") canonical = "/"
            if (canonical == "/search") canonical = "/tidal"
            if (canonical == "/notification.click") canonical = "/player"
            when {
                canonical in tabs || canonical in screens -> Destination(canonical, args)
                segments.size == 2 && segments[0] in details && segments[1].isNotBlank() -> {
                    args["id"] = segments[1] // Path identity wins over a query parameter.
                    Destination("/${segments[0]}/[id]", args)
                }
                else -> null
            }
        }.getOrNull()
        private fun decode(value: String) = URLDecoder.decode(value.replace("+", "%2B"), "UTF-8")
        fun fromJson(value: JSONObject): Destination? {
            val path = value.optString("path")
            val args = value.optJSONObject("arguments") ?: JSONObject()
            val map = args.keys().asSequence().associateWith { args.getString(it) }
            val concrete = path.replace("[id]", java.net.URLEncoder.encode(map["id"].orEmpty(), "UTF-8").replace("+", "%20"))
            return parse(concrete)?.copy(arguments = map)
        }
    }
}

data class RouteEntry(val key: String, val destination: Destination) {
    fun json() = destination.json().put("key", key)
}

class NavigationState {
    private var serial = 0L
    private fun entry(destination: Destination) = RouteEntry("route-${++serial}", destination)
    private val roots = linkedMapOf("/" to entry(Destination("/")))
    private val history = mutableListOf("/")
    private val stack = mutableListOf<RouteEntry>()
    private var gate: RouteEntry? = null
    var onboardingRequired = false; private set
    val activeTab get() = history.last()
    val current get() = gate ?: stack.lastOrNull() ?: roots.getValue(activeTab)
    val entries get() = roots.values.toList() + stack + listOfNotNull(gate)
    val canGoBack get() = gate == null && (stack.isNotEmpty() || history.size > 1)
    val contentKey get() = if (current.destination.path == "/player") (stack.dropLast(1).lastOrNull() ?: roots.getValue(activeTab)).key else current.key
    val showBar get() = gate == null && stack.isEmpty()
    fun setOnboarding(required: Boolean) {
        onboardingRequired = required
        if (required && gate == null) gate = entry(Destination("/onboarding"))
        if (!required) { gate = null; if (stack.lastOrNull()?.destination?.path == "/onboarding") stack.removeAt(stack.lastIndex) }
    }
    fun navigate(destination: Destination, mode: String = "push") {
        if (destination.path == "/onboarding" && onboardingRequired) return
        // A completion callback must not erase a deep link waiting behind onboarding.
        if (gate != null && destination.path == "/" && mode == "replace") return
        val tab = destination.tab
        if (tab != null) {
            stack.clear()
            if (roots[tab] == null || ((destination.arguments.isNotEmpty() || mode == "replace") && roots[tab]?.destination != destination)) {
                roots[tab] = entry(destination)
            }
            history.remove(tab); history.add(tab)
            return
        }
        if (mode == "replace" && stack.isNotEmpty()) stack.removeAt(stack.lastIndex)
        if (mode == "navigate") {
            val found = stack.indexOfLast { it.destination == destination }
            if (found >= 0) { while (stack.lastIndex > found) stack.removeAt(stack.lastIndex); return }
        }
        if (current.destination == destination) return
        stack.add(entry(destination))
    }
    fun back(): Boolean {
        if (!canGoBack) return false
        if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) else history.removeAt(history.lastIndex)
        return true
    }
    fun player(visible: Boolean) {
        if (visible && current.destination.path != "/player") navigate(Destination("/player"), "navigate")
        if (!visible && stack.lastOrNull()?.destination?.path == "/player") stack.removeAt(stack.lastIndex)
    }
    fun snapshot() = JSONObject().put("version", 1).put("serial", serial)
        .put("roots", JSONArray(roots.values.map { it.json() })).put("history", JSONArray(history))
        .put("stack", JSONArray(stack.map { it.json() })).put("gate", gate?.json())
        .put("onboardingRequired", onboardingRequired).put("activeTab", activeTab)
        .put("current", current.json()).put("contentKey", contentKey).put("canGoBack", canGoBack)
        .put("showBar", showBar).put("entries", JSONArray(entries.map { it.json() })).toString()
    companion object {
        fun restore(raw: String?): NavigationState = runCatching {
            val json = JSONObject(raw ?: return NavigationState())
            require(json.getInt("version") == 1)
            val result = NavigationState()
            fun read(array: JSONArray) = (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                RouteEntry(item.getString("key"), requireNotNull(Destination.fromJson(item)))
            }
            val roots = read(json.getJSONArray("roots")); require(roots.isNotEmpty() && roots.all { it.destination.tab != null })
            result.roots.clear(); roots.forEach { result.roots[it.destination.path] = it }
            result.history.clear()
            val history = json.getJSONArray("history")
            for (i in 0 until history.length()) result.history.add(history.getString(i).also { require(it in result.roots) })
            require(result.history.isNotEmpty() && result.history.distinct().size == result.history.size)
            result.stack.addAll(read(json.getJSONArray("stack")))
            result.serial = json.getLong("serial")
            require(result.serial >= result.entries.size)
            result.onboardingRequired = json.optBoolean("onboardingRequired")
            json.optJSONObject("gate")?.let { result.gate = RouteEntry(it.getString("key"), requireNotNull(Destination.fromJson(it))) }
            require(result.entries.map { it.key }.distinct().size == result.entries.size)
            result
        }.getOrElse { NavigationState() }
    }
}
