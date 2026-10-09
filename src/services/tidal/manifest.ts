/** Resolves a track manifest from the mirrors. */
import { useSettingsStore } from "../../stores/settingsStore";
import { TidalQuality, Track } from "../../types/audio";
import { parseDashManifestForQuality } from "../../features/tidal/data/dashManifestParser";
import type { ParsedManifest, TidalTrackManifestResponse } from "../../features/tidal/data/tidalApiTypes";
import { REQUEST_TIMEOUT_MS } from "./constants";
import { fetchJsonWithMirror } from "./http";
import { getFallbackBases, markTidalMirrorUnavailable, mirrorRotation } from "./mirrors";
import { withTimeoutSignal } from "./net";

export async function getTidalTrackManifest(
  tidalId: number,
  quality: TidalQuality = "MP3",
  options: {
    ignoreManualMirror?: boolean;
    capability?: "stream" | "download";
  } = {},
): Promise<ParsedManifest> {
  const manifestQuality = quality === "MP3" ? "HIGH" : quality;
  const capability = options.capability ?? "stream";
  const formatParams = new URLSearchParams();
  if (manifestQuality === "HIGH") {
    formatParams.append("formats", "HEAACV1");
    formatParams.append("formats", "AACLC");
  } else if (manifestQuality === "LOSSLESS") {
    formatParams.append("formats", "HEAACV1");
    formatParams.append("formats", "AACLC");
    formatParams.append("formats", "FLAC");
  } else {
    formatParams.append("formats", "HEAACV1");
    formatParams.append("formats", "AACLC");
    formatParams.append("formats", "FLAC_HIRES");
    formatParams.append("formats", "FLAC");
  }

  const path = `/trackManifests/?id=${tidalId}&adaptive=true&manifestType=MPEG_DASH&uriScheme=HTTPS&usage=PLAYBACK&${formatParams.toString()}`;
  const { tidalMirror } = useSettingsStore.getState();
  const manualMirror =
    !options.ignoreManualMirror && tidalMirror && tidalMirror !== "auto"
      ? tidalMirror
      : null;
  const fallbackBases = manualMirror
    ? [manualMirror]
    : await getFallbackBases("streaming", capability);
  const startBaseIndex =
    fallbackBases.length > 0 ? mirrorRotation.index % fallbackBases.length : 0;
  let lastError: Error | null = null;

  for (let i = 0; i < fallbackBases.length; i++) {
    const base = manualMirror ? manualMirror : fallbackBases[mirrorRotation.index];

    try {
      const response = await fetchJsonWithMirror<TidalTrackManifestResponse>(
        path,
        REQUEST_TIMEOUT_MS,
        {
          ignoreManualMirror: true,
          category: "streaming",
          capability,
        },
      );

      const actualBase = manualMirror ? base : response.base;
      const attributes = response.data.data?.data?.attributes;
      if (!attributes) {
        throw new Error("Missing Tidal trackManifests payload");
      }

      if (attributes.trackPresentation === "PREVIEW") {
        const reason = attributes.previewReason ?? "UNKNOWN_PREVIEW_REASON";
        markTidalMirrorUnavailable(actualBase, 200);
        if (manualMirror) {
          throw new Error(
            `Track manifest only returned preview on ${actualBase} (${reason})`,
          );
        }

        console.warn(
          `[TidalService] Streaming mirror ${actualBase} returned preview (${reason}). Trying next...`,
        );
        mirrorRotation.index = (mirrorRotation.index + 1) % fallbackBases.length;
        if (mirrorRotation.index === startBaseIndex) {
          lastError = new Error(
            `Track manifest only returned preview (${reason})`,
          );
          break;
        }
        continue;
      }

      if (!attributes.uri) {
        throw new Error("Missing trackManifests URI");
      }

      const { signal, cleanup } = withTimeoutSignal(REQUEST_TIMEOUT_MS);
      try {
        const manifestResponse = await fetch(attributes.uri, { signal });
        if (!manifestResponse.ok) {
          throw new Error(`Manifest fetch failed (${manifestResponse.status})`);
        }

        const manifestText = await manifestResponse.text();
        const trimmed = manifestText.trim();
        if (!trimmed) {
          throw new Error("Fetched manifest is empty");
        }

        if (trimmed.startsWith("<")) {
          const parsedDash = parseDashManifestForQuality(
            trimmed,
            manifestQuality,
          );

          return {
            urls: parsedDash.urls,
            quality: manifestQuality,
            mimeType: parsedDash.mimeType ?? "application/dash+xml",
            codecs: parsedDash.codecs,
            sampleRate: parsedDash.sampleRate,
            bitDepth: parsedDash.bitDepth,
            isSegmented: parsedDash.urls.length > 1,
            manifestUrl: attributes.uri,
          };
        }

        return {
          urls: [attributes.uri],
          quality: manifestQuality,
          mimeType: attributes.uri.includes(".m3u8")
            ? "application/vnd.apple.mpegurl"
            : undefined,
          isSegmented: false,
          manifestUrl: attributes.uri,
        };
      } finally {
        cleanup();
      }
    } catch (error: any) {
      lastError = error;
      if (manualMirror) {
        throw error;
      }

      mirrorRotation.index = (mirrorRotation.index + 1) % fallbackBases.length;
      if (mirrorRotation.index === startBaseIndex) {
        break;
      }
    }
  }

  throw (
    lastError || new Error("All streaming mirrors returned preview or failed")
  );
}
