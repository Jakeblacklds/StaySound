import { DOMParser } from "@xmldom/xmldom";

type DashRepresentation = {
  id: string;
  codecs?: string;
  mimeType?: string;
  sampleRate?: number;
  bitDepth?: number;
  urls: string[];
};

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  if (!maybeRelative) return baseUrl;
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  if (!baseUrl) return maybeRelative;

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${maybeRelative.replace(/^\/+/, "")}`;
}

function extractSegmentCountFromTimeline(xml: string): number {
  const segmentNodes = Array.from(xml.matchAll(/<S\b([^>]*)\/?\s*>/gi));
  if (segmentNodes.length === 0) return 0;

  let count = 0;
  for (const node of segmentNodes) {
    const attrs = node[1] ?? "";
    const repeatMatch = attrs.match(/\br="(-?\d+)"/i);
    const repeat = repeatMatch ? Number.parseInt(repeatMatch[1], 10) : 0;
    count += repeat >= 0 ? repeat + 1 : 1;
  }

  return count;
}

function buildSegmentTemplateMedia(
  mediaTemplate: string,
  number: number,
): string {
  return mediaTemplate.replace(
    /\$Number(%0(\d+)d)?\$/g,
    (_full, _format, width) => {
      if (!width) return String(number);
      return String(number).padStart(Number.parseInt(width, 10), "0");
    },
  );
}

function parseDashRepresentationUrls(
  representation: Element,
  adaptationSet: Element,
): DashRepresentation | null {
  const segmentTemplate =
    representation.getElementsByTagName("SegmentTemplate")[0] ??
    adaptationSet.getElementsByTagName("SegmentTemplate")[0];
  if (!segmentTemplate) return null;

  const initialization = segmentTemplate.getAttribute("initialization") ?? "";
  const media = segmentTemplate.getAttribute("media") ?? "";
  const startNumber = Number.parseInt(
    segmentTemplate.getAttribute("startNumber") ?? "1",
    10,
  );
  const timelineNodes = segmentTemplate.getElementsByTagName("S");
  let segmentCount = 0;
  for (let i = 0; i < timelineNodes.length; i++) {
    const repeat = Number.parseInt(
      timelineNodes[i].getAttribute("r") ?? "0",
      10,
    );
    segmentCount += repeat >= 0 ? repeat + 1 : 1;
  }

  const baseUrlNode =
    representation.getElementsByTagName("BaseURL")[0] ??
    adaptationSet.getElementsByTagName("BaseURL")[0];
  const baseUrl = baseUrlNode?.textContent?.trim() ?? "";

  const urls: string[] = [];
  if (initialization) {
    urls.push(resolveUrl(baseUrl, initialization));
  }

  if (media && segmentCount > 0) {
    for (
      let segmentNumber = startNumber;
      segmentNumber < startNumber + segmentCount;
      segmentNumber++
    ) {
      urls.push(
        resolveUrl(baseUrl, buildSegmentTemplateMedia(media, segmentNumber)),
      );
    }
  }

  if (urls.length === 0) {
    return null;
  }

  const representationId = representation.getAttribute("id") ?? "";
  const codecs =
    representation.getAttribute("codecs") ??
    adaptationSet.getAttribute("codecs") ??
    undefined;
  const mimeType =
    representation.getAttribute("mimeType") ??
    adaptationSet.getAttribute("mimeType") ??
    undefined;
  const sampleRate = Number.parseInt(
    representation.getAttribute("audioSamplingRate") ??
      adaptationSet.getAttribute("audioSamplingRate") ??
      "0",
    10,
  );
  const bitDepthMatch = representationId.match(/FLAC,(\d+),(\d+)/i);

  return {
    id: representationId,
    codecs,
    mimeType,
    sampleRate:
      Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : undefined,
    bitDepth: bitDepthMatch ? Number.parseInt(bitDepthMatch[2], 10) : undefined,
    urls,
  };
}

function scoreDashRepresentation(
  representation: DashRepresentation,
  quality: string,
): number {
  const id = representation.id.toUpperCase();
  const codecs = (representation.codecs ?? "").toLowerCase();
  const sampleRate = representation.sampleRate ?? 0;
  const bitDepth = representation.bitDepth ?? 0;

  if (quality === "LOW") {
    if (id.includes("HEAACV1")) return 100;
    if (id.includes("AACLC")) return 50;
    return 0;
  }

  if (quality === "HIGH") {
    if (id.includes("AACLC")) return 100;
    if (id.includes("HEAACV1")) return 50;
    return 0;
  }

  if (quality === "LOSSLESS") {
    if (codecs.includes("flac")) {
      return 1000 + sampleRate + bitDepth;
    }
    if (id.includes("AACLC")) return 50;
    return 0;
  }

  if (quality === "HI_RES_LOSSLESS") {
    if (codecs.includes("flac")) {
      return 1000 + sampleRate + bitDepth * 10;
    }
    return 0;
  }

  return 0;
}

export function parseDashManifestForQuality(
  manifestXml: string,
  quality: string,
): {
  urls: string[];
  mimeType?: string;
  codecs?: string;
  sampleRate?: number;
  bitDepth?: number;
} {
  const document = new DOMParser().parseFromString(
    manifestXml,
    "application/xml",
  );
  const adaptationSets = Array.from(
    document.getElementsByTagName("AdaptationSet"),
  );
  const representations: DashRepresentation[] = [];

  for (const adaptationSet of adaptationSets) {
    const mimeType = adaptationSet.getAttribute("mimeType") ?? "";
    if (!mimeType.toLowerCase().includes("audio")) continue;

    const repNodes = Array.from(
      adaptationSet.getElementsByTagName("Representation"),
    );
    for (const representation of repNodes) {
      const parsed = parseDashRepresentationUrls(representation, adaptationSet);
      if (parsed) {
        representations.push(parsed);
      }
    }
  }

  const ranked = representations
    .map((representation) => ({
      representation,
      score: scoreDashRepresentation(representation, quality),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0]?.representation;
  if (!selected) {
    throw new Error("Tidal DASH manifest did not produce segment URLs");
  }

  return {
    urls: selected.urls,
    mimeType: selected.mimeType,
    codecs: selected.codecs,
    sampleRate: selected.sampleRate,
    bitDepth: selected.bitDepth,
  };
}

export function parseDashManifest(manifestXml: string): string[] {
  const baseUrlMatch = manifestXml.match(/<BaseURL>([^<]+)<\/BaseURL>/i);
  const baseUrl = baseUrlMatch?.[1]?.trim() ?? "";

  const segmentListInit = manifestXml.match(
    /<SegmentList[^>]*\binitialization="([^"]+)"/i,
  )?.[1];
  const segmentListUrls = Array.from(
    manifestXml.matchAll(/<SegmentURL[^>]*\bmedia="([^"]+)"/gi),
  );
  if (segmentListUrls.length > 0) {
    const urls = segmentListUrls.map((match) => resolveUrl(baseUrl, match[1]));
    if (segmentListInit) {
      return [resolveUrl(baseUrl, segmentListInit), ...urls];
    }
    return urls;
  }

  const segmentTemplateMatch =
    manifestXml.match(/<SegmentTemplate[^>]*>/i)?.[0] ?? "";
  const initialization = segmentTemplateMatch.match(
    /\binitialization="([^"]+)"/i,
  )?.[1];
  const media = segmentTemplateMatch.match(/\bmedia="([^"]+)"/i)?.[1];
  const startNumber = Number.parseInt(
    segmentTemplateMatch.match(/\bstartNumber="(\d+)"/i)?.[1] ?? "1",
    10,
  );
  const segmentCount = extractSegmentCountFromTimeline(manifestXml);

  if (media && segmentCount > 0) {
    const urls: string[] = [];
    if (initialization) {
      urls.push(resolveUrl(baseUrl, initialization));
    }

    for (
      let segmentNumber = startNumber;
      segmentNumber < startNumber + segmentCount;
      segmentNumber++
    ) {
      urls.push(
        resolveUrl(baseUrl, buildSegmentTemplateMedia(media, segmentNumber)),
      );
    }

    return urls;
  }

  const absoluteUrls = Array.from(
    manifestXml.matchAll(/https?:\/\/[^"'\s<]+/gi),
  ).map((match) => match[0]);
  return absoluteUrls;
}
