// Local file handles are part of the durable catalog. They are kept in the
// catalog IndexedDB database alongside metadata and artwork so reopening the
// PWA never needs a folder walk to rebuild playback state.
import {
  clearLibraryFileHandles,
  getLibraryFileHandle,
  getLibraryFileHandleKeys,
  saveLibraryFileHandles,
} from './webPersistence';

type FileSystemPermissionMode = 'read' | 'readwrite';
type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';
type FileSystemHandlePermissionDescriptor = { mode?: FileSystemPermissionMode };
type PermissionedFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
};

export async function saveTrackFileHandle(trackId: string, handle: FileSystemFileHandle): Promise<void> {
  await saveLibraryFileHandles([[trackId, handle]]);
}

export const saveTrackFileHandles = saveLibraryFileHandles;
export const getTrackFileHandle = getLibraryFileHandle;
export const getAllTrackHandleKeys = getLibraryFileHandleKeys;
export const clearTrackFileHandles = clearLibraryFileHandles;

export async function verifyFileHandlePermission(
  handle: FileSystemFileHandle,
  withPrompt = false,
): Promise<boolean> {
  const permissioned = handle as PermissionedFileHandle;
  if (!permissioned.queryPermission) return true;
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'read' };
  if ((await permissioned.queryPermission(opts)) === 'granted') return true;
  if (withPrompt && permissioned.requestPermission) {
    return (await permissioned.requestPermission(opts)) === 'granted';
  }
  return false;
}
