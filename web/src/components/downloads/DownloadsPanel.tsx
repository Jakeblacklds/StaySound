import type { TidalTrack, Track } from '@staysound/types/audio';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  configureSoulseekShares,
  isSoulseekMusicSharingEnabled,
  SOULSEEK_SHARE_MUSIC_KEY,
  invalidateSoulseekMatches,
  isSoulseekBridgeAvailable,
  loadSoulseekCredentials,
  monochromeDownloadProvider,
  rescanSoulseekShares,
  saveSoulseekCredentials,
  soulseekDownloadProvider,
  warmSoulseekBridge,
  type DownloadActivity,
  type DownloadSearchResult,
  type DownloadSource,
  type SoulseekShareStatus,
} from '../../downloads/downloadProvider';
import {
  albumsFromTracks,
  artistsFromTracks,
  searchCatalog,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogSearch,
} from '../../downloads/monochromeCatalog';
import {
  loadRecentCatalogItems,
  recentItemKey,
  saveRecentCatalogItems,
  type RecentCatalogItem,
} from '../../downloads/recentCatalogItems';
import {
  canPickDownloadFolder,
  getDownloadFolderHandle,
  pickDownloadFolder,
  verifyDownloadFolderPermission,
} from '../../downloads/webDownloadFolder';
import {
  getDesktopMusicFolder,
  isTauriDesktop,
  pickDesktopMusicFolder,
} from '../../desktop/tauriMusicLibrary';
import { DesktopRequiredNotice } from '../DesktopRequiredNotice';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FolderIcon,
  GearIcon,
  SearchIcon,
  SpinnerIcon,
} from '../icons';
import {
  DownloadBrowseView,
  type DownloadCatalogFilter,
} from './DownloadBrowseView';
import { DownloadAlbumView } from './DownloadAlbumView';
import { DownloadArtistView } from './DownloadArtistView';
import {
  ProgressRing,
  formatBytes,
  type DownloadItemState,
  type DownloadsCatalogApi,
} from './downloadUi';

/**
 * Descargas.
 *
 * La pestaña dejó de ser una lista plana de resultados: ahora es un catálogo
 * navegable (búsqueda → artista → álbum → canción) montado sobre una pila de
 * rutas propia, porque el shell de la app solo conoce "tabs" y este flujo
 * necesita ir y volver sin perder la búsqueda.
 *
 * El motor de cola (resolver → transferir → importar) es el mismo de siempre;
 * lo que cambió es dónde vive su ruido: el detalle por descarga se movió a un
 * cajón de Actividad para que la vista principal sea catálogo, no diagnóstico.
 */

/** Lo justo para no disparar una búsqueda por cada tecla, sin que se sienta lento. */
const SEARCH_AS_YOU_TYPE_DELAY_MS = 260;
const SEARCH_AS_YOU_TYPE_MIN_CHARS = 2;

type DownloadQueueStatus = 'queued' | 'resolving' | 'downloading' | 'done' | 'error';

type DownloadQueueItem = {
  queueId: string;
  source: DownloadSource;
  result: DownloadSearchResult;
  tidalId?: number;
  status: DownloadQueueStatus;
  progress: number;
  message?: string;
  activity?: DownloadActivity;
  history: Array<{ at: number; message: string; detail?: string }>;
  startedAt?: number;
  updatedAt: number;
  rawError?: string;
};

type DownloadRoute =
  | { kind: 'browse' }
  | { kind: 'album'; id: number; seed?: CatalogAlbum }
  | { kind: 'artist'; id: number; seed?: CatalogArtist };

/**
 * Historial propio del catálogo, como las flechas ‹ › de Spotify: ir atrás no
 * destruye lo que había adelante, y cada entrada recuerda hasta dónde se había
 * bajado para volver exactamente al mismo punto.
 */
type DownloadHistory = {
  entries: Array<{ route: DownloadRoute; scrollTop: number }>;
  index: number;
};

function sameRoute(left: DownloadRoute, right: DownloadRoute): boolean {
  if (left.kind === 'browse' || right.kind === 'browse') return left.kind === right.kind;
  return left.kind === right.kind && left.id === right.id;
}

/** El área que hace scroll no es el panel sino el contenedor del shell. */
function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

const DOWNLOAD_STAGE_LABELS: Record<DownloadActivity['stage'], string> = {
  connecting: 'Conectando',
  peer: 'Buscando fuente',
  transfer: 'Transfiriendo',
  reading: 'Leyendo archivo',
  importing: 'Validando audio',
  metadata: 'Guardando metadatos',
  saving: 'Guardando',
};

function downloadFailureExplanation(item: DownloadQueueItem): string {
  const raw = item.rawError || item.message || '';
  const stage = item.activity?.stage;
  if (/load failed|failed to fetch|fetch is aborted/i.test(raw)) {
    if (stage === 'reading' || stage === 'importing') {
      return 'Soulseek sí entregó el archivo, pero StaySound falló al abrirlo o importarlo en la biblioteca local.';
    }
    return 'StaySound perdió comunicación con el bridge local antes de recibir una respuesta completa.';
  }
  if (/econnreset|connection reset|socket.*closed/i.test(raw)) {
    return 'El peer remoto cerró su conexión. No es un bloqueo global de Soulseek; conviene intentar otra fuente.';
  }
  if (/peer unavailable after address refresh|user not exist/i.test(raw)) {
    return 'Soulseek actualizó la dirección del usuario, pero ese peer ya no estaba conectado. El reintento hará una búsqueda nueva.';
  }
  if (/banned/i.test(raw)) return 'Ese usuario de Soulseek rechazó esta cuenta. Otro peer todavía puede tener el archivo.';
  if (/timeout|tardó demasiado|timed out/i.test(raw)) return 'La fuente no respondió dentro del límite; puede estar offline, en cola o ser muy lenta.';
  if (stage === 'peer' || stage === 'transfer') return 'La fuente P2P seleccionada no pudo completar la transferencia.';
  return `La operación falló durante “${stage ? DOWNLOAD_STAGE_LABELS[stage] : 'resolución'}”.`;
}

