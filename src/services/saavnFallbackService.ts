import CryptoJS from "crypto-js";
import { TidalQuality, TidalTrack } from "../types/audio";

const JIOSAAVN_API_URL = "https://www.jiosaavn.com/api.php";
const SAAVN_DES_KEY = "38346591";
const REQUEST_TIMEOUT_MS = 12000;

type SaavnArtistEntry = {
  name?: string;
};

type SaavnSong = {
  id?: string;
  title?: string;
  subtitle?: string;
  perma_url?: string;
  image?: string;
  more_info?: {
    album?: string;
    duration?: string;
    encrypted_media_url?: string;
    media_url?: string;
    singers?: string;
    primary_artists?: string;
    artists?: {
      primary?: SaavnArtistEntry[];
      all?: SaavnArtistEntry[];
    };
  };
};

type SaavnAlbum = {
  id?: string;
  title?: string;
  subtitle?: string;
  list?: SaavnSong[];
};

type SaavnAlbumSearchResponse = {
  results?: SaavnAlbum[];
};

export type SaavnResolvedStream = {
  url: string;
  extension: "m4a";
  codec: "aac";
  quality: string;
};

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const { signal, cleanup } = withTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://www.jiosaavn.com/",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Saavn endpoint failed (${response.status})`);
    }
    return JSON.parse(body) as T;
  } finally {
    cleanup();
  }
}

