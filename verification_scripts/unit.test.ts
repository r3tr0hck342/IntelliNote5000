import assert from 'node:assert/strict';
import { upsertInterimSegment, finalizeSegment } from '../utils/transcript.ts';
import { migrateLegacyLectures, migratePersistedSessions, getSessionSchemaVersion } from '../utils/sessionStorage.ts';
import { mapProviderError } from '../services/providers/errors.ts';

const testTranscriptReconciliation = () => {
  const baseSegment = {
    id: 'segment-final-1',
    assetId: 'asset-1',
    startMs: 0,
    endMs: 1000,
    text: 'hello',
    isFinal: true,
    createdAt: new Date().toISOString(),
  };
  const interimSegment = {
    id: 'segment-interim-1',
    assetId: 'asset-1',
    startMs: 1000,
    endMs: 1500,
    text: 'interim',
    isFinal: false,
    createdAt: new Date().toISOString(),
  };

  const withInterim = upsertInterimSegment([baseSegment], interimSegment);
  assert.equal(withInterim.length, 2, 'Should append interim segment');

  const finalSegment = {
    ...interimSegment,
    id: 'segment-final-2',
    text: 'final',
    isFinal: true,
  };
  const finalized = finalizeSegment(withInterim, finalSegment, interimSegment.id);
  assert.equal(finalized.length, 2, 'Should replace interim with final');
  assert.ok(finalized.every(segment => segment.isFinal), 'All segments should be final');
};

const testSessionMigration = () => {
  const legacy = [
    {
      id: 'legacy-1',
      title: 'Legacy Lecture',
      date: '2024-01-01',
      transcript: [{ text: 'Hello', startTime: 0 }],
      handouts: [],
      organizedNotes: null,
      studyGuide: null,
      testQuestions: null,
      flashcards: null,
      tags: [],
      suggestedTags: [],
      tagsStatus: 'idle',
      chatHistory: [],
    },
  ];
  const migrated = migrateLegacyLectures(legacy, []);
  assert.equal(migrated.length, 1, 'Legacy lectures should migrate');

  const migratedAgain = migrateLegacyLectures(legacy, migrated);
  assert.equal(migratedAgain.length, 1, 'Migration should be idempotent');

  const persisted = migratePersistedSessions({ schemaVersion: 0, sessions: migrated });
  assert.equal(persisted.schemaVersion, getSessionSchemaVersion(), 'Schema version should update');
};

const testProviderErrorMapping = () => {
  const authError = mapProviderError({ status: 401, message: 'Unauthorized' }, 'openai');
  assert.equal(authError.code, 'auth_failed');
  assert.equal(authError.retryable, false);

  const networkError = mapProviderError(new TypeError('Network failed'), 'gemini');
  assert.equal(networkError.code, 'network_error');
  assert.equal(networkError.retryable, true);
};

const run = () => {
  testTranscriptReconciliation();
  testSessionMigration();
  testProviderErrorMapping();
  console.log('unit.test.ts: all tests passed');
};

run();
