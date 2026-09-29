package app.staysound.core.tidal

import app.staysound.core.model.JsText
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory
import org.xml.sax.InputSource

/**
 * Port of `src/features/tidal/data/dashManifestParser.ts`.
 *
 * It reproduces the TypeScript's behavior, including two consequences of xmldom returning "" (never null) for a missing
 * attribute, which make its `?? fallback` operators dead code: attributes are only ever read from the element itself
 * (a codec or MIME type declared only on the AdaptationSet reads as ""), and a SegmentTemplate without `startNumber`
 * yields just its initialization URL because `parseInt("")` is NaN. Fixing either would change which extension and which
 * segments a download gets, so it must be a deliberate, separately tested change made in both languages.
 */
object DashManifest {
    data class Selection(val urls: List<String>, val mimeType: String, val codecs: String, val sampleRate: Int?, val bitDepth: Int?)

    private data class Representation(val id: String, val codecs: String, val mimeType: String, val sampleRate: Int?, val bitDepth: Int?, val urls: List<String>)

    private val httpUrl = Regex("^https?://", RegexOption.IGNORE_CASE)
    private val leadingSlashes = Regex("^/+")
    private val numberToken = Regex("\\\$Number(%0(\\d+)d)?\\\$")
    private val flacId = Regex("FLAC,(\\d+),(\\d+)", RegexOption.IGNORE_CASE)
    private val leadingInt = Regex("^[${JsText.SPACE_CLASS}]*([+-]?\\d+)")

    /** `Number.parseInt(value, 10)`: the leading integer, or null (NaN) when there is none. */
    private fun parseInt(value: String?): Int? = value?.let { leadingInt.find(it)?.groupValues?.get(1)?.toLongOrNull()?.toInt() }

    fun resolveUrl(baseUrl: String, maybeRelative: String): String {
        if (maybeRelative.isEmpty()) return baseUrl
        if (httpUrl.containsMatchIn(maybeRelative)) return maybeRelative
        if (baseUrl.isEmpty()) return maybeRelative
        val base = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return base + maybeRelative.replace(leadingSlashes, "")
    }

    private fun mediaUrl(template: String, number: Int): String = numberToken.replace(template) { match ->
        val width = match.groupValues[2]
        if (width.isEmpty()) number.toString() else number.toString().padStart(width.toInt(), '0')
    }

    /** Segment repeat counts add up: `r` repeats, and a missing, negative or invalid `r` counts once. */
    private fun timelineCount(repeats: List<Int?>): Int = repeats.sumOf { if (it != null && it >= 0) it + 1 else 1 }

    private fun parse(xml: String) = try {
        val factory = DocumentBuilderFactory.newInstance()
        runCatching { factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }   // not every Android parser has it
        factory.newDocumentBuilder().parse(InputSource(StringReader(xml)))
    } catch (error: Exception) { null }

    private fun Element.descendants(name: String): List<Element> = getElementsByTagName(name).let { list -> (0 until list.length).map { list.item(it) as Element } }
    private fun Element.attr(name: String): String = getAttribute(name)   // "" when absent, exactly like xmldom

    private fun representationOf(representation: Element, adaptationSet: Element): Representation? {
        val template = representation.descendants("SegmentTemplate").firstOrNull() ?: adaptationSet.descendants("SegmentTemplate").firstOrNull() ?: return null
        val initialization = template.attr("initialization")
        val media = template.attr("media")
        val startNumber = parseInt(template.attr("startNumber"))
        val segmentCount = timelineCount(template.descendants("S").map { parseInt(it.attr("r")) })
        val baseUrlNode = representation.descendants("BaseURL").firstOrNull() ?: adaptationSet.descendants("BaseURL").firstOrNull()
        val baseUrl = baseUrlNode?.textContent?.let(JsText::trim).orEmpty()

        val urls = mutableListOf<String>()
        if (initialization.isNotEmpty()) urls += resolveUrl(baseUrl, initialization)
        if (media.isNotEmpty() && segmentCount > 0 && startNumber != null) {
            for (number in startNumber until startNumber + segmentCount) urls += resolveUrl(baseUrl, mediaUrl(media, number))
        }
        if (urls.isEmpty()) return null

        val id = representation.attr("id")
        val sampleRate = parseInt(representation.attr("audioSamplingRate"))?.takeIf { it > 0 }
        return Representation(id, representation.attr("codecs"), representation.attr("mimeType"), sampleRate,
            flacId.find(id)?.groupValues?.get(2)?.toIntOrNull(), urls)
    }

