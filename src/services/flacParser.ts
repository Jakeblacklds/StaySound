/**
 * FLAC Metadata Parser
 * 
 * Parses FLAC files to extract metadata including embedded artwork.
 * FLAC files have a different structure than MP3 (ID3 tags):
 * - Magic number "fLaC" (4 bytes)
 * - METADATA blocks with types:
 *   - 0: STREAMINFO
 *   - 4: VORBIS_COMMENT (text metadata)
 *   - 6: PICTURE (embedded artwork)
 * 
 * Artwork is saved to cache directory as files for better performance.
 */

import { decode, encode } from 'base-64';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

// Directory for cached artwork - using documentDirectory since cacheDirectory may be cleared
const ARTWORK_CACHE_DIR = `${FileSystem.documentDirectory}artwork_cache/`;

// FLAC constants
const FLAC_MAGIC = 'fLaC';
const BLOCK_TYPE_STREAMINFO = 0;
const BLOCK_TYPE_VORBIS_COMMENT = 4;
const BLOCK_TYPE_PICTURE = 6;

// Picture types (we want front cover = 3)
const PICTURE_TYPE_FRONT_COVER = 3;
const PICTURE_TYPE_OTHER = 0;

export interface FlacMetadata {
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    year?: string;
    trackNumber?: string;
    sampleRate?: number;
    bitDepth?: number;
    channels?: number;
    format?: string;
    picture?: {
        description: string;
        pictureData: string; // Now a file URI: file:///...
        mimeType: string;
        type: number;
    };
}

function parseStreamInfo(data: Uint8Array): { sampleRate: number; bitDepth: number; channels: number } | null {
    if (data.length < 18) return null;

    const byte10 = data[10];
    const byte11 = data[11];
    const byte12 = data[12];
    const byte13 = data[13];

    const sampleRate = (byte10 << 12) | (byte11 << 4) | ((byte12 & 0xf0) >> 4);
    const channels = ((byte12 & 0x0e) >> 1) + 1;
    const bitDepth = (((byte12 & 0x01) << 4) | ((byte13 & 0xf0) >> 4)) + 1;

    if (sampleRate <= 0 || bitDepth <= 0) return null;
    return { sampleRate, bitDepth, channels };
}

/**
 * Read bytes from a file at a specific position
 */
async function readBytes(uri: string, position: number, length: number): Promise<Uint8Array> {
    try {
        const data = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
            position: position,
            length: length,
        });
        return Uint8Array.from(decode(data), c => c.charCodeAt(0));
    } catch (error) {
        throw new Error(`Failed to read bytes at position ${position}: ${error}`);
    }
}

/**
 * Convert bytes to a string
 */
function bytesToString(bytes: Uint8Array, start: number = 0, length?: number): string {
    const end = length ? start + length : bytes.length;
    let result = '';
    for (let i = start; i < end && i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i]);
    }
    return result;
}

/**
 * Read a 32-bit big-endian integer from bytes
 */
