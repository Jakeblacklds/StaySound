const DB_NAME = 'staysound_download_folder_v1';
const STORE_NAME = 'handles';
const KEY = 'download_folder';
const FILE_HANDLES_STORE_NAME = 'downloaded_files';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

type FileSystemPermissionMode = 'read' | 'readwrite';
type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';
type FileSystemHandlePermissionDescriptor = { mode?: FileSystemPermissionMode };
type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
};
type PermissionedFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
};

export function canPickDownloadFolder(): boolean {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function pickDownloadFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error('Este navegador no permite elegir una carpeta destino.');
  }

  const handle = await picker({ mode: 'readwrite' });
  await saveDownloadFolderHandle(handle);
  return handle;
}

export function saveDownloadFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(FILE_HANDLES_STORE_NAME)) request.result.createObjectStore(FILE_HANDLES_STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put(handle, KEY);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
      tx.oncomplete = () => db.close();
    };
    request.onerror = () => reject(request.error);
  });
}

export function getDownloadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(FILE_HANDLES_STORE_NAME)) request.result.createObjectStore(FILE_HANDLES_STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(KEY);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    };
    request.onerror = () => resolve(null);
  });
}

export async function verifyDownloadFolderPermission(
  handle: FileSystemDirectoryHandle,
  withPrompt = false,
): Promise<boolean> {
  const permissionedHandle = handle as PermissionedDirectoryHandle;
  if (!permissionedHandle.queryPermission) return true;

  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  if ((await permissionedHandle.queryPermission(opts)) === 'granted') {
    return true;
  }
  if (withPrompt && permissionedHandle.requestPermission) {
    return (await permissionedHandle.requestPermission(opts)) === 'granted';
  }
  return false;
}

export async function writeBlobToDownloadFolder(
  handle: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<{ file: File; fileHandle: FileSystemFileHandle }> {
  const granted = await verifyDownloadFolderPermission(handle, true);
  if (!granted) {
    throw new Error('StaySound no tiene permiso para escribir en esa carpeta.');
  }

  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { file: await fileHandle.getFile(), fileHandle };
}

export function saveDownloadedFileHandle(trackId: string, handle: FileSystemFileHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(FILE_HANDLES_STORE_NAME)) request.result.createObjectStore(FILE_HANDLES_STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(FILE_HANDLES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FILE_HANDLES_STORE_NAME);
      const putReq = store.put(handle, trackId);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
      tx.oncomplete = () => db.close();
    };
    request.onerror = () => reject(request.error);
  });
}

export function getDownloadedFileHandle(trackId: string): Promise<FileSystemFileHandle | null> {
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(FILE_HANDLES_STORE_NAME)) request.result.createObjectStore(FILE_HANDLES_STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(FILE_HANDLES_STORE_NAME, 'readonly');
      const store = tx.objectStore(FILE_HANDLES_STORE_NAME);
      const getReq = store.get(trackId);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    };
    request.onerror = () => resolve(null);
  });
}

export async function verifyFilePermission(
  handle: FileSystemFileHandle,
  withPrompt = false,
): Promise<boolean> {
  const permissionedHandle = handle as PermissionedFileHandle;
  if (!permissionedHandle.queryPermission) return true;

  const opts: FileSystemHandlePermissionDescriptor = { mode: 'read' };
  if ((await permissionedHandle.queryPermission(opts)) === 'granted') return true;
  if (withPrompt && permissionedHandle.requestPermission) {
    return (await permissionedHandle.requestPermission(opts)) === 'granted';
  }
  return false;
}