function getJioSaavnUrl(call: string, params: Record<string, string>): string {
  const url = new URL(JIOSAAVN_API_URL);
  url.searchParams.set("__call", call);
  url.searchParams.set("_format", "json");
  url.searchParams.set("_marker", "0");
  url.searchParams.set("ctx", "web6dot0");
  url.searchParams.set("api_version", "4");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function decodeSaavnText(value?: string): string {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value?: string): string {
  return decodeSaavnText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSaavnArtist(song: SaavnSong): string {
  const subtitleArtist = song.subtitle?.split(" - ")[0]?.trim();
  if (subtitleArtist) return decodeSaavnText(subtitleArtist);

  const primary = song.more_info?.artists?.primary
    ?.map((artist) => artist.name)
    .filter(Boolean)
    .join(", ");
  return decodeSaavnText(
    primary ||
      song.more_info?.primary_artists ||
      song.more_info?.singers ||
      "Unknown Artist",
  );
}

function scoreSaavnCandidate(source: Pick<TidalTrack, "title" | "artist" | "album" | "durationMs">, song: SaavnSong): number {
  const sourceTitle = comparable(source.title);
  const candidateTitle = comparable(song.title);
  const sourceArtist = comparable(source.artist);
  const candidateArtist = comparable(getSaavnArtist(song));
  const sourceAlbum = comparable(source.album);
  const candidateAlbum = comparable(song.more_info?.album);

  let score = 0;
  if (sourceTitle && sourceTitle === candidateTitle) score += 140;
  if (sourceTitle && (candidateTitle.includes(sourceTitle) || sourceTitle.includes(candidateTitle))) score += 60;
  if (sourceArtist && sourceArtist === candidateArtist) score += 120;
  if (sourceArtist && (candidateArtist.includes(sourceArtist) || sourceArtist.includes(candidateArtist))) score += 50;
  if (sourceAlbum && sourceAlbum === candidateAlbum) score += 40;

  const durationSeconds = Number.parseInt(song.more_info?.duration ?? "", 10);
  if (Number.isFinite(durationSeconds) && source.durationMs) {
    const delta = Math.abs(durationSeconds * 1000 - source.durationMs);
    if (delta <= 2500) score += 35;
    else if (delta <= 8000) score += 12;
  }

  if (song.more_info?.encrypted_media_url || song.more_info?.media_url) score += 20;
  return score;
}

function scoreSaavnAlbumCandidate(
  source: Pick<TidalTrack, "artist" | "album">,
  album: SaavnAlbum,
): number {
  const sourceAlbum = comparable(source.album);
  const candidateAlbum = comparable(album.title);
  const sourceArtist = comparable(source.artist);
  const candidateArtist = comparable(album.subtitle);
  let score = 0;

  if (sourceAlbum && sourceAlbum === candidateAlbum) score += 180;
  if (sourceAlbum && (candidateAlbum.includes(sourceAlbum) || sourceAlbum.includes(candidateAlbum))) score += 90;
  if (sourceArtist && sourceArtist === candidateArtist) score += 80;
  if (sourceArtist && (candidateArtist.includes(sourceArtist) || sourceArtist.includes(candidateArtist))) score += 40;
  return score;
}

async function findSaavnSongByAlbum(
  track: Pick<TidalTrack, "title" | "artist" | "album" | "durationMs">,
): Promise<SaavnSong | null> {
  const queries = Array.from(new Set([
    `${track.album} ${track.artist}`.trim(),
    track.album.trim(),
  ].filter(Boolean)));
  const searches = await Promise.all(queries.map(async (query) => {
    try {
      return await fetchJson<SaavnAlbumSearchResponse>(getJioSaavnUrl(
        "search.getAlbumResults",
        { q: query, n: "20", p: "1" },
      ));
    } catch {
      return null;
    }
  }));
  const uniqueAlbums = new Map<string, SaavnAlbum>();
  searches.flatMap((search) => search?.results ?? []).forEach((album) => {
    if (album.id) uniqueAlbums.set(album.id, album);
  });
  const albums = Array.from(uniqueAlbums.values())
    .filter((album) => album.id)
    .map((album) => ({ album, score: scoreSaavnAlbumCandidate(track, album) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);

  const details = await Promise.all(albums.map(async ({ album }) => {
    try {
      return await fetchJson<SaavnAlbum>(getJioSaavnUrl(
        "content.getAlbumDetails",
        { albumid: String(album.id) },
      ));
    } catch {
      return null;
    }
  }));

  const best = details
    .flatMap((album) => album?.list ?? [])
    .map((song) => ({ song, score: scoreSaavnCandidate(track, song) }))
    .filter((item) => item.score >= 150)
    .sort((left, right) => right.score - left.score)[0];
  return best?.song ?? null;
}

function decryptSaavnMediaUrl(encryptedUrl: string): string {
  const padded = `${encryptedUrl}${"=".repeat((4 - encryptedUrl.length % 4) % 4)}`;
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(padded),
  });
  return CryptoJS.DES.decrypt(
    cipherParams,
    CryptoJS.enc.Utf8.parse(SAAVN_DES_KEY),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  ).toString(CryptoJS.enc.Utf8);
}

function getSaavnAudioQuality(quality: TidalQuality): "320" | "160" {
  return quality === "LOW" ? "160" : "320";
}

function getSaavnStreamUrl(song: SaavnSong, quality: TidalQuality): string {
  const directUrl = song.more_info?.media_url?.trim();
  if (directUrl) return directUrl.replace(/_\d+\.mp4(\?.*)?$/i, `_${getSaavnAudioQuality(quality)}.mp4$1`);

  const encryptedUrl = song.more_info?.encrypted_media_url?.trim();
  if (!encryptedUrl) return "";
  const decrypted = decryptSaavnMediaUrl(encryptedUrl);
  return decrypted
    ? decrypted.replace(/_\d+\.mp4(\?.*)?$/i, `_${getSaavnAudioQuality(quality)}.mp4$1`)
    : "";
}

export async function resolveSaavnStreamFromTrack(
  track: Pick<TidalTrack, "title" | "artist" | "album" | "durationMs">,
  quality: TidalQuality,
): Promise<SaavnResolvedStream | null> {
  if (!track.album.trim() || !track.title.trim()) return null;
  const song = await findSaavnSongByAlbum(track);
  if (!song) return null;

  const url = getSaavnStreamUrl(song, quality);
  if (!url) return null;

  return {
    url,
    extension: "m4a",
    codec: "aac",
    quality: getSaavnAudioQuality(quality) === "320" ? "HIGH" : "LOW",
  };
}