function readUint32BE(bytes: Uint8Array, offset: number = 0): number {
    return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

/**
 * Read a 24-bit big-endian integer from bytes
 */
function readUint24BE(bytes: Uint8Array, offset: number = 0): number {
    return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

/**
 * Parse a Vorbis Comment block to extract text metadata
 */
function parseVorbisComment(data: Uint8Array): Record<string, string> {
    const result: Record<string, string> = {};
    let offset = 0;

    // Vendor length (little-endian 32-bit)
    const vendorLength = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
    offset += 4 + vendorLength;

    // Number of comments (little-endian 32-bit)
    const commentCount = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
    offset += 4;

    // Parse each comment
    for (let i = 0; i < commentCount && offset < data.length; i++) {
        const commentLength = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
        offset += 4;

        if (offset + commentLength > data.length) break;

        // Read comment as UTF-8 string
        const commentBytes = data.slice(offset, offset + commentLength);
        let comment = '';
        try {
            comment = new TextDecoder('utf-8').decode(commentBytes);
        } catch {
            // Fallback to basic ASCII parsing
            comment = bytesToString(commentBytes);
        }
        offset += commentLength;

        // Parse KEY=VALUE format
        const eqIndex = comment.indexOf('=');
        if (eqIndex > 0) {
            const key = comment.substring(0, eqIndex).toUpperCase();
            const value = comment.substring(eqIndex + 1);
            result[key] = value;
        }
    }

    return result;
}

/**
 * Generate a unique filename for artwork based on FLAC file URI
 */
function generateArtworkFilename(flacUri: string, mimeType: string): string {
    // Create a hash from the FLAC file path
    let hash = 0;
    for (let i = 0; i < flacUri.length; i++) {
        const char = flacUri.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    // Determine extension from mime type
    const ext = mimeType.includes('png') ? 'png' : 'jpg';

    return `artwork_${Math.abs(hash).toString(16)}.${ext}`;
}

/**
 * Ensure artwork cache directory exists
 */
async function ensureArtworkCacheDir(): Promise<void> {
    try {
        const dirInfo = await FileSystem.getInfoAsync(ARTWORK_CACHE_DIR);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(ARTWORK_CACHE_DIR, { intermediates: true });
            console.log('[FlacParser] Created artwork cache directory');
        }
    } catch (error) {
        console.error('[FlacParser] Failed to create artwork cache directory:', error);
    }
}

/**
 * Parse a PICTURE block and save artwork to cache file
 */
async function parsePictureBlock(data: Uint8Array, flacUri: string): Promise<FlacMetadata['picture'] | null> {
    let offset = 0;

    // Picture type (32-bit BE)
    const pictureType = readUint32BE(data, offset);
    offset += 4;

    // MIME type length (32-bit BE)
    const mimeLength = readUint32BE(data, offset);
    offset += 4;

    // MIME type string
    const mimeType = bytesToString(data, offset, mimeLength);
    offset += mimeLength;

    // Description length (32-bit BE)
    const descLength = readUint32BE(data, offset);
    offset += 4;

    // Description string
    let description = '';
    if (descLength > 0) {
        const descBytes = data.slice(offset, offset + descLength);
        try {
            description = new TextDecoder('utf-8').decode(descBytes);
        } catch {
            description = bytesToString(data, offset, descLength);
        }
    }
    offset += descLength;

    // Width, Height, Color Depth, Colors Used (4 x 32-bit BE) - skip these
    offset += 16;

    // Picture data length (32-bit BE)
    const pictureDataLength = readUint32BE(data, offset);
    offset += 4;

    if (offset + pictureDataLength > data.length) {
        console.debug('[FlacParser] Picture data exceeds block size');
        return null;
    }

    // Picture binary data
    const pictureData = data.slice(offset, offset + pictureDataLength);
    const originalSizeKB = Math.round(pictureDataLength / 1024);

    console.log(`[FlacParser] Picture details - type: ${pictureType}, mime: "${mimeType}", size: ${originalSizeKB}KB`);

    // Convert picture to base64 for writing (optimized and robust)
    let base64Data = '';
    try {
        // More memory-efficient way for large arrays
        const CHUNK_SIZE = 8192;
        for (let i = 0; i < pictureData.length; i += CHUNK_SIZE) {
            const chunk = pictureData.slice(i, i + CHUNK_SIZE);
            base64Data += String.fromCharCode.apply(null, Array.from(chunk));
        }
        base64Data = encode(base64Data);
    } catch (e) {
        console.warn('[FlacParser] Base64 encoding failed:', e);
        return null;
    }

    // Generate unique filename for this artwork
    await ensureArtworkCacheDir();
    const artworkFilename = generateArtworkFilename(flacUri, mimeType);
    const artworkUri = `${ARTWORK_CACHE_DIR}${artworkFilename}`;

    // Compress large images (> 500KB) to save disk space and loading time
    // Only attempt if ImageManipulator is available in the current build
    const COMPRESSION_THRESHOLD_KB = 500;
    const TARGET_SIZE = 500;

    if (originalSizeKB > COMPRESSION_THRESHOLD_KB && ImageManipulator.manipulateAsync) {
        try {
            const tempUri = `${ARTWORK_CACHE_DIR}temp_extract.${mimeType.includes('png') ? 'png' : 'jpg'}`;
            await FileSystem.writeAsStringAsync(tempUri, base64Data, {
                encoding: FileSystem.EncodingType.Base64,
            });

            const compressed = await ImageManipulator.manipulateAsync(
                tempUri,
                [{ resize: { width: TARGET_SIZE, height: TARGET_SIZE } }],
                {
                    compress: 0.8,
                    format: ImageManipulator.SaveFormat.JPEG,
                }
            );

            await FileSystem.deleteAsync(tempUri, { idempotent: true });

            // Move compressed file to permanent cache location
            await FileSystem.moveAsync({
                from: compressed.uri,
                to: artworkUri,
            });

            console.log(`[FlacParser] Compressed & Saved: ${originalSizeKB}KB → File`);
            return {
                description,
                pictureData: artworkUri,
                mimeType: 'image/jpeg',
                type: pictureType,
            };
        } catch (error) {
            console.warn(`[FlacParser] Compression failed, saving original:`, error);
        }
    }

    // Save original image to file
    await FileSystem.writeAsStringAsync(artworkUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
    });
    console.log(`[FlacParser] Saved original artwork to: ${artworkFilename} (${originalSizeKB}KB)`);

    return {
        description,
        pictureData: artworkUri,
        mimeType,
        type: pictureType,
    };
}

/**
 * Extract metadata from a FLAC file including embedded artwork
 */
export async function extractFlacMetadata(uri: string): Promise<FlacMetadata | null> {
    try {
        const fileUri = uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}`;

        // Read the first 4 bytes to check for FLAC magic number
        const header = await readBytes(fileUri, 0, 4);
        const magic = bytesToString(header);

        if (magic !== FLAC_MAGIC) {
            console.debug(`[FlacParser] Not a FLAC file: ${uri}`);
            return null;
        }

        console.debug(`[FlacParser] Parsing FLAC file: ${uri}`);

        const result: FlacMetadata = {};
        let position = 4; // After "fLaC" magic
        let isLastBlock = false;
        let bestPicture: FlacMetadata['picture'] | null = null;

        // Read metadata blocks
        while (!isLastBlock) {
            // Read block header (1 byte type + 3 bytes length)
            const blockHeader = await readBytes(fileUri, position, 4);
            position += 4;

            // Parse header
            const isLast = (blockHeader[0] & 0x80) !== 0;
            const blockType = blockHeader[0] & 0x7F;
            const blockLength = readUint24BE(blockHeader, 1);

            isLastBlock = isLast;

            // Read block data
            if (blockLength > 0 && blockLength < 10 * 1024 * 1024) { // Max 10MB per block
                const blockData = await readBytes(fileUri, position, blockLength);

                if (blockType === BLOCK_TYPE_VORBIS_COMMENT) {
                    const comments = parseVorbisComment(blockData);
                    result.title = comments['TITLE'];
                    result.artist = comments['ARTIST'];
                    result.album = comments['ALBUM'];
                    result.genre = comments['GENRE'];
                    result.year = comments['DATE'] || comments['YEAR'];
                    result.trackNumber = comments['TRACKNUMBER'];
                    console.debug(`[FlacParser] Found Vorbis comments: title="${result.title}", artist="${result.artist}", album="${result.album}"`);
                } else if (blockType === BLOCK_TYPE_STREAMINFO) {
                    const streamInfo = parseStreamInfo(blockData);
                    if (streamInfo) {
                        result.sampleRate = streamInfo.sampleRate;
                        result.bitDepth = streamInfo.bitDepth;
                        result.channels = streamInfo.channels;
                        result.format = 'FLAC';
                    }
                } else if (blockType === BLOCK_TYPE_PICTURE) {
                    const picture = await parsePictureBlock(blockData, fileUri);
                    if (picture) {
                        // Prefer front cover (type 3), otherwise take any
                        if (!bestPicture || picture.type === PICTURE_TYPE_FRONT_COVER) {
                            bestPicture = picture;
                            console.debug(`[FlacParser] Found picture: type=${picture.type}, mime=${picture.mimeType}, size=${picture.pictureData.length}`);
                        }
                    }
                }
            }

            position += blockLength;

            // Safety limit
            if (position > 50 * 1024 * 1024) { // 50MB limit
                console.debug('[FlacParser] Position limit reached, stopping');
                break;
            }
        }

        if (bestPicture) {
            result.picture = bestPicture;
        }

        return result;
    } catch (error) {
        console.debug(`[FlacParser] Error parsing FLAC: ${error}`);
        return null;
    }
}

/**
 * Check if a file is a FLAC file based on extension
 */
export function isFlacFile(uri: string): boolean {
    return /\.flac(?:$|[?#])/i.test(uri);
}
