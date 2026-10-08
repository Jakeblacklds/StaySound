export const records = new Map<string, string>();
export const FileSystemStorage = {
    getItem: async (key: string) => records.get(key) ?? null,
    setItem: async (key: string, value: string) => { records.set(key, value); },
    removeItem: async (key: string) => { records.delete(key); },
};
export const normalizeLyricsKeyPart = (value: string) => value.trim().toLowerCase();
export const createCanonicalLyricsKey = (title: string, artist: string) => `${normalizeLyricsKeyPart(artist)}::${normalizeLyricsKeyPart(title)}`;
export const getLyrics = async () => null;
export const forceRefreshLyrics = async () => null;
