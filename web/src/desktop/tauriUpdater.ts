export type DesktopUpdate = {
  version: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: { event: string; data: unknown }) => void) => Promise<void>;
};

/** Checks for an update only in the desktop build; the browser build has no updater. */
export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null;

  const { check } = await import('@tauri-apps/plugin-updater');
  return check();
}

export async function relaunchDesktop(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
