function words(value) {
  return new Set(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

export function isLosslessResult(result) {
  const extension = (result.extension || result.filename.replace(/^.*\./, '')).toLowerCase();
  return extension === 'flac' || extension === 'wav';
}

// Free slot first (Seeker: peers without one rarely start), then lossless,
// then the fastest finish. ETA alone favoured small MP3s over FLAC.
export function rankSoulseekResults(results, maxResults, identity) {
  return results.filter(result => {
    if (!identity) return true;
    const leaf = words(result.filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''));
    const path = words(result.filename);
    return identity.titleWords.every(word => leaf.has(word))
      && identity.artistWords.every(word => path.has(word));
  }).sort((a, b) => {
    if (a.slots !== b.slots) return a.slots ? -1 : 1;
    if (isLosslessResult(a) !== isLosslessResult(b)) return isLosslessResult(a) ? -1 : 1;
    const aEta = a.size && a.speed ? a.size / a.speed : Infinity;
    const bEta = b.size && b.speed ? b.size / b.speed : Infinity;
    if (aEta !== bEta) return aEta - bEta;
    return (b.speed ?? 0) - (a.speed ?? 0);
  }).slice(0, maxResults);
}
