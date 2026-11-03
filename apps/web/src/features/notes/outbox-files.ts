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
      const request = action(
        database.transaction(STORE, mode).objectStore(STORE),
      );
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
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