    private fun score(representation: Representation, quality: String): Int {
        val id = representation.id.uppercase()
        val codecs = JsText.lower(representation.codecs)
        val sampleRate = representation.sampleRate ?: 0
        val bitDepth = representation.bitDepth ?: 0
        return when (quality) {
            "LOW" -> if (id.contains("HEAACV1")) 100 else if (id.contains("AACLC")) 50 else 0
            "HIGH" -> if (id.contains("AACLC")) 100 else if (id.contains("HEAACV1")) 50 else 0
            "LOSSLESS" -> if (codecs.contains("flac")) 1000 + sampleRate + bitDepth else if (id.contains("AACLC")) 50 else 0
            "HI_RES_LOSSLESS" -> if (codecs.contains("flac")) 1000 + sampleRate + bitDepth * 10 else 0
            else -> 0
        }
    }

    /** The best audio representation for [quality]. Throws when the manifest yields no segment URLs. */
    fun parseForQuality(manifestXml: String, quality: String): Selection {
        val document = parse(manifestXml)
        val representations = mutableListOf<Representation>()
        for (adaptationSet in document?.documentElement?.descendants("AdaptationSet").orEmpty()) {
            if (!JsText.lower(adaptationSet.attr("mimeType")).contains("audio")) continue
            adaptationSet.descendants("Representation").mapNotNullTo(representations) { representationOf(it, adaptationSet) }
        }
        val selected = representations.sortedByDescending { score(it, quality) }.firstOrNull()
            ?: throw IllegalStateException("Tidal DASH manifest did not produce segment URLs")
        return Selection(selected.urls, selected.mimeType, selected.codecs, selected.sampleRate, selected.bitDepth)
    }

    private val baseUrlTag = Regex("<BaseURL>([^<]+)</BaseURL>", RegexOption.IGNORE_CASE)
    private val listInit = Regex("<SegmentList[^>]*\\binitialization=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
    private val listUrl = Regex("<SegmentURL[^>]*\\bmedia=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
    private val templateTag = Regex("<SegmentTemplate[^>]*>", RegexOption.IGNORE_CASE)
    private val initAttr = Regex("\\binitialization=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
    private val mediaAttr = Regex("\\bmedia=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
    private val startAttr = Regex("\\bstartNumber=\"(\\d+)\"", RegexOption.IGNORE_CASE)
    private val timelineS = Regex("<S\\b([^>]*)/?[${JsText.SPACE_CLASS}]*>", RegexOption.IGNORE_CASE)
    private val repeatAttr = Regex("\\br=\"(-?\\d+)\"", RegexOption.IGNORE_CASE)
    private val absoluteUrl = Regex("https?://[^\"'${JsText.SPACE_CLASS}<]+", RegexOption.IGNORE_CASE)

    /** The older, regex-based reader: SegmentList, SegmentTemplate or, failing both, every absolute URL in the text. */
    fun parseUrls(manifestXml: String): List<String> {
        val baseUrl = baseUrlTag.find(manifestXml)?.groupValues?.get(1)?.let(JsText::trim).orEmpty()

        val segmentUrls = listUrl.findAll(manifestXml).map { it.groupValues[1] }.toList()
        if (segmentUrls.isNotEmpty()) {
            val urls = segmentUrls.map { resolveUrl(baseUrl, it) }
            val init = listInit.find(manifestXml)?.groupValues?.get(1)
            return if (init != null) listOf(resolveUrl(baseUrl, init)) + urls else urls
        }

        val template = templateTag.find(manifestXml)?.value.orEmpty()
        val initialization = initAttr.find(template)?.groupValues?.get(1)
        val media = mediaAttr.find(template)?.groupValues?.get(1)
        val startNumber = parseInt(startAttr.find(template)?.groupValues?.get(1) ?: "1")
        val segmentCount = timelineCount(timelineS.findAll(manifestXml).map { parseInt(repeatAttr.find(it.groupValues[1])?.groupValues?.get(1) ?: "0") }.toList())
        if (media != null && segmentCount > 0) {
            val urls = mutableListOf<String>()
            if (initialization != null) urls += resolveUrl(baseUrl, initialization)
            if (startNumber != null) for (number in startNumber until startNumber + segmentCount) urls += resolveUrl(baseUrl, mediaUrl(media, number))
            return urls
        }
        return absoluteUrl.findAll(manifestXml).map { it.value }.toList()
    }
}
