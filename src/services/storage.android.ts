import { requireOptionalNativeModule } from 'expo-modules-core';
import { FileSystemStorage as legacyStorage } from './storage.legacy';

interface NativeStorage {
    getItem(name: string): Promise<string | null>;
    setItem(name: string, value: string): Promise<void>;
    removeItem(name: string): Promise<void>;
}

// Existing APKs keep the previous adapter. New APKs serialize legacy access through
// Kotlin's runtime lease. A rejected native operation must NEVER fall back to a JS write.
const native = requireOptionalNativeModule<NativeStorage>('StaySoundCoreStorage');
export const FileSystemStorage: NativeStorage = native ? {
    getItem: name => native.getItem(name),
    setItem: (name, value) => native.setItem(name, value),
    removeItem: name => native.removeItem(name),
} : legacyStorage;
