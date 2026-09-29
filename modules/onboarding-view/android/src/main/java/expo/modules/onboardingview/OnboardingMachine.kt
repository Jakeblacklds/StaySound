package expo.modules.onboardingview

import org.json.JSONArray
import org.json.JSONObject

internal fun String.jsTrim() = trim { it.isWhitespace() || it == '\uFEFF' || it == '\u00A0' }
internal data class Artist(val id: Long?, val name: String, val artworkUrl: String = "", val seed: String = "") {
    fun json() = JSONObject().put("id", id).put("name", name).put("artworkUrl", artworkUrl).put("seed", seed)
    companion object {
        fun parse(value: JSONObject) = Artist(if (value.has("id") && !value.isNull("id")) value.optLong("id") else null,
            value.optString("name"), value.optString("artworkUrl"), value.optString("seed"))
        fun list(value: JSONArray?) = (0 until (value?.length() ?: 0)).map { parse(value!!.getJSONObject(it)) }
    }
}
internal data class Effect(val action: String, val id: Long, val payload: JSONObject = JSONObject())

/** Pure UI state machine. Storage, permission dialogs, scanning and network work are effects. */
internal class OnboardingMachine {
    enum class Step { welcome, profile, tasteArtists, permissions, ready, building }
    var step = Step.welcome; private set
    var name = ""
    var avatarUri = ""; private set
    var artists = emptyList<Artist>(); private set
    var query = ""; private set
    var search = emptyList<Artist>(); private set
    var quick = emptyList<Artist>(); private set
    var artistLoading = false; private set
    var searchQueued = false; private set
    var quickLoading = false; private set
    var error = ""; private set
    var granted = false; private set
    var finishing = false; private set
    var completed = false; private set
    var lastReply = 0L; private set
    private var serial = 0L
    private var searchId = -1L
    private var finishId = -1L
    private var quickAttempted = false
    private val artworkAttempted = mutableSetOf<Long>()
    val artwork = mutableMapOf<Long, String>()
    private val effects = mutableListOf<Effect>()
    val canContinue get() = !finishing && !completed && when (step) {
        Step.profile -> name.jsTrim().isNotEmpty()
        Step.tasteArtists -> artists.size >= 3
        Step.building -> false
        else -> true
    }
    val searching get() = query.jsTrim().length >= 2
    private fun emit(action: String, payload: JSONObject = JSONObject()): Long {
        val id = ++serial
        effects.add(Effect(action, id, payload)); return id
    }
    fun drainEffects(): List<Effect> = effects.toList().also { effects.clear() }
    fun advance(skip: Boolean = false) {
        if (finishing || completed) return
        if (skip && step != Step.profile && step != Step.tasteArtists) return
        if (!skip && !canContinue) return
        step = when (step) {
            Step.welcome -> Step.profile
            Step.profile -> Step.tasteArtists
            Step.tasteArtists -> Step.permissions
            Step.permissions -> Step.ready
            else -> return
        }
        enter()
    }
    fun enter() {
        if (step == Step.tasteArtists && !quickAttempted) {
            quickAttempted = true; quickLoading = true
            emit("quick", JSONObject().put("artists", JSONArray(artists.map { it.json() })))
        }
        if (step == Step.permissions) emit("checkPermission")
        resolveArtwork()
    }
    fun toggle(artist: Artist) {
        if (step != Step.tasteArtists || finishing) return
        if (artist.id == null) {
            if (artists.size < 8) emit("seed", JSONObject().put("name", artist.name))
            return
        }
        artists = if (artists.any { it.id == artist.id }) artists.filter { it.id != artist.id }
            else if (artists.size < 8) artists + artist else artists
        resolveArtwork()
    }
    fun setQuery(value: String) {
        query = value; searchId = -1; searchQueued = searching
        if (!searching) { search = emptyList(); error = ""; artistLoading = false }
    }
    fun searchNow() {
        if (!searching || !searchQueued) return
        searchQueued = false
        artistLoading = true; error = ""
        searchId = emit("search", JSONObject().put("query", query.jsTrim()))
    }
    fun pickAvatar(camera: Boolean) { emit("avatar", JSONObject().put("camera", camera)) }
    fun requestPermission() { emit("permission") }
    fun finish() {
        if (step != Step.ready || finishing || completed) return
        finishing = true
        if (artists.size >= 3) step = Step.building
        finishId = emit("finish", JSONObject().put("name", name).put("avatarUri", avatarUri)
            .put("artists", JSONArray(artists.map { it.json() })))
    }
    fun reply(reply: JSONObject) {
        val sequence = reply.optLong("sequence")
        if (sequence <= lastReply) return
        lastReply = sequence
        val id = reply.optLong("id")
        val data = reply.optJSONObject("data") ?: JSONObject()
        when (reply.optString("action")) {
            "search" -> if (id == searchId) {
                if (data.has("artists")) search = Artist.list(data.optJSONArray("artists"))
                error = data.optString("error"); artistLoading = false
            }
            "quick" -> {
                if (data.has("artists")) quick = Artist.list(data.optJSONArray("artists"))
                quickLoading = data.optBoolean("loading")
                if (data.has("error") && error.isEmpty()) error = data.optString("error")
            }
            "seed" -> {
                data.optJSONObject("artist")?.let {
                    val artist = Artist.parse(it)
                    // Original async seed action can settle after advancing; selection still applies.
                    artists = if (artists.any { a -> a.id == artist.id }) artists.filter { a -> a.id != artist.id }
                        else if (artists.size < 8) artists + artist else artists
                    search = search.filter { a -> a.id != artist.id }
                }
                if (data.has("error")) error = data.optString("error")
            }
            "artwork" -> if (data.optString("artworkUrl").isNotEmpty()) artwork[data.optLong("id")] = data.getString("artworkUrl")
            "avatar" -> if (data.optString("uri").isNotEmpty()) avatarUri = data.getString("uri")
            "permission", "checkPermission" -> if (data.has("granted")) granted = data.getBoolean("granted")
            "finish" -> if (id == finishId && finishing && !completed) {
                finishing = false
                if (data.optBoolean("success")) { completed = true; emit("completed") }
            }
        }
        resolveArtwork()
    }
    private fun resolveArtwork() {
        (artists + search + quick).forEach { artist ->
            val id = artist.id ?: return@forEach
            val url = artwork[id] ?: artist.artworkUrl
            if ((url.isEmpty() || url.contains("resources.tidal.com/images/")) && artworkAttempted.add(id)) {
                emit("artwork", artist.json())
            }
        }
    }
    fun snapshot(): String = JSONObject().put("step", step.name).put("name", name).put("avatarUri", avatarUri)
        .put("artists", JSONArray(artists.map { it.json() })).put("query", query)
        .put("search", JSONArray(search.map { it.json() })).put("quick", JSONArray(quick.map { it.json() }))
        .put("artistLoading", artistLoading).put("searchQueued", searchQueued).put("quickLoading", quickLoading).put("error", error)
        .put("granted", granted).put("finishing", finishing).put("completed", completed)
        .put("serial", serial).put("searchId", searchId).put("finishId", finishId).put("lastReply", lastReply)
        .put("quickAttempted", quickAttempted).put("artworkAttempted", JSONArray(artworkAttempted.toList()))
        .put("artwork", JSONObject(artwork.mapKeys { it.key.toString() })).toString()
    fun restore(raw: String) {
        val data = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
        step = runCatching { Step.valueOf(data.optString("step", "welcome")) }.getOrDefault(Step.welcome)
        name = data.optString("name"); avatarUri = data.optString("avatarUri")
        artists = Artist.list(data.optJSONArray("artists")); query = data.optString("query")
        search = Artist.list(data.optJSONArray("search")); quick = Artist.list(data.optJSONArray("quick"))
        searchQueued = data.optBoolean("searchQueued")
        artistLoading = data.optBoolean("artistLoading"); quickLoading = data.optBoolean("quickLoading")
        error = data.optString("error"); granted = data.optBoolean("granted")
        finishing = data.optBoolean("finishing"); completed = data.optBoolean("completed")
        serial = data.optLong("serial"); searchId = data.optLong("searchId", -1); finishId = data.optLong("finishId", -1)
        lastReply = data.optLong("lastReply"); quickAttempted = data.optBoolean("quickAttempted")
        artworkAttempted.clear(); artwork.clear(); effects.clear()
        data.optJSONArray("artworkAttempted")?.let { list -> (0 until list.length()).forEach { artworkAttempted.add(list.getLong(it)) } }
        data.optJSONObject("artwork")?.let { values -> values.keys().forEach { key -> key.toLongOrNull()?.let { artwork[it] = values.getString(key) } } }
    }
}
