package expo.modules.libraryview

import java.text.Collator
import java.text.Normalizer
import java.util.Locale
import org.json.JSONObject

internal data class LibraryEntry(
    val id: String,
    val kind: String,
    val title: String,
    val subtitle: String,
    val artwork: String,
    val fallbackArtwork: String,
    val duration: Long,
    val favorite: Boolean,
    val count: Int,
    val searchKey: String,
    val playback: PlaybackTrack? = null,
) {
    /**
     * The bridge keeps the small thumbnail in artwork and the original in
     * fallbackArtwork. Library renders the original first and Glide downsamples it
     * to the view bounds, retaining the thumbnail only as a resilient fallback.
     */
    val displayArtwork: String get() = fallbackArtwork.ifEmpty { artwork }
    val fallbackThumbnail: String get() = artwork.takeUnless { it == displayArtwork }.orEmpty()
}

internal data class LibraryPlaylist(val id: String, val name: String)

internal data class LibraryCatalog(
    val songs: List<LibraryEntry> = emptyList(),
    val albums: List<LibraryEntry> = emptyList(),
    val artists: List<LibraryEntry> = emptyList(),
    val playlists: List<LibraryPlaylist> = emptyList(),
) {
    fun entries(tab: String): List<LibraryEntry> = when (tab) {
        "albums" -> albums
        "artists" -> artists
        else -> songs
    }

    fun search(tab: String, query: String): List<LibraryEntry> {
        val entries = entries(tab)
        val key = normalize(query)
        return if (key.isEmpty()) entries else entries.filter {
            if (Thread.currentThread().isInterrupted) throw InterruptedException()
            it.searchKey.contains(key)
        }
    }

    companion object {
        private val accents = Regex("\\p{M}+")
        fun normalize(value: String): String = accents.replace(
            Normalizer.normalize(value, Normalizer.Form.NFD), ""
        ).lowercase(Locale.ROOT).trim()

        // Called on a worker. No JSON parsing, sorting or filtering in onBindViewHolder.
        fun parse(json: String, locale: Locale): LibraryCatalog {
            val root = JSONObject(json)
            val collator = Collator.getInstance(locale)
            fun entries(kind: String): List<LibraryEntry> {
                val array = root.optJSONArray(kind) ?: return emptyList()
                val seen = HashSet<String>()
                val result = ArrayList<LibraryEntry>(array.length())
                for (index in 0 until array.length()) {
                    if (Thread.currentThread().isInterrupted) throw InterruptedException()
                    val item = array.getJSONObject(index)
                    val id = item.getString("id")
                    if (!seen.add(id)) continue
                    val title = item.optString("title")
                    val subtitle = item.optString("subtitle")
                    result.add(LibraryEntry(
                        id, kind, title, subtitle, item.optString("artwork"),
                        item.optString("fallbackArtwork"), item.optLong("duration"),
                        item.optBoolean("favorite"), item.optInt("count"),
                        normalize("$title $subtitle"),
                        if (kind == "songs") PlaybackTrack.parse(item) else null,
                    ))
                }
                // Album order remains the store's order, as in the existing library.
                return if (kind == "albums") result else result.sortedWith { a, b ->
                    collator.compare(a.title, b.title).takeIf { it != 0 } ?: a.id.compareTo(b.id)
                }
            }
            val playlists = root.optJSONArray("playlists")
            return LibraryCatalog(entries("songs"), entries("albums"), entries("artists"),
                (0 until (playlists?.length() ?: 0)).map { index ->
                    val item = playlists!!.getJSONObject(index)
                    LibraryPlaylist(item.getString("id"), item.getString("name"))
                })
        }
    }
}
