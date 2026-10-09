/** A live server socket does not guarantee that searches still reach peers. */
export function createSearchRecovery({ cooldownMs = 10 * 60_000, now = Date.now } = {}) {
  let session = null;
  let emptyQueries = new Set();
  let lastRecoveryAt = -Infinity;

  return async function searchWithRecovery({ client, query, search, reconnect, canReconnect }) {
    if (session !== client) {
      session = client;
      emptyQueries = new Set();
    }
    const results = await search(client);
    if (results.length || results.rawResultCount > 0) {
      emptyQueries.clear();
      return results;
    }
    emptyQueries.add(query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim());
    // A single miss is normal. Never loop on an unavailable song, and never
    // tear down a session while a transfer is using it.
    if (emptyQueries.size < 2 || now() - lastRecoveryAt < cooldownMs || !canReconnect(client)) {
      return results;
    }
    lastRecoveryAt = now();
    emptyQueries.clear();
    session = await reconnect(client);
    // Exactly one retry, bypassing cached empty results from the old session.
    return search(session);
  };
}
