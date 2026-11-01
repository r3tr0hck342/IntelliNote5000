// IndexedDB storage for sessions and recorded audio. Unlike localStorage it has no ~5 MB cap
// and stores Blobs natively, so long lectures and their audio survive app restarts.
const DB_NAME = 'intellinote';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const AUDIO_STORE = 'audioChunks';
const AUDIO_ASSET_INDEX = 'assetId';

interface AudioChunkRecord {
  assetId: string;
  mimeType: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

const openDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
        if (!db.objectStoreNames.contains(AUDIO_STORE)) {
          db.createObjectStore(AUDIO_STORE, { autoIncrement: true })
            .createIndex(AUDIO_ASSET_INDEX, AUDIO_ASSET_INDEX);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      dbPromise = null; // allow a retry on the next call
      throw error;
    });
    // Ask the browser not to evict our data under storage pressure (no-op where unsupported).
    if (typeof navigator !== 'undefined') void navigator.storage?.persist?.().catch(() => undefined);
  }
  return dbPromise;
};

export const kvGet = async <T>(key: string): Promise<T | undefined> => {
  const db = await openDb();
  return requestToPromise(db.transaction(KV_STORE).objectStore(KV_STORE).get(key)) as Promise<T | undefined>;
};

export const kvSet = async (key: string, value: unknown): Promise<void> => {
  const db = await openDb();
  const tx = db.transaction(KV_STORE, 'readwrite');
  tx.objectStore(KV_STORE).put(value, key);
  return transactionDone(tx);
};

export const appendAudioChunk = async (assetId: string, blob: Blob, mimeType: string): Promise<void> => {
  const db = await openDb();
  const tx = db.transaction(AUDIO_STORE, 'readwrite');
  tx.objectStore(AUDIO_STORE).add({ assetId, blob, mimeType } satisfies AudioChunkRecord);
  return transactionDone(tx);
};

// Chunks come back in insertion order (autoIncrement key), so concatenating them rebuilds the
// recording, including a partial one from a session that ended in a crash.
export const getRecording = async (assetId: string): Promise<Blob | null> => {
  const db = await openDb();
  const index = db.transaction(AUDIO_STORE).objectStore(AUDIO_STORE).index(AUDIO_ASSET_INDEX);
  const chunks = (await requestToPromise(index.getAll(assetId))) as AudioChunkRecord[];
  if (chunks.length === 0) return null;
  return new Blob(chunks.map(chunk => chunk.blob), { type: chunks[0].mimeType });
};

export const hasRecording = async (assetId: string): Promise<boolean> => {
  const db = await openDb();
  const index = db.transaction(AUDIO_STORE).objectStore(AUDIO_STORE).index(AUDIO_ASSET_INDEX);
  return (await requestToPromise(index.count(assetId))) > 0;
};

export const clearLocalDb = async (): Promise<void> => {
  const db = await openDb();
  const tx = db.transaction([KV_STORE, AUDIO_STORE], 'readwrite');
  tx.objectStore(KV_STORE).clear();
  tx.objectStore(AUDIO_STORE).clear();
  return transactionDone(tx);
};
