package app.staysound.core.tidal

/**
 * Static mirror rosters and timings (`src/services/tidal/constants.ts`). The static catalog test compares the derived
 * catalog with the TypeScript one, so a roster edit made on one side only fails the build.
 */
object TidalMirrors {
    val API_BASES = listOf(
        "https://hifi.geeked.wtf", "https://eu-central.monochrome.tf", "https://arran.monochrome.tf", "https://tidal.kinoplus.online",
        "https://api.monochrome.tf", "https://us-west.monochrome.tf", "https://monochrome-api.samidy.com", "https://wolf.qqdl.site",
        "https://katze.qqdl.site", "https://hund.qqdl.site", "https://maus.qqdl.site", "https://vogel.qqdl.site",
    )
    val STREAMING_BASES = listOf(
        "https://hifi.geeked.wtf", "https://arran.monochrome.tf", "https://vogel.qqdl.site", "https://maus.qqdl.site",
        "https://katze.qqdl.site", "https://hund.qqdl.site", "https://wolf.qqdl.site", "https://hifi.p1nkhamster.xyz",
    )
    /** Monochrome's uptime workers, canonical first. */
    val UPTIME_CATALOG_URLS = listOf(
        "https://tidal-uptime.geeked.wtf", "https://tidal-uptime.jiffy-puffs-1j.workers.dev/", "https://tidal-uptime.props-76styles.workers.dev/",
    )
    const val REQUEST_TIMEOUT_MS = 12_000L
    const val MIRROR_HEALTH_TIMEOUT_MS = 3_500L
    const val MIRROR_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000L
}
