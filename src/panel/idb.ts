/**
 * Tiny IndexedDB key-value store for the panel. IndexedDB (not
 * chrome.storage) because folder handles are only storable there.
 */

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("i18n-review", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = op(d.transaction("kv", mode).objectStore("kv"));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () =>
          reject(req.error ?? new Error("indexedDB request failed"));
      }),
  );
}

export const idbGet = <T>(key: string) =>
  run<T | undefined>("readonly", (s) => s.get(key));
export const idbSet = (key: string, value: unknown) =>
  run<void>("readwrite", (s) => s.put(value, key));
