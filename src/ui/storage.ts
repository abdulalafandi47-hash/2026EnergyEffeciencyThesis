/**
 * Keeping work in the browser between visits: the last wall, the last building
 * project, and a library of named building projects.
 *
 * Browser storage belongs to this browser on this computer only. It can be
 * unavailable (private windows, blocked site data) or full, so every access is
 * guarded: the program keeps working without it and says so. Saved files
 * (Download / Open) remain the way to keep a project safely or share it.
 */

/** The small part of the browser's Storage this program uses (tests pass an in-memory one). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'building-thermal-simulator.';
export const STORAGE_KEYS = {
  lastWall: `${PREFIX}last-wall`,
  lastBuilding: `${PREFIX}last-building`,
  /** Which library entry the last building belongs to (if any). */
  lastBuildingLibraryId: `${PREFIX}last-building-library-id`,
  libraryIndex: `${PREFIX}library`,
  libraryProject: (id: string): string => `${PREFIX}library.${id}`,
  welcomeSeen: `${PREFIX}welcome-seen`,
} as const;

/** The browser's local storage, or null where it cannot be used. */
export function browserStore(): KeyValueStore | null {
  try {
    const store = window.localStorage;
    const probe = `${PREFIX}probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/** Reads a key; null when missing or when storage fails. */
export function readKey(store: KeyValueStore | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** Writes a key; false when storage is unavailable or full. */
export function writeKey(store: KeyValueStore | null, key: string, value: string): boolean {
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(store: KeyValueStore | null, key: string): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* nothing to do: the key stays */
  }
}

export interface LibraryEntry {
  id: string;
  name: string;
  /** ISO time of the last save. */
  savedAt: string;
}

/** A list of named building projects kept in this browser. Each project is stored as its file text. */
export class ProjectLibrary {
  constructor(private readonly store: KeyValueStore | null) {}

  get available(): boolean {
    return this.store !== null;
  }

  list(): LibraryEntry[] {
    const text = readKey(this.store, STORAGE_KEYS.libraryIndex);
    if (!text) return [];
    try {
      const raw: unknown = JSON.parse(text);
      if (!Array.isArray(raw)) return [];
      return raw.filter((e): e is LibraryEntry => typeof e === 'object' && e !== null && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.savedAt === 'string');
    } catch {
      return [];
    }
  }

  load(id: string): string | null {
    return readKey(this.store, STORAGE_KEYS.libraryProject(id));
  }

  /**
   * Saves `text` under `id` (a new entry when `id` is null). Returns the entry, or null when the
   * browser refused (storage unavailable or full); nothing is half-written in that case.
   */
  save(id: string | null, name: string, text: string, now: Date): LibraryEntry | null {
    const entries = this.list();
    const entryId = id && entries.some((e) => e.id === id) ? id : this.newId(entries, now);
    if (!writeKey(this.store, STORAGE_KEYS.libraryProject(entryId), text)) return null;
    const entry: LibraryEntry = { id: entryId, name: name.trim() || 'Untitled project', savedAt: now.toISOString() };
    const next = [entry, ...entries.filter((e) => e.id !== entryId)];
    if (!writeKey(this.store, STORAGE_KEYS.libraryIndex, JSON.stringify(next))) {
      if (!entries.some((e) => e.id === entryId)) removeKey(this.store, STORAGE_KEYS.libraryProject(entryId));
      return null;
    }
    return entry;
  }

  remove(id: string): void {
    removeKey(this.store, STORAGE_KEYS.libraryProject(id));
    writeKey(this.store, STORAGE_KEYS.libraryIndex, JSON.stringify(this.list().filter((e) => e.id !== id)));
  }

  private newId(entries: LibraryEntry[], now: Date): string {
    const base = `p${now.getTime().toString(36)}`;
    let id = base;
    for (let n = 2; entries.some((e) => e.id === id); n++) id = `${base}-${n}`;
    return id;
  }
}

/** An in-memory store (tests, and a stand-in that behaves like a real one). */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
