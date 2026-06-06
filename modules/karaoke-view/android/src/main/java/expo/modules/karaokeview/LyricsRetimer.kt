package expo.modules.karaokeview

import kotlin.math.abs

internal object LyricsRetimer {
    private const val OVERLAP_THRESHOLD_MS = 5L
    private const val GAP_THRESHOLD_MS = 1L
    private const val MAX_EXTENSION_MS = 1300L

    fun retime(lines: List<LyricLine>): List<LyricLine> {
        if (lines.isEmpty()) return lines

        class RetimeInfo(
            val line: LyricLine,
            val startTime: Long,
            val originalEndTime: Long,
            var newEndTime: Long
        )

        val infos = lines.map {
            RetimeInfo(
                line = it,
                startTime = it.startMs,
                originalEndTime = it.endMs,
                newEndTime = it.endMs
            )
        }

        var i = 0
        while (i < infos.size) {
            var clusterEnd = i
            var maxEndInRange = infos[i].originalEndTime

            while (clusterEnd < infos.size - 1) {
                val next = infos[clusterEnd + 1]
                val overlap = maxEndInRange - next.startTime
                if (overlap > OVERLAP_THRESHOLD_MS) {
                    clusterEnd += 1
                    maxEndInRange = maxOf(maxEndInRange, next.originalEndTime)
                } else {
                    break
                }
            }

            val cluster = infos.subList(i, clusterEnd + 1)
            val clusterBaseEnd = cluster.maxOf { it.originalEndTime }
            var clusterFinalEnd = clusterBaseEnd

            val lineAfter = if (clusterEnd < infos.size - 1) infos[clusterEnd + 1] else null
            if (lineAfter != null) {
                val gap = lineAfter.startTime - clusterBaseEnd
                val nextIsGap = lineAfter.line.isGap
                if (gap > GAP_THRESHOLD_MS && !nextIsGap) {
                    clusterFinalEnd += minOf(MAX_EXTENSION_MS, gap)
                }
            }

            for (j in i..clusterEnd) {
                var cutoff: Long? = null
                for (k in (j + 1)..clusterEnd) {
                    val jClearsK = (infos[j].originalEndTime - infos[k].startTime) <= OVERLAP_THRESHOLD_MS
                    val chainBrokenAtK = (infos[k - 1].originalEndTime - infos[k].startTime) <= OVERLAP_THRESHOLD_MS
                    if (jClearsK || chainBrokenAtK) {
                        cutoff = infos[k].startTime
                        break
                    }
                }
                infos[j].newEndTime = cutoff ?: clusterFinalEnd
            }

            i = clusterEnd + 1
        }

        // Apply new end times to the lines without changing word timing.
        // Word duration drives sustained/glow classification in the renderer.
        infos.forEach { info ->
            if (abs(info.newEndTime - info.originalEndTime) > GAP_THRESHOLD_MS) {
                info.line.endMs = info.newEndTime
            }
        }

        return lines
    }
}
