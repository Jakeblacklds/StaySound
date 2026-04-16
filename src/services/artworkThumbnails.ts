import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

const ARTWORK_THUMB_DIR = `${FileSystem.cacheDirectory}artwork_thumbs/`;
const THUMB_SIZE = 128;
const THUMB_QUALITY = 0.72;
const NOTIFICATION_SIZE = 512;
const NOTIFICATION_QUALITY = 0.86;

const inFlight = new Map<string, Promise<string | undefined>>();

function hashString(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
}

function toSourceUri(artworkUri: string): string | null {
    if (artworkUri.startsWith('http://') || artworkUri.startsWith('https://')) {
        return artworkUri;
    }

    if (artworkUri.startsWith('file://') || artworkUri.startsWith('content://')) {
        return artworkUri;
    }

    if (artworkUri.startsWith('/')) {
        return `file://${artworkUri}`;
    }

    return null;
}

async function ensureThumbDir(): Promise<void> {
    const info = await FileSystem.getInfoAsync(ARTWORK_THUMB_DIR);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(ARTWORK_THUMB_DIR, { intermediates: true });
    }
}

type ArtworkVariantOptions = {
    size: number;
    quality: number;
    suffix: string;
};

async function getArtworkVariantUri(
    artworkUri: string | undefined,
    options: ArtworkVariantOptions
): Promise<string | undefined> {
    if (!artworkUri) return undefined;

    const normalized = artworkUri.trim();
    if (!normalized) return undefined;
    if (normalized.startsWith('data:')) return undefined;

    const sourceUri = toSourceUri(normalized);
    if (!sourceUri) return undefined;

    const cacheKey = hashString(`${options.suffix}:${normalized}`);
    const targetUri = `${ARTWORK_THUMB_DIR}${cacheKey}.jpg`;

    const existing = await FileSystem.getInfoAsync(targetUri);
    if (existing.exists) {
        return targetUri;
    }

    if (inFlight.has(cacheKey)) {
        return inFlight.get(cacheKey);
    }

    const task = (async () => {
        try {
            await ensureThumbDir();

            const result = await ImageManipulator.manipulateAsync(
                sourceUri,
                [{ resize: { width: options.size, height: options.size } }],
                {
                    compress: options.quality,
                    format: ImageManipulator.SaveFormat.JPEG,
                }
            );

            if (!result?.uri) return undefined;

            if (result.uri !== targetUri) {
                const targetInfo = await FileSystem.getInfoAsync(targetUri);
                if (targetInfo.exists) {
                    await FileSystem.deleteAsync(targetUri, { idempotent: true });
                }
                await FileSystem.moveAsync({ from: result.uri, to: targetUri });
            }

            return targetUri;
        } catch {
            return undefined;
        } finally {
            inFlight.delete(cacheKey);
        }
    })();

    inFlight.set(cacheKey, task);
    return task;
}

export async function getArtworkThumbUri(artworkUri?: string): Promise<string | undefined> {
    return getArtworkVariantUri(artworkUri, {
        size: THUMB_SIZE,
        quality: THUMB_QUALITY,
        suffix: 'thumb',
    });
}

export async function getArtworkNotificationUri(artworkUri?: string): Promise<string | undefined> {
    return getArtworkVariantUri(artworkUri, {
        size: NOTIFICATION_SIZE,
        quality: NOTIFICATION_QUALITY,
        suffix: 'notification',
    });
}
