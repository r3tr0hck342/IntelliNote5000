import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { loadPersistedSessions, persistSessions, clearPersistedSessions } from '../utils/sessionStorage.ts';
import { appendAudioChunk, deleteRecording, getRecording, hasRecording } from '../utils/localDb.ts';

// Minimal localStorage + window for the legacy path.
const store = new Map<string, string>();
const testGlobals = globalThis as unknown as { window: unknown; localStorage: unknown };
testGlobals.window = globalThis;
testGlobals.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const audioBytes = new Uint8Array([1, 2, 3, 4, 5]);
const dataUrl = `data:audio/webm;base64,${Buffer.from(audioBytes).toString('base64')}`;
const now = '2026-01-01T00:00:00.000Z';
const session = {
  id: 'session-1', title: 'Bio 101', topic: 'Cells', createdAt: now, updatedAt: now,
  assets: [{ id: 'asset-1', sessionId: 'session-1', sourceType: 'live', audioPath: dataUrl,
    transcriptText: 'hello', language: 'en-US', createdAt: now,
    segments: [{ id: 's1', assetId: 'asset-1', startMs: 0, endMs: 1, text: 'hello', isFinal: true, createdAt: now }] }],
  handouts: [], tags: [], chatHistory: [],
};

// 1. Pre-IndexedDB data migrates: sessions kept, inline audio moved to the audio store, old copy removed.
store.set('intellinote-sessions', JSON.stringify({ schemaVersion: 1, sessions: [session] }));
const first = await loadPersistedSessions();
assert.equal(first.sessions.length, 1);
assert.equal(first.sessions[0].assets[0].audioPath, undefined);
const migratedAudio = await getRecording('asset-1');
assert.deepEqual(new Uint8Array(await migratedAudio!.arrayBuffer()), audioBytes);
assert.equal(store.has('intellinote-sessions'), false);

// 2. Next launch reads from IndexedDB, not localStorage.
const second = await loadPersistedSessions();
assert.equal(second.sessions[0].title, 'Bio 101');

// 3. Saves well past the old ~5 MB localStorage cap round-trip.
const big = { ...second.sessions[0], organizedNotes: 'x'.repeat(12 * 1024 * 1024) };
await persistSessions([big]);
assert.equal((await loadPersistedSessions()).sessions[0].organizedNotes?.length, 12 * 1024 * 1024);

// 4. Chunks rebuild in recording order (what survives a crash mid-recording).
for (const n of [10, 20, 30]) await appendAudioChunk('asset-2', new Blob([new Uint8Array([n])]), 'audio/webm');
const rebuilt = await getRecording('asset-2');
assert.deepEqual([...new Uint8Array(await rebuilt!.arrayBuffer())], [10, 20, 30]);
assert.equal(rebuilt!.type, 'audio/webm');
assert.equal(await hasRecording('asset-2'), true);
assert.equal(await hasRecording('missing'), false);

// 4b. Deleting one asset's recording removes only that asset's chunks.
await appendAudioChunk('asset-3', new Blob([new Uint8Array([99])]), 'audio/webm');
await deleteRecording('asset-2');
assert.equal(await hasRecording('asset-2'), false);
assert.equal(await hasRecording('asset-3'), true);
await deleteRecording('missing'); // no-op, must not throw

// 5. Reset wipes sessions and audio.
await clearPersistedSessions();
assert.equal((await loadPersistedSessions()).sessions.length, 0);
assert.equal(await getRecording('asset-2'), null);
console.log('storage.test.ts: all tests passed');
