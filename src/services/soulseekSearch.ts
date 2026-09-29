type TrackIdentity = { title: string; artist: string; album?: string };

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function words(value: string): string[] {
  return normalized(value).split(' ').filter(Boolean);
}

function keywords(value: string): string {
  return words(value).filter(word => word.length > 2 || /\d/.test(word)).join(' ');
}

// Catalog decorations peers rarely put in filenames. Versions that change the
// recording (live, remix, acoustic...) are kept: they are a different song.
const DECORATION = /\b(feat|ft|featuring|with|remaster(ed)?|mono|stereo|bonus|explicit|from|original|album version|single version|\d{4} mix)\b/i;

/** "Song (feat. X) - Remastered 2011" → "Song": what peers actually name the file. */
export function soulseekCoreTitle(title: string): string {
  const core = title
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) => (DECORATION.test(inner) || /^\s*(19|20)\d{2}\s*$/.test(inner) ? ' ' : whole))
    .replace(/\s+-\s+([^-]*)$/, (whole, tail: string) => (DECORATION.test(tail) || /^\s*(19|20)\d{2}\s*$/.test(tail) ? '' : whole))
    .replace(/\s+(feat|ft|featuring)\.?\s.*$/i, '')
    .trim();
  return normalized(core) ? core : title;
}

export function soulseekSearchQueries(track: TrackIdentity): { query: string; maxResults: number }[] {
  const title = normalized(soulseekCoreTitle(track.title));
  const artist = normalized(track.artist);
  // Artist + title is what people type in Seeker/Nicotine+: every peer that
  // could pass the identity check below still matches, but far fewer
  // unrelated peers answer, so the right replies arrive before the timeout.
  const first = `${artist} ${title}`.trim();
  const album = keywords((track.album ?? '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s-\s*(single|ep)\s*$/i, ' ')
    .replace(/\b(deluxe|edition|expanded|remaster(ed)?|anniversary|bonus|explicit|version|special|super)\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' '));
  const queries = [{ query: first, maxResults: 100 }];
  // Fallback for peers that spell the artist differently in their folders
  // (accents, "The", abbreviations): the title alone, when it is distinctive.
  const simplifiedTitle = keywords(title);
  if (simplifiedTitle && simplifiedTitle.split(' ').length >= 2 && simplifiedTitle !== first) {
    queries.push({ query: simplifiedTitle, maxResults: 100 });
  } else if (album && album !== title) {
    const query = `${artist} ${album}`.trim();
    if (query !== first) queries.push({ query, maxResults: 200 });
  }
  return queries;
}

export function soulseekMatchIdentity(track: TrackIdentity) {
  const title = soulseekCoreTitle(track.title);
  return {
    titleWords: words(keywords(title) || title),
    artistWords: words(keywords(track.artist) || track.artist),
  };
}

/** Availability and file quality must never make a different song eligible. */
export function isSoulseekTrackCandidate(track: TrackIdentity, filename: string): boolean {
  const leaf = new Set(words(filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')));
  const path = new Set(words(filename));
  const { titleWords, artistWords } = soulseekMatchIdentity(track);
  return titleWords.length > 0 && artistWords.length > 0
    && titleWords.every(word => leaf.has(word))
    && artistWords.every(word => path.has(word));
}