function formatDownloadElapsed(item: DownloadQueueItem): string {
  if (!item.startedAt) return 'sin iniciar';
  const seconds = Math.max(1, Math.round((item.updatedAt - item.startedAt) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function getDownloadProvider(source: DownloadSource) {
  return source === 'soulseek' ? soulseekDownloadProvider : monochromeDownloadProvider;
}


export function DownloadsPanel({
  onDownloaded,
  onGetApp,
}: {
  onDownloaded: (track: Track) => Promise<void>;
  onGetApp: () => void;
}) {
  const source: DownloadSource = 'soulseek';
  const [history, setHistory] = useState<DownloadHistory>({ entries: [{ route: { kind: 'browse' }, scrollTop: 0 }], index: 0 });
  const [queryDraft, setQueryDraft] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<CatalogSearch | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DownloadCatalogFilter>('all');
  const [recentItems, setRecentItems] = useState<RecentCatalogItem[]>(loadRecentCatalogItems);

  const [downloadFolder, setDownloadFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [needsFolderPermission, setNeedsFolderPermission] = useState(false);
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [soulseekBridgeReady, setSoulseekBridgeReady] = useState<boolean | null>(null);
  const [soulseekUsername, setSoulseekUsername] = useState(() => loadSoulseekCredentials()?.username ?? '');
  const [soulseekPassword, setSoulseekPassword] = useState(() => loadSoulseekCredentials()?.password ?? '');
  const [hasSoulseekCredentials, setHasSoulseekCredentials] = useState(() => Boolean(loadSoulseekCredentials()));
  const [desktopMusicFolder, setDesktopMusicFolder] = useState<string | null>(null);
  const [shareMusicFolder, setShareMusicFolder] = useState(isSoulseekMusicSharingEnabled);
  const [shareStatus, setShareStatus] = useState<SoulseekShareStatus | null>(null);
  const [shareBusy, setShareBusy] = useState(false);

  const queueRef = useRef<DownloadQueueItem[]>([]);
  const folderRef = useRef<FileSystemDirectoryHandle | null>(null);
  const processingQueueRef = useRef(false);
  const onDownloadedRef = useRef(onDownloaded);
  const searchRunRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const activeQueryRef = useRef('');

  const route = history.entries[history.index].route;
  const canGoBack = history.index > 0;
  const canGoForward = history.index < history.entries.length - 1;

  // Soulseek necesita una conexión TCP directa, que solo abre el bridge que
  // viene con las builds de escritorio. Si el health check ya respondió que no
  // fuera de Tauri, insistir es inútil: mejor ofrecer la app.
  const needsDesktopApp = !isTauriDesktop() && soulseekBridgeReady === false;

  const activeDownload = downloadQueue.find(item => item.status === 'resolving' || item.status === 'downloading');
  const queuedCount = downloadQueue.filter(item => item.status === 'queued').length;
  const finishedCount = downloadQueue.filter(item => item.status === 'done').length;
  const failedCount = downloadQueue.filter(item => item.status === 'error').length;
  const inFlightCount = downloadQueue.filter(item => (
    item.status === 'queued' || item.status === 'resolving' || item.status === 'downloading'
  )).length;

  const trackStates = useMemo(() => {
    const map = new Map<number, DownloadItemState>();
    for (const item of downloadQueue) {
      if (!item.tidalId) continue;
      // "Lista" es pegajosa: un reintento posterior no debe borrar el hecho de
      // que esa canción ya está en la biblioteca.
      if (map.get(item.tidalId)?.status === 'done') continue;
      map.set(item.tidalId, { status: item.status, progress: item.progress });
    }
    return map;
  }, [downloadQueue]);

  useEffect(() => { queueRef.current = downloadQueue; }, [downloadQueue]);
  useEffect(() => { folderRef.current = downloadFolder; }, [downloadFolder]);
  useEffect(() => { onDownloadedRef.current = onDownloaded; }, [onDownloaded]);

  useEffect(() => {
    void getDownloadFolderHandle().then(async handle => {
      if (!handle) return;
      setDownloadFolder(handle);
      setNeedsFolderPermission(!(await verifyDownloadFolderPermission(handle, false)));
    });
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    void getDesktopMusicFolder().then(setDesktopMusicFolder);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSoulseekBridgeReady(null);
    void warmSoulseekBridge()
      .then(() => isSoulseekBridgeAvailable())
      .then(async ready => {
        if (!cancelled) setSoulseekBridgeReady(ready);
        if (ready && shareMusicFolder && desktopMusicFolder) {
          const shares = await configureSoulseekShares([desktopMusicFolder]);
          if (!cancelled) setShareStatus(shares);
        }
      })
      .catch(error => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'No se pudo configurar la carpeta compartida.');
      });
    return () => { cancelled = true; };
  }, [shareMusicFolder, desktopMusicFolder]);

  // Los avisos son transitorios: informan del paso que acaba de ocurrir, no son
  // un estado permanente de la pantalla.
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const currentScrollTop = useCallback(() => scrollParentOf(panelRef.current)?.scrollTop ?? 0, []);

  const navigate = useCallback((next: DownloadRoute) => {
    const scrollTop = currentScrollTop();
    setHistory(state => {
      const current = state.entries[state.index];
      if (sameRoute(current.route, next)) return state;
      const entries = state.entries.slice(0, state.index + 1);
      entries[state.index] = { ...current, scrollTop };
      pendingScrollRef.current = 0;
      return { entries: [...entries, { route: next, scrollTop: 0 }], index: state.index + 1 };
    });
  }, [currentScrollTop]);

  const jumpTo = useCallback((resolveIndex: (state: DownloadHistory) => number) => {
    const scrollTop = currentScrollTop();
    setHistory(state => {
      const index = resolveIndex(state);
      if (index < 0 || index >= state.entries.length || index === state.index) return state;
      const entries = [...state.entries];
      entries[state.index] = { ...entries[state.index], scrollTop };
      pendingScrollRef.current = entries[index].scrollTop;
      return { entries, index };
    });
  }, [currentScrollTop]);

  const goBack = useCallback(() => jumpTo(state => state.index - 1), [jumpTo]);
  const goForward = useCallback(() => jumpTo(state => state.index + 1), [jumpTo]);

  // Restaura el scroll de la entrada a la que se llegó. Los detalles cargan
  // desde la caché del catálogo, así que casi siempre la altura ya está; el
  // segundo intento cubre el frame en que el contenido aún se está montando.
  useLayoutEffect(() => {
    const target = pendingScrollRef.current;
    if (target === null) return undefined;
    pendingScrollRef.current = null;
    const scroller = scrollParentOf(panelRef.current);
    if (!scroller) return undefined;
    scroller.scrollTop = target;
    if (target === 0) return undefined;
    const frame = window.requestAnimationFrame(() => { scroller.scrollTop = target; });
    return () => window.cancelAnimationFrame(frame);
  }, [history]);

  // Atajos del catálogo: Esc / ⌘[ atrás, ⌘] adelante, los botones laterales
  // del ratón, y "/" o ⌘K para ir al buscador. Las flechas solas (incluso con
  // Alt) ya son del reproductor, y con un diálogo abierto el teclado es suyo.
  useEffect(() => {
    if (showActivity || showSettings) return undefined;
    function isTyping(target: EventTarget | null) {
      const element = target as HTMLElement | null;
      return Boolean(element && (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable));
    }
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const meta = event.metaKey || event.ctrlKey;
      if ((meta && event.key.toLowerCase() === 'k') || (event.key === '/' && !isTyping(event.target))) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === 'Escape' || (meta && event.key === '[')) {
        event.preventDefault();
        goBack();
      } else if (meta && event.key === ']') {
        event.preventDefault();
        goForward();
      }
    }
    function handleMouse(event: MouseEvent) {
      if (event.button === 3) { event.preventDefault(); goBack(); }
      if (event.button === 4) { event.preventDefault(); goForward(); }
    }
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mouseup', handleMouse);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mouseup', handleMouse);
    };
  }, [goBack, goForward, showActivity, showSettings]);

  const rememberItem = useCallback((item: RecentCatalogItem) => {
    setRecentItems(previous => {
      const key = recentItemKey(item);
      return saveRecentCatalogItems([item, ...previous.filter(entry => recentItemKey(entry) !== key)]);
    });
  }, []);

  const forgetItem = useCallback((item: RecentCatalogItem) => {
    const key = recentItemKey(item);
    setRecentItems(previous => saveRecentCatalogItems(previous.filter(entry => recentItemKey(entry) !== key)));
  }, []);

  const clearRecentItems = useCallback(() => setRecentItems(saveRecentCatalogItems([])), []);

  /**
   * `syncInput` solo cuando la búsqueda viene de fuera del campo (recientes):
   * mientras se escribe, reescribir el input se comería el espacio que el
   * usuario acaba de teclear.
   */
  async function runSearch(term: string, { syncInput = false } = {}) {
    const trimmed = term.trim();
    if (!trimmed) return;
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;

    if (syncInput) setQueryDraft(trimmed);
    setActiveQuery(trimmed);
    activeQueryRef.current = trimmed;
    if (route.kind !== 'browse') navigate({ kind: 'browse' });
    setIsSearching(true);
    setSearchError(null);
    try {
      const found = await searchCatalog(trimmed);
      if (searchRunRef.current !== runId) return;
      setResults(found);
    } catch (error) {
      if (searchRunRef.current !== runId) return;
      // Red de seguridad: el proveedor de descargas mantiene su propio catálogo
      // de instancias con reintentos y bloqueos. Si el barrido directo de
      // mirrors falló, al menos las canciones (y los álbumes/artistas que se
      // deducen de ellas) siguen apareciendo.
      const fallbackTracks = await soulseekDownloadProvider.search(trimmed)
        .then(items => items.map(item => item.raw as TidalTrack).filter(Boolean))
        .catch(() => [] as TidalTrack[]);
      if (searchRunRef.current !== runId) return;
      if (fallbackTracks.length > 0) {
        setResults({
          tracks: fallbackTracks,
          albums: albumsFromTracks(fallbackTracks),
          artists: artistsFromTracks(fallbackTracks),
        });
        return;
      }
      setResults(null);
      setSearchError(error instanceof Error ? error.message : 'Falló la búsqueda en Monochrome.');
    } finally {
      if (searchRunRef.current === runId) setIsSearching(false);
    }
  }

  // Búsqueda mientras se escribe, como en Spotify: sin botón ni Enter. Vaciar
  // el campo vuelve a la portada de recientes.
  useEffect(() => {
    const trimmed = queryDraft.trim();
    if (!trimmed) {
      searchRunRef.current += 1;
      activeQueryRef.current = '';
      setActiveQuery('');
      setResults(null);
      setIsSearching(false);
      setSearchError(null);
      setFilter('all');
      return undefined;
    }
    if (trimmed.length < SEARCH_AS_YOU_TYPE_MIN_CHARS || trimmed === activeQueryRef.current) return undefined;
    const timer = window.setTimeout(() => { void runSearch(trimmed); }, SEARCH_AS_YOU_TYPE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // runSearch se recrea en cada render; lo único que dispara esto es el texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft]);

  function updateQueueItem(queueId: string, patch: Partial<DownloadQueueItem>) {
    queueRef.current = queueRef.current.map(item => (
      item.queueId === queueId ? { ...item, ...patch } : item
    ));
    setDownloadQueue(items => items.map(item => (
      item.queueId === queueId ? { ...item, ...patch } : item
    )));
  }

  async function ensureDownloadFolder(): Promise<FileSystemDirectoryHandle | null | undefined> {
    let targetFolder = folderRef.current;
    if (canPickDownloadFolder() && !targetFolder) {
      try {
        targetFolder = await pickDownloadFolder();
        setDownloadFolder(targetFolder);
        folderRef.current = targetFolder;
        setNeedsFolderPermission(false);
        setMessage(`Descargas guardadas en "${targetFolder.name}".`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return undefined;
        setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.');
        return undefined;
      }
    }
    return targetFolder;
  }

  /**
   * En escritorio (Tauri) no existe showDirectoryPicker: las descargas caen en
   * la carpeta de música nativa, así que basta con que haya una recordada.
   */
  async function ensureDownloadTarget(): Promise<boolean> {
    if (isTauriDesktop()) {
      const nativeFolder = await getDesktopMusicFolder().catch(() => null);
      if (nativeFolder) return true;
      try {
        const picked = await pickDesktopMusicFolder();
        if (picked) {
          setDesktopMusicFolder(picked);
          setMessage(`Las descargas se guardarán en "${picked}".`);
          return true;
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta de música.');
        return false;
      }
      setMessage('Selecciona tu carpeta de música para guardar las descargas.');
      return false;
    }

    const targetFolder = await ensureDownloadFolder();
    if (!targetFolder) {
      setMessage('Elige una carpeta de descargas para que la música siga disponible al cerrar StaySound.');
      return false;
    }
    return true;
  }

  function toDownloadResult(track: TidalTrack): DownloadSearchResult {
    return {
      // Id estable por canción: la misma pista abierta desde la búsqueda, el
      // álbum o el artista comparte estado en la cola.
      id: `soulseek_catalog_monochrome_${track.id}`,
      source,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artworkUrl,
      quality: track.quality,
      durationMs: track.durationMs,
      raw: track,
    };
  }

  function enqueueDownloads(tracks: TidalTrack[]) {
    if (tracks.length === 0) return;
    const queuedItems = tracks.map((track, index): DownloadQueueItem => ({
      queueId: `${source}:${track.id}:${Date.now()}:${index}`,
      source,
      result: toDownloadResult(track),
      tidalId: track.id,
      status: 'queued',
      progress: 0,
      message: 'En cola',
      history: [{ at: Date.now(), message: 'Añadida a la cola' }],
      updatedAt: Date.now(),
    }));
    queueRef.current = [...queueRef.current, ...queuedItems];
    setDownloadQueue(queue => [...queue, ...queuedItems]);
    setMessage(`${tracks.length} descarga${tracks.length === 1 ? '' : 's'} en cola.`);
  }

  async function processDownloadQueue() {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    try {
      const worker = async () => {
        while (true) {
          const next = queueRef.current.find(item => item.status === 'queued');
          if (!next) return;
          const itemProvider = getDownloadProvider(next.source);
          // updateQueueItem muta queueRef de forma síncrona, así que otro worker
          // no puede reclamar el mismo elemento.
          updateQueueItem(next.queueId, { status: 'resolving', progress: 0.03, message: 'Buscando peer rápido...' });
          try {
            const startedAt = Date.now();
            updateQueueItem(next.queueId, {
              startedAt,
              updatedAt: startedAt,
              history: [...next.history, { at: startedAt, message: 'Buscando coincidencias y fuentes disponibles' }],
            });
            const resolved = await itemProvider.resolveDownload(next.result);
            updateQueueItem(next.queueId, {
              status: 'downloading',
              progress: 0.08,
              message: next.source === 'soulseek' ? 'Contactando fuentes Soulseek...' : 'Preparando servidor de audio...',
              updatedAt: Date.now(),
            });
            const track = await itemProvider.download(resolved, {
              folderHandle: folderRef.current,
              onActivity: activity => {
                const current = queueRef.current.find(item => item.queueId === next.queueId);
                if (!current) return;
                const last = current.history[current.history.length - 1];
                const history = last?.message === activity.message && last?.detail === activity.detail
                  ? current.history
                  : [...current.history, { at: Date.now(), message: activity.message, detail: activity.detail }].slice(-8);
                updateQueueItem(next.queueId, {
                  activity,
                  message: activity.message,
                  history,
                  updatedAt: Date.now(),
                });
              },
              onProgress: value => updateQueueItem(next.queueId, {
                status: 'downloading',
                progress: value,
                updatedAt: Date.now(),
              }),
            });
            // Una descarga no está lista hasta que su entrada de catálogo,
            // portada y handle/ruta nativa quedaron guardados en la biblioteca.
            await onDownloadedRef.current(track);
            updateQueueItem(next.queueId, { status: 'done', progress: 1, message: 'Guardada en tu biblioteca', updatedAt: Date.now() });
            setMessage(`Descargado: ${track.title}.`);
          } catch (error) {
            updateQueueItem(next.queueId, {
              status: 'error',
              progress: 0,
              message: error instanceof Error ? error.message : 'No se pudo descargar.',
              rawError: error instanceof Error ? error.message : String(error),
              updatedAt: Date.now(),
            });
            setMessage(error instanceof Error ? error.message : 'No se pudo descargar.');
          }
        }
      };
      const concurrency = isTauriDesktop() ? 3 : 1;
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      processingQueueRef.current = false;
      const pending = queueRef.current.some(item => item.status === 'queued');
      if (pending) void processDownloadQueue();
    }
  }

  useEffect(() => {
    if (downloadQueue.some(item => item.status === 'queued')) {
      void processDownloadQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadQueue]);

  function retryQueueItem(queueId: string) {
    const item = queueRef.current.find(entry => entry.queueId === queueId);
    if (!item) return;
    if (item.source === 'soulseek') invalidateSoulseekMatches(item.result);
    const at = Date.now();
    updateQueueItem(queueId, {
      status: 'queued',
      progress: 0,
      message: 'Nuevo intento en cola',
      activity: undefined,
      rawError: undefined,
      startedAt: undefined,
      updatedAt: at,
      history: [{ at, message: 'Reintento solicitado; se volverán a evaluar las fuentes' }],
    });
  }

  const downloadTracks = useCallback(async (tracks: TidalTrack[]) => {
    const actionable = tracks.filter(track => {
      const existing = [...queueRef.current].reverse().find(item => item.tidalId === track.id);
      return !existing || existing.status === 'error';
    });
    if (actionable.length === 0) return;
    if (!(await ensureDownloadTarget())) return;

    const fresh: TidalTrack[] = [];
    for (const track of actionable) {
      const failed = [...queueRef.current].reverse().find(item => item.tidalId === track.id && item.status === 'error');
      if (failed) retryQueueItem(failed.queueId);
      else fresh.push(track);
    }
    enqueueDownloads(fresh);
    // Las funciones auxiliares viven en el cuerpo del componente y no cambian
    // de identidad de forma relevante para este callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lo que se abre o descarga desde los resultados de una búsqueda pasa a
  // "Recientes" (como en Spotify); navegar dentro de una ficha no.
  const fromSearch = route.kind === 'browse' && Boolean(activeQuery);
  const catalogApi: DownloadsCatalogApi = useMemo(() => ({
    getTrackState: (tidalId: number) => trackStates.get(tidalId),
    downloadTracks: tracks => {
      if (fromSearch && tracks.length === 1) rememberItem({ kind: 'track', track: tracks[0] });
      void downloadTracks(tracks);
    },
    openAlbum: album => {
      if (fromSearch) rememberItem({ kind: 'album', album });
      navigate({ kind: 'album', id: album.id, seed: album });
    },
    openArtist: artist => {
      if (fromSearch) rememberItem({ kind: 'artist', artist });
      navigate({ kind: 'artist', id: artist.id, seed: artist });
    },
  }), [trackStates, downloadTracks, fromSearch, rememberItem, navigate]);

  function openRecentItem(item: RecentCatalogItem) {
    rememberItem(item);
    if (item.kind === 'artist') navigate({ kind: 'artist', id: item.artist.id, seed: item.artist });
    else if (item.kind === 'album') navigate({ kind: 'album', id: item.album.id, seed: item.album });
    else if (item.kind === 'track') void runSearch(`${item.track.title} ${item.track.artist}`, { syncInput: true });
    else void runSearch(item.query, { syncInput: true });
  }

  async function handlePickDownloadFolder() {
    if (isTauriDesktop()) {
      try {
        const picked = await pickDesktopMusicFolder();
        if (picked) {
          setDesktopMusicFolder(picked);
          setMessage(`Las descargas se guardarán en "${picked}".`);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.');
      }
      return;
    }
    try {
      const handle = await pickDownloadFolder();
      setDownloadFolder(handle);
      setNeedsFolderPermission(false);
      setMessage(`Descargas guardadas en "${handle.name}".`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.');
    }
  }

  function handleSaveSoulseekCredentials() {
    try {
      saveSoulseekCredentials(soulseekUsername, soulseekPassword);
      setHasSoulseekCredentials(true);
      setMessage('Sesión de Soulseek guardada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la sesión de Soulseek.');
    }
  }

  async function handleToggleMusicSharing() {
    if (!desktopMusicFolder) {
      setMessage('Selecciona primero tu carpeta de música.');
      return;
    }
    const enabled = !shareMusicFolder;
    setShareBusy(true);
    try {
      const shares = await configureSoulseekShares(enabled ? [desktopMusicFolder] : []);
      setShareMusicFolder(enabled);
      window.localStorage.setItem(SOULSEEK_SHARE_MUSIC_KEY, enabled ? '1' : '0');
      setShareStatus(shares);
      setMessage(enabled
        ? `Soulseek anuncia ${shares.files} archivos de audio en ${shares.folders} carpetas.`
        : 'Tu carpeta de música dejó de compartirse; solo queda la carpeta administrada por StaySound.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cambiar la carpeta compartida.');
    } finally {
      setShareBusy(false);
    }
  }

  async function handleRescanMusicSharing() {
    setShareBusy(true);
    try {
      const shares = await rescanSoulseekShares();
      setShareStatus(shares);
      setMessage(`Reescaneo listo: ${shares.files} archivos de audio en ${shares.folders} carpetas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo reescanear la carpeta compartida.');
    } finally {
      setShareBusy(false);
    }
  }

  function handleClearFinishedDownloads() {
    const nextQueue = queueRef.current.filter(item => item.status !== 'done' && item.status !== 'error');
    queueRef.current = nextQueue;
    setDownloadQueue(nextQueue);
  }

  if (needsDesktopApp) {
    return (
      <section className="downloads-panel dl-panel">
        <DesktopRequiredNotice onGetApp={onGetApp} />
      </section>
    );
  }

  const bridgeLabel = soulseekBridgeReady === null
    ? 'Conectando con Soulseek…'
    : soulseekBridgeReady
      ? 'Soulseek conectado'
      : 'Soulseek no disponible';
  const bridgeTone = soulseekBridgeReady === null ? 'pending' : soulseekBridgeReady ? 'ok' : 'off';
  const folderLabel = isTauriDesktop()
    ? desktopMusicFolder?.split(/[\\/]/).filter(Boolean).slice(-1)[0]
    : downloadFolder?.name;

  const routeLabel = (item: DownloadRoute) => (
    item.kind === 'browse'
      ? (activeQuery ? `“${activeQuery}”` : 'Búsqueda')
      : item.kind === 'album' ? item.seed?.title ?? 'Álbum' : item.seed?.name ?? 'Artista'
  );
  // Solo el tramo hasta la entrada actual: lo que quedó "adelante" vive en la flecha ›.
  const trail = history.entries.slice(0, history.index + 1)
    .map((entry, index) => ({ index, label: routeLabel(entry.route) }))
    .slice(-3);

  return (
    <section className="downloads-panel dl-panel" ref={panelRef}>
      <header className="dl-header">
        <div className="dl-header-row">
          <div className="dl-history" role="group" aria-label="Historial">
            <button className="dl-nav-arrow" onClick={goBack} disabled={!canGoBack} aria-label="Atrás" title="Atrás (Esc · ⌘[)">
              <ChevronLeftIcon size={18} />
            </button>
            <button className="dl-nav-arrow" onClick={goForward} disabled={!canGoForward} aria-label="Adelante" title="Adelante (⌘])">
              <ChevronRightIcon size={18} />
            </button>
          </div>
          <form className="dl-search-field" role="search" onSubmit={event => {
            event.preventDefault();
            const trimmed = queryDraft.trim();
            if (!trimmed) return;
            rememberItem({ kind: 'query', query: trimmed });
            if (trimmed !== activeQuery || searchError) void runSearch(trimmed);
            else if (route.kind !== 'browse') navigate({ kind: 'browse' });
          }}>
            <SearchIcon size={18} />
            <input
              ref={searchInputRef}
              value={queryDraft}
              onChange={event => setQueryDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  if (queryDraft) setQueryDraft('');
                  else event.currentTarget.blur();
                }
              }}
              placeholder="¿Qué quieres descargar?"
              aria-label="Buscar música para descargar"
              spellCheck={false}
              autoComplete="off"
            />
            {isSearching
              ? <SpinnerIcon size={17} />
              : queryDraft
                ? (
                  <button type="button" className="dl-search-clear" onClick={() => { setQueryDraft(''); searchInputRef.current?.focus(); }} aria-label="Limpiar búsqueda">
                    <CloseIcon size={15} />
                  </button>
                )
                : <kbd className="dl-search-kbd" aria-hidden="true">⌘K</kbd>}
          </form>
          <div className="dl-header-actions">
            <button
              className={`dl-activity-btn ${inFlightCount > 0 ? 'busy' : ''} ${failedCount > 0 ? 'has-error' : ''}`.trim()}
              onClick={() => setShowActivity(true)}
              title="Actividad de descargas"
            >
              {activeDownload ? <ProgressRing value={activeDownload.progress} /> : <DownloadIcon size={16} />}
              <span>Actividad</span>
              {downloadQueue.length > 0 && (
                <span className={`dl-badge ${failedCount > 0 ? 'error' : ''}`.trim()}>
                  {inFlightCount > 0 ? inFlightCount : downloadQueue.length}
                </span>
              )}
            </button>
            <button
              className="dl-icon-btn"
              onClick={() => setShowSettings(true)}
              aria-label="Opciones de descargas"
              title="Opciones de descargas"
            >
              <GearIcon size={18} />
            </button>
          </div>
        </div>

        <div className="dl-status-line">
          {trail.length > 1 && (
            <>
              <nav className="dl-trail" aria-label="Ruta de navegación">
                {trail.map((crumb, position) => (
                  <span className="dl-trail-crumb" key={crumb.index}>
                    {position > 0 && <ChevronRightIcon size={11} />}
                    {crumb.index === history.index
                      ? <strong>{crumb.label}</strong>
                      : <button onClick={() => jumpTo(() => crumb.index)}>{crumb.label}</button>}
                  </span>
                ))}
              </nav>
              <span className="dl-status-sep" aria-hidden="true">·</span>
            </>
          )}
          <span className={`dl-dot ${bridgeTone}`} aria-hidden="true" />
          <span>{bridgeLabel}</span>
          <span className="dl-status-sep" aria-hidden="true">·</span>
          {folderLabel
            ? <span>Guardando en <strong>{folderLabel}</strong></span>
            : <button className="dl-text-btn" onClick={handlePickDownloadFolder}>Elegir carpeta de destino</button>}
          {needsFolderPermission && (
            <button className="dl-text-btn warn" onClick={handlePickDownloadFolder}>Reconectar carpeta</button>
          )}
        </div>

        {inFlightCount > 0 && (
          <div className="dl-header-progress" aria-hidden="true">
            <span style={{ width: `${Math.max(4, Math.round((activeDownload?.progress ?? 0) * 100))}%` }} />
          </div>
        )}
      </header>

      {message && (
        <div className="dl-message" role="status">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} aria-label="Cerrar aviso"><CloseIcon size={14} /></button>
        </div>
      )}

      <div className="dl-body" key={`${history.index}:${route.kind}:${'id' in route ? route.id : 'browse'}`}>
        {route.kind === 'browse' && (
          <DownloadBrowseView
            query={activeQuery}
            results={results}
            isSearching={isSearching}
            error={searchError}
            filter={filter}
            onFilterChange={setFilter}
            recentItems={recentItems}
            onOpenRecent={openRecentItem}
            onForgetRecent={forgetItem}
            onClearRecent={clearRecentItems}
            onRetry={() => void runSearch(activeQuery)}
            api={catalogApi}
          />
        )}
        {route.kind === 'album' && (
          <DownloadAlbumView albumId={route.id} seed={route.seed} api={catalogApi} />
        )}
        {route.kind === 'artist' && (
          <DownloadArtistView artistId={route.id} seed={route.seed} api={catalogApi} />
        )}
      </div>

      {showActivity && (
        <DownloadActivityDrawer
          queue={downloadQueue}
          finishedCount={finishedCount}
          failedCount={failedCount}
          queuedCount={queuedCount}
          onRetry={retryQueueItem}
          onClear={handleClearFinishedDownloads}
          onClose={() => setShowActivity(false)}
        />
      )}

      {showSettings && (
        <DownloadSettingsModal
          onClose={() => setShowSettings(false)}
          folderLabel={folderLabel}
          needsFolderPermission={needsFolderPermission}
          onPickFolder={handlePickDownloadFolder}
          bridgeLabel={bridgeLabel}
          bridgeTone={bridgeTone}
          soulseekUsername={soulseekUsername}
          soulseekPassword={soulseekPassword}
          hasSoulseekCredentials={hasSoulseekCredentials}
          onUsernameChange={setSoulseekUsername}
          onPasswordChange={setSoulseekPassword}
          onSaveCredentials={handleSaveSoulseekCredentials}
          desktopMusicFolder={desktopMusicFolder}
          shareMusicFolder={shareMusicFolder}
          shareStatus={shareStatus}
          shareBusy={shareBusy}
          onToggleSharing={() => void handleToggleMusicSharing()}
          onRescanSharing={() => void handleRescanMusicSharing()}
        />
      )}
    </section>
  );
}

/**
 * Cajón de Actividad: todo el detalle por descarga (etapa, peer, intentos,
 * bitácora y explicación del fallo) vive aquí en vez de empujar el catálogo
 * hacia abajo.
 */
function DownloadActivityDrawer({
  queue,
  finishedCount,
  failedCount,
  queuedCount,
  onRetry,
  onClear,
  onClose,
}: {
  queue: DownloadQueueItem[];
  finishedCount: number;
  failedCount: number;
  queuedCount: number;
  onRetry: (queueId: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 200);
  }, [closing, onClose]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleClose]);

  const ordered = [...queue].reverse();

  return (
    <div className={`dl-drawer-overlay ${closing ? 'closing' : ''}`.trim()} role="presentation" onClick={handleClose}>
      <aside
        className={`dl-drawer ${closing ? 'closing' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label="Actividad de descargas"
        onClick={event => event.stopPropagation()}
      >
        <header className="dl-drawer-head">
          <div>
            <h3>Actividad</h3>
            <small>
              {queue.length === 0
                ? 'Sin descargas todavía'
                : [
                  queuedCount > 0 ? `${queuedCount} en espera` : null,
                  finishedCount > 0 ? `${finishedCount} listas` : null,
                  failedCount > 0 ? `${failedCount} con error` : null,
                ].filter(Boolean).join(' · ') || 'Trabajando…'}
            </small>
          </div>
          <button className="dl-icon-btn" onClick={handleClose} aria-label="Cerrar actividad">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="dl-drawer-body">
          {ordered.length === 0 && (
            <p className="dl-inline-empty">Cuando descargues algo, aquí verás cada paso: fuente, velocidad e importación.</p>
          )}
          {ordered.map(item => {
            const isFailed = item.status === 'error';
            const activity = item.activity;
            const percent = Math.round(item.progress * 100);
            return (
              <article className={`dl-activity-item is-${item.status}`} key={item.queueId}>
                <div className="dl-activity-head">
                  <div className="dl-activity-copy">
                    <strong>{item.result.title}</strong>
                    <small>{item.result.artist} · {item.source === 'soulseek' ? 'Soulseek P2P' : 'Monochrome'}</small>
                  </div>
                  <span className={`dl-activity-state ${item.status}`}>
                    {isFailed
                      ? 'Falló'
                      : item.status === 'done'
                        ? 'Lista'
                        : item.status === 'queued'
                          ? 'En cola'
                          : activity
                            ? DOWNLOAD_STAGE_LABELS[activity.stage]
                            : `${percent}%`}
                  </span>
                </div>

                {(item.status === 'downloading' || item.status === 'resolving') && (
                  <span className="dl-activity-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(3, percent)}%` }} />
                  </span>
                )}

                <div className="dl-activity-detail">
                  <span>{isFailed ? downloadFailureExplanation(item) : (activity?.message || item.message)}</span>
                  {activity?.detail && <span className="muted">{activity.detail}</span>}
                  <span className="muted">
                    {activity?.peer ? `Peer: ${activity.peer} · ` : ''}
                    {activity?.attempt ? `intento ${activity.attempt} · ` : ''}
                    {activity?.total ? `${formatBytes(activity.received)} de ${formatBytes(activity.total)} · ` : ''}
                    tiempo: {formatDownloadElapsed(item)}
                  </span>
                  {isFailed && item.rawError && <code>{item.rawError}</code>}
                </div>

                <details className="dl-activity-log">
                  <summary>Ver bitácora ({item.history.length})</summary>
                  <ol>
                    {item.history.map((entry, index) => (
                      <li key={`${entry.at}-${index}`}>
                        <time>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                        <span>{entry.message}{entry.detail ? ` — ${entry.detail}` : ''}</span>
                      </li>
                    ))}
                  </ol>
                </details>

                {isFailed && (
                  <button className="dl-btn ghost" onClick={() => onRetry(item.queueId)}>
                    Reintentar buscando fuentes
                  </button>
                )}
              </article>
            );
          })}
        </div>

        <footer className="dl-drawer-foot">
          <button className="dl-btn ghost" onClick={onClear} disabled={!finishedCount && !failedCount}>
            Limpiar terminadas
          </button>
        </footer>
      </aside>
    </div>
  );
}

/** Ajustes de descarga: carpeta destino, sesión de Soulseek y qué compartes. */
function DownloadSettingsModal({
  onClose,
  folderLabel,
  needsFolderPermission,
  onPickFolder,
  bridgeLabel,
  bridgeTone,
  soulseekUsername,
  soulseekPassword,
  hasSoulseekCredentials,
  onUsernameChange,
  onPasswordChange,
  onSaveCredentials,
  desktopMusicFolder,
  shareMusicFolder,
  shareStatus,
  shareBusy,
  onToggleSharing,
  onRescanSharing,
}: {
  onClose: () => void;
  folderLabel?: string;
  needsFolderPermission: boolean;
  onPickFolder: () => void;
  bridgeLabel: string;
  bridgeTone: string;
  soulseekUsername: string;
  soulseekPassword: string;
  hasSoulseekCredentials: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSaveCredentials: () => void;
  desktopMusicFolder: string | null;
  shareMusicFolder: boolean;
  shareStatus: SoulseekShareStatus | null;
  shareBusy: boolean;
  onToggleSharing: () => void;
  onRescanSharing: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 200);
  }, [closing, onClose]);

  return (
    <div className={`dl-drawer-overlay ${closing ? 'closing' : ''}`.trim()} role="presentation" onClick={handleClose}>
      <section
        className={`dl-settings-modal ${closing ? 'closing' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dl-settings-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dl-drawer-head">
          <h3 id="dl-settings-title">Opciones de descarga</h3>
          <button className="dl-icon-btn" onClick={handleClose} aria-label="Cerrar opciones">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="dl-settings-body">
          <section className="dl-settings-block">
            <div className="dl-settings-block-head">
              <strong>Carpeta de destino</strong>
              <small>{folderLabel ?? 'Todavía no elegiste una carpeta'}</small>
            </div>
            <button
              className={`dl-btn ${needsFolderPermission ? 'danger' : 'ghost'}`}
              onClick={onPickFolder}
              disabled={!canPickDownloadFolder() && !isTauriDesktop()}
            >
              <FolderIcon size={16} />
              <span>{needsFolderPermission ? 'Reconectar carpeta' : folderLabel ? 'Cambiar carpeta' : 'Elegir carpeta'}</span>
            </button>
          </section>

          <section className="dl-settings-block">
            <div className="dl-settings-block-head">
              <strong>Sesión de Soulseek</strong>
              <small className={`dl-inline-status ${bridgeTone}`}>{bridgeLabel}</small>
            </div>
            <div className="dl-settings-fields">
              <input
                value={soulseekUsername}
                onChange={event => onUsernameChange(event.target.value)}
                placeholder="Usuario"
                autoComplete="off"
              />
              <input
                value={soulseekPassword}
                onChange={event => onPasswordChange(event.target.value)}
                placeholder="Contraseña"
                type="password"
                autoComplete="off"
              />
              <button className="dl-btn primary" onClick={onSaveCredentials}>
                {hasSoulseekCredentials ? 'Actualizar sesión' : 'Guardar sesión'}
              </button>
            </div>
          </section>

          {isTauriDesktop() && (
            <section className={`dl-settings-block share ${shareMusicFolder ? 'is-sharing' : ''}`.trim()}>
              <div className="dl-settings-block-head">
                <strong>{shareMusicFolder ? 'Compartiendo tu música' : 'Comparte tu carpeta de música'}</strong>
                <small title={desktopMusicFolder ?? undefined}>
                  {desktopMusicFolder ?? 'Todavía no seleccionaste una carpeta'}
                </small>
              </div>
              <p className="dl-settings-note">
                {shareStatus
                  ? `${shareStatus.files} archivos de audio · ${shareStatus.folders} carpetas anunciadas.`
                  : 'Soulseek podrá comprobar que también contribuyes a la red.'}
                {' '}Se anuncian únicamente archivos de audio; comparte solo material que tengas permiso de distribuir.
              </p>
              <div className="dl-settings-fields">
                <button className="dl-btn primary" onClick={onToggleSharing} disabled={shareBusy || !hasSoulseekCredentials}>
                  {shareBusy ? 'Escaneando…' : shareMusicFolder ? 'Dejar de compartir' : 'Compartir mi música'}
                </button>
                {shareMusicFolder && (
                  <button className="dl-btn ghost" onClick={onRescanSharing} disabled={shareBusy}>
                    Reescanear
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
