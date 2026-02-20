import * as FileSystem from 'expo-file-system/legacy';

const STORAGE_DIR = `${FileSystem.documentDirectory}storage/`;

/**
 * Custom storage for Zustand persistence using Expo FileSystem
 */
export const FileSystemStorage = {
    getItem: async (name: string): Promise<string | null> => {
        try {
            const fileUri = `${STORAGE_DIR}${name}.json`;
            const info = await FileSystem.getInfoAsync(fileUri);

            if (info.exists) {
                return await FileSystem.readAsStringAsync(fileUri);
            }
            return null;
        } catch (error) {
            console.error(`[FileSystemStorage] Error reading ${name}:`, error);
            return null;
        }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        try {
            // Ensure directory exists
            const dirInfo = await FileSystem.getInfoAsync(STORAGE_DIR);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(STORAGE_DIR, { intermediates: true });
            }

            const fileUri = `${STORAGE_DIR}${name}.json`;
            await FileSystem.writeAsStringAsync(fileUri, value);
        } catch (error) {
            console.error(`[FileSystemStorage] Error writing ${name}:`, error);
        }
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            const fileUri = `${STORAGE_DIR}${name}.json`;
            await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (error) {
            console.error(`[FileSystemStorage] Error removing ${name}:`, error);
        }
    },
};
