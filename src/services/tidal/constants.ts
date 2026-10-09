/** Static configuration: mirror rosters, timeouts, cache lifetimes and the catalog client identity. */

// Monochrome no longer maintains its old HiFi mirror roster. Its current
// client uses this public TIDAL application identity to obtain a short-lived
// catalog token, so use the same catalog route for searches.
export const TIDAL_CATALOG_CLIENT_ID = "txNoH4kkV41MfH25";

export const TIDAL_CATALOG_CLIENT_SECRET = "dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=";

export const TIDAL_API_BASES = [
  "https://hifi.geeked.wtf",
  "https://eu-central.monochrome.tf",
  "https://arran.monochrome.tf",
  "https://tidal.kinoplus.online",
  "https://api.monochrome.tf",
  "https://us-west.monochrome.tf",
  "https://monochrome-api.samidy.com",
  "https://wolf.qqdl.site",
  "https://katze.qqdl.site",
  "https://hund.qqdl.site",
  "https://maus.qqdl.site",
  "https://vogel.qqdl.site",
];

export const TIDAL_API_LEGACY_BASES: string[] = [];

export const STATIC_GENERIC_TIDAL_API_BASES = TIDAL_API_BASES;

export const STATIC_GENERIC_STREAMING_BASES = [
  "https://hifi.geeked.wtf",
  "https://arran.monochrome.tf",
  "https://vogel.qqdl.site",
  "https://maus.qqdl.site",
  "https://katze.qqdl.site",
  "https://hund.qqdl.site",
  "https://wolf.qqdl.site",
  "https://hifi.p1nkhamster.xyz",
];

export const TIDAL_UPTIME_CATALOG_URLS = [
  // Monochrome's canonical uptime catalog (its INSTANCES_URLS). Listed first so StaySound
  // pulls the exact same live instance roster Monochrome publishes and auto-updates with
  // it. While Monochrome's custom-domain DNS record is unavailable this resolves to
  // NXDOMAIN (a fast, cached miss) and we fall through to the *.workers.dev mirrors below,
  // which are the same uptime workers serving fresh data.
  "https://tidal-uptime.geeked.wtf",
  "https://tidal-uptime.jiffy-puffs-1j.workers.dev/",
  "https://tidal-uptime.props-76styles.workers.dev/",
];

export const TIDAL_MIRROR_NAMES: Record<string, string> = {
  "https://hifi.geeked.wtf": "HiFi Geeked",
  "https://eu-central.monochrome.tf": "Monochrome EU Central",
  "https://arran.monochrome.tf": "Monochrome Arran",
  "https://tidal.kinoplus.online": "Kinoplus",
  "https://api.monochrome.tf": "Monochrome API",
  "https://us-west.monochrome.tf": "Monochrome US West",
  "https://monochrome-api.samidy.com": "Monochrome Samidy",
  "https://wolf.qqdl.site": "QQDL Wolf",
  "https://katze.qqdl.site": "QQDL Katze",
  "https://hund.qqdl.site": "QQDL Hund",
  "https://maus.qqdl.site": "QQDL Maus",
  "https://vogel.qqdl.site": "QQDL Vogel",
  "https://hifi.p1nkhamster.xyz": "HiFi P1nkhamster",
  auto: "Seleccion Automatica (Recomendado)",
};

export const TIDAL_ARTWORK_BASE = "https://resources.tidal.com/images";

export const REQUEST_TIMEOUT_MS = 12000;

export const MIRROR_HEALTH_TIMEOUT_MS = 3500;

export const MIRROR_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;

export const SEARCH_CACHE_TTL_MS = 45 * 1000;

export const DETAIL_CACHE_TTL_MS = 2 * 60 * 1000;
