/**
 * Files of messages waiting to send, kept in IndexedDB because they don't fit in
 * localStorage. Each entry is keyed by its message's client id.
 */
const DATABASE = "noted-outbox";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(
        STORE,
        mode,
        mode === "readwrite" ? { durability: "strict" } : undefined,
      );
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    });
  } finally {
    database.close();
  }
}

export const keepFiles = (clientId: string, files: File[]) =>
  run("readwrite", (store) => store.put(files, clientId));

export const readFiles = (clientId: string) =>
  run<File[] | undefined>("readonly", (store) => store.get(clientId));

export const forgetFiles = (clientId: string) =>
  run("readwrite", (store) => store.delete(clientId));

export const readDraftText = (key: string) =>
  run<string | undefined>("readonly", (store) => store.get(key));
export const keepDraftText = (key: string, text: string) =>
  text
    ? run("readwrite", (store) => store.put(text, key))
    : run("readwrite", (store) => store.delete(key));

export const readQueuedNotes = <T>(key: string) =>
  run<T[] | undefined>("readonly", (store) => store.get(key));
export const keepQueuedNotes = <T>(key: string, entries: T[]) =>
  run("readwrite", (store) => store.put(entries, key));
