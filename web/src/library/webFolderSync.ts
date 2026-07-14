// The selected root folder is a source pointer in the same durable catalog DB
// as the tracks, their artwork, and their per-file handles.
import {
  deleteLibraryFolderHandle,
  getLibraryFolderHandle,
  saveLibraryFolderHandle,
} from '../storage/webPersistence';

type FileSystemPermissionMode = 'read' | 'readwrite';
type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';
type FileSystemHandlePermissionDescriptor = { mode?: FileSystemPermissionMode };
type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
};

export const saveFolderHandle = saveLibraryFolderHandle;
export const getFolderHandle = getLibraryFolderHandle;
export const deleteFolderHandle = deleteLibraryFolderHandle;

/** Resolve a file on demand; this is never used while opening the PWA. */
export async function getFileHandleByRelativePath(
  dir: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle | null> {
  const parts = relativePath.split('/').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const fileName = parts.pop() as string;
  let current: FileSystemDirectoryHandle = dir;
  try {
    for (const part of parts) current = await current.getDirectoryHandle(part);
    return await current.getFileHandle(fileName);
  } catch {
    return null;
  }
}

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  withPrompt = false,
): Promise<boolean> {
  const permissioned = handle as PermissionedDirectoryHandle;
  if (!permissioned.queryPermission) return true;
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'read' };
  if ((await permissioned.queryPermission(opts)) === 'granted') return true;
  if (withPrompt && permissioned.requestPermission) {
    return (await permissioned.requestPermission(opts)) === 'granted';
  }
  return false;
}
