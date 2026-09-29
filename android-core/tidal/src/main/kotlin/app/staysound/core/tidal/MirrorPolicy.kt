package app.staysound.core.tidal

import org.json.JSONArray
import org.json.JSONObject

enum class MirrorCapability { SEARCH, STREAM, DOWNLOAD }
enum class MirrorCategory { API, STREAMING }
enum class MirrorStatus { AVAILABLE, SLOW, UNAVAILABLE }
enum class CatalogSource { STATIC, REMOTE }

data class MirrorCatalogEntry(
    val baseUrl: String,
    val provider: String = "tidal",
    val enabled: Boolean = true,
    val priority: Int = 999,
    val supportsSearch: Boolean = true,
    val supportsStream: Boolean = true,
    val supportsDownload: Boolean = true,
    val status: MirrorStatus = MirrorStatus.AVAILABLE,
    val latencyMs: Double? = null,
    val lastCheckedAt: Long? = null,
    val lastError: String? = null,
    val source: CatalogSource = CatalogSource.STATIC,
)

data class MirrorCatalog(
    /** Mirrors that can search, best first. */
    val api: List<MirrorCatalogEntry>,
    /** Mirrors that can stream or download, best first. */
    val streaming: List<MirrorCatalogEntry>,
    val all: List<MirrorCatalogEntry>,
    val source: CatalogSource,
)

/** Port of `src/services/tidal/mirrorPolicy.ts`: which responses trigger a fallback and how the mirror catalog is built. */
object MirrorPolicy {
    private val proxyHosts = listOf("geeked.wtf", "kinoplus.online", "monochrome.tf", "monochrome-api.samidy.com", "qqdl.site",
        "hifi.monochrome.tf", "arran.monochrome.tf", "music.binimum.org")
    private val proxyFailureMarkers = listOf("requiresauth", "logged-in users only", "query parameter is required",
        "internal server error", "upstream api error", "upstream error")
    private val trailingSlashes = Regex("/+$")
    private val httpUrl = Regex("^https?://", RegexOption.IGNORE_CASE)
    private val squid = Regex("\\.squid\\.wtf", RegexOption.IGNORE_CASE)

    fun isProxyMirror(base: String) = proxyHosts.any { base.contains(it) }

    fun isReachableStatus(status: Int) = status < 500 || status == 401 || status == 403 || status == 404 || status == 405

    /** Should the caller try the next mirror instead of surfacing this response? */
    fun shouldFallback(base: String, status: Int, body: String): Boolean {
        if (status == 429) return true
        if (status >= 500 || (status == 404 && base.contains("music.binimum.org"))) return true
        if (!isProxyMirror(base)) return false
        if (status == 401 || status == 403) return true
        val lowered = body.lowercase()
        return proxyFailureMarkers.any { lowered.contains(it) }
    }

    fun isHtmlResponse(contentType: String?, body: String): Boolean {
        val trimmed = body.trimStart()
        return (contentType ?: "").lowercase().contains("text/html") || trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")
    }

    fun isCapabilitySupported(entry: MirrorCatalogEntry?, capability: MirrorCapability): Boolean = when {
        entry == null -> true
        capability == MirrorCapability.STREAM -> entry.supportsStream
        capability == MirrorCapability.DOWNLOAD -> entry.supportsDownload
        else -> entry.supportsSearch
    }

    fun capabilityErrorMessage(capability: MirrorCapability) = when (capability) {
        MirrorCapability.DOWNLOAD -> "El mirror seleccionado no soporta descargas en este momento."
        MirrorCapability.STREAM -> "El mirror seleccionado no soporta reproduccion en este momento."
        MirrorCapability.SEARCH -> "El mirror seleccionado no soporta busqueda y metadata en este momento."
    }

    /** A URL from the uptime catalog, or null when it is not an http(s) mirror we may use. */
    fun normalizeCatalogUrl(value: Any?): String? {
        val raw = when (value) {
            is String -> value
            is JSONObject -> if (value.has("url")) (value.opt("url").takeUnless { it == JSONObject.NULL } ?: "").toString() else ""
            else -> ""
        }
        val normalized = raw.trim().replace(trailingSlashes, "")
        if (!httpUrl.containsMatchIn(normalized)) return null
        if (squid.containsMatchIn(normalized)) return null
        return normalized
    }

