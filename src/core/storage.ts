/**
 * Persistence layer.
 * - Settings live in localStorage (small, synchronous).
 * - Projects live in IndexedDB so we can store real artwork blobs, not just notes.
 */

export type ToolId = 'photo' | 'draw' | 'design' | 'motion' | 'video' | 'pdf';

export interface ProjectRecord {
  id: string;
  tool: ToolId;
  title: string;
  updated: number;
  created: number;
  /** PNG/JPEG thumbnail for the project list. */
  thumb?: Blob;
  /** Tool-specific serialised document (JSON-safe) plus optional binary assets. */
  data?: unknown;
  assets?: Record<string, Blob>;
  note?: string;
}

const DB_NAME = 'mosaic-studio';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updated', 'updated');
        store.createIndex('tool', 'tool');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const projects = {
  async all(): Promise<ProjectRecord[]> {
    try {
      const list = await tx<ProjectRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ProjectRecord[]>);
      return list.sort((a, b) => b.updated - a.updated);
    } catch {
      return [];
    }
  },
  async get(id: string): Promise<ProjectRecord | undefined> {
    try {
      return await tx<ProjectRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<ProjectRecord | undefined>);
    } catch {
      return undefined;
    }
  },
  async put(rec: ProjectRecord): Promise<void> {
    await tx('readwrite', (s) => s.put(rec) as IDBRequest<IDBValidKey>);
  },
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  },
  async clear(): Promise<void> {
    await tx('readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>);
  },
};

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- Settings ---------------- */

export interface AiProviderConfig {
  /** Short id, e.g. 'openai' or a custom slug. */
  id: string;
  label: string;
  /** Base URL of an OpenAI-compatible images endpoint, or a custom one. */
  baseUrl: string;
  /** Path appended to baseUrl for image generation. */
  imagePath: string;
  model: string;
  /** API key — stored only in this browser. */
  key: string;
  /** Request shape. 'openai' = { prompt, model, size, n }. */
  flavor: 'openai' | 'custom';
  enabled: boolean;
}

export interface Settings {
  theme: 'dark' | 'light';
  reduceMotion: boolean;
  exportFormat: 'png' | 'jpeg' | 'webp';
  exportQuality: number;
  ai: AiProviderConfig[];
  activeAi: string | null;
  seenWelcome: boolean;
}

const SETTINGS_KEY = 'mosaic-studio-settings-v2';

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  reduceMotion: false,
  exportFormat: 'png',
  exportQuality: 0.92,
  ai: [],
  activeAi: null,
  seenWelcome: false,
};

let cached: Settings | null = null;

export function settings(): Settings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    cached = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...settings(), ...patch };
  cached = next;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked — settings stay in memory */
  }
  return next;
}

export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