    /** `{...existing, ...next}` with the capability flags and priority combined: the newer entry wins everything else. */
    fun merge(existing: MirrorCatalogEntry?, next: MirrorCatalogEntry): MirrorCatalogEntry = if (existing == null) next else next.copy(
        supportsSearch = existing.supportsSearch || next.supportsSearch,
        supportsStream = existing.supportsStream || next.supportsStream,
        supportsDownload = existing.supportsDownload || next.supportsDownload,
        priority = minOf(existing.priority, next.priority),
        enabled = existing.enabled || next.enabled,
    )

    fun catalogOf(entries: List<MirrorCatalogEntry>, source: CatalogSource = CatalogSource.STATIC): MirrorCatalog {
        val sorted = entries.sortedBy { it.priority }
        return MirrorCatalog(
            api = sorted.filter { it.supportsSearch },
            streaming = sorted.filter { it.supportsStream || it.supportsDownload },
            all = sorted,
            source = source,
        )
    }

    private fun entryFromRemote(item: Any?, category: MirrorCategory, index: Int): MirrorCatalogEntry? {
        val baseUrl = normalizeCatalogUrl(item) ?: return null
        val source = item as? JSONObject ?: JSONObject()
        val enabled = !(source.opt("enabled") == false || source.opt("ok") == false || source.opt("online") == false ||
            source.opt("status") == "offline" || source.opt("status") == "down")
        val isApi = category == MirrorCategory.API
        val isStreaming = category == MirrorCategory.STREAMING
        return MirrorCatalogEntry(
            baseUrl = baseUrl,
            enabled = enabled,
            priority = (if (isApi) 100 else if (isStreaming) 200 else 300) + index * 10,
            supportsSearch = isApi || truthy(source.opt("supportsSearch")),
            supportsStream = isStreaming || truthy(source.opt("supportsStream")),
            supportsDownload = isStreaming || truthy(source.opt("supportsDownload")),
            status = if (enabled) MirrorStatus.AVAILABLE else MirrorStatus.UNAVAILABLE,
            latencyMs = source.opt("ms").let { if (it is Number) it.toDouble() else null },
            lastError = if (enabled) null else "Disabled by uptime catalog",
            source = CatalogSource.REMOTE,
        )
    }

    /** The mirror roster published by the uptime workers, or null when it lists no usable mirror. */
    fun fromRemotePayload(payload: Any?): MirrorCatalog? {
        val source = payload as? JSONObject ?: return null
        val combined = LinkedHashMap<String, MirrorCatalogEntry>()
        fun add(entry: MirrorCatalogEntry?) { if (entry != null) combined[entry.baseUrl] = merge(combined[entry.baseUrl], entry) }
        for (category in listOf(MirrorCategory.API to "api", MirrorCategory.STREAMING to "streaming")) {
            (source.opt(category.second) as? JSONArray)?.values()?.forEachIndexed { index, item -> add(entryFromRemote(item, category.first, index)) }
        }
        val everything = listOf("instances", "mirrors", "data").map { source.opt(it) }.firstOrNull { it != null && it != JSONObject.NULL }
        (everything as? JSONArray)?.values()?.forEachIndexed { index, item -> add(entryFromRemote(item, MirrorCategory.API, index)) }
        val usable = combined.values.filter { it.enabled }
        return if (usable.isEmpty()) null else catalogOf(usable, CatalogSource.REMOTE)
    }

    /** What the app falls back to when the uptime catalog cannot be fetched. */
    fun staticCatalog(): MirrorCatalog {
        val combined = LinkedHashMap<String, MirrorCatalogEntry>()
        TidalMirrors.API_BASES.forEachIndexed { index, baseUrl ->
            combined[baseUrl] = merge(combined[baseUrl], MirrorCatalogEntry(baseUrl, priority = 100 + index * 10,
                supportsSearch = true, supportsStream = false, supportsDownload = false))
        }
        TidalMirrors.STREAMING_BASES.forEachIndexed { index, baseUrl ->
            combined[baseUrl] = merge(combined[baseUrl], MirrorCatalogEntry(baseUrl, priority = 200 + index * 10,
                supportsSearch = false, supportsStream = true, supportsDownload = true))
        }
        return catalogOf(combined.values.toList())
    }
}
