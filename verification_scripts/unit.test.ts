import assert from 'node:assert/strict';
import { upsertInterimSegment, finalizeSegment, mergeFinalSegments } from '../utils/transcript.ts';
import { migrateLegacyLectures, migratePersistedSessions, getSessionSchemaVersion } from '../utils/sessionStorage.ts';
import { mapProviderError } from '../services/providers/errors.ts';
import {
  createSttProbeStats,
  recordSttProbeInterim,
  recordSttProbeFinal,
  recordSttProbeAudioSent,
  recordSttProbeAudioDropped,
  recordSttProbeQueueDepth,
  recordSttProbeReconnect,
  recordSttProbeClose,
  finalizeSttProbeStats,
} from '../utils/sttProbe.ts';
import { runDryRunPipeline } from '../services/aiService.ts';
import type { AiProvider, ProviderMetadata } from '../services/providers/types.ts';
import { redactSensitiveData, redactSensitiveText } from '../utils/redaction.ts';
import { buildDiagnosticsBundle } from '../utils/diagnosticsBundle.ts';

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

  const interimUtterance = {
    ...interimSegment,
    id: 'segment-interim-utterance',
    utteranceId: 'utterance-1',
    text: 'interim update',
  };
  const withUtterance = upsertInterimSegment(finalized, interimUtterance);
  assert.equal(withUtterance.length, 3, 'Should append utterance interim segment');
  const updatedUtterance = {
    ...interimUtterance,
    text: 'interim update v2',
  };
  const withUtteranceUpdate = upsertInterimSegment(withUtterance, updatedUtterance);
  assert.equal(withUtteranceUpdate.length, 3, 'Should update interim segment by utterance id');
  const finalUtterance = {
    ...interimUtterance,
    id: 'segment-final-utterance',
    text: 'utterance final',
    isFinal: true,
  };
  const finalizedUtterance = finalizeSegment(withUtteranceUpdate, finalUtterance);
  assert.equal(finalizedUtterance.length, 3, 'Should finalize utterance without duplicates');
  const merged = mergeFinalSegments(finalizedUtterance, [
    { ...finalUtterance, id: 'segment-final-utterance-dup' },
    {
      id: 'segment-final-3',
      assetId: 'asset-1',
      startMs: 2000,
      endMs: 2500,
      text: 'merged',
      isFinal: true,
      createdAt: new Date().toISOString(),
    },
  ]);
  assert.equal(merged.length, 4, 'Should merge new final segments without duplicates');
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

const testSttProbeStatsAggregation = () => {
  const startMs = 1000;
  let stats = createSttProbeStats(startMs);
  stats = recordSttProbeInterim(stats, 1200);
  stats = recordSttProbeInterim(stats, 1500);
  stats = recordSttProbeFinal(stats, 1800);
  stats = recordSttProbeAudioSent(stats, 5);
  stats = recordSttProbeAudioDropped(stats, 2);
  stats = recordSttProbeQueueDepth(stats, 3);
  stats = recordSttProbeQueueDepth(stats, 1);
  stats = recordSttProbeReconnect(stats);
  stats = recordSttProbeClose(stats, 'code 1000');
  const summary = finalizeSttProbeStats(stats, 2000);

  assert.equal(summary.time_to_first_interim_ms, 200);
  assert.equal(summary.interim_events_count, 2);
  assert.equal(summary.final_events_count, 1);
  assert.equal(summary.audio_frames_sent, 5);
  assert.equal(summary.audio_frames_dropped, 2);
  assert.equal(summary.reconnect_count, 1);
  assert.equal(summary.ws_open_to_close_reason, 'code 1000');
  assert.equal(summary.avg_frame_queue_depth, 2);
};

const testDryRunPipeline = async () => {
  let networkCalls = 0;
  const metadata: ProviderMetadata = {
    id: 'openai',
    label: 'Mock Provider',
    description: 'Mock',
    docsUrl: 'https://example.com',
    keyLabel: 'Mock Key',
    supportsLiveTranscription: false,
  };
  const mockProvider: AiProvider = {
    id: 'openai',
    metadata,
    rawConfig: { provider: 'openai', apiKey: 'mock' },
    processTranscript: async (_t, mode, _h, options) => {
      if (!options?.dryRun) networkCalls += 1;
      return `dry:${mode}`;
    },
    generateFlashcards: async (_t, _h, options) => {
      if (!options?.dryRun) networkCalls += 1;
      return [{ front: 'q', back: 'a' }];
    },
    generateTags: async (_t, _h, options) => {
      if (!options?.dryRun) networkCalls += 1;
      return ['dry'];
    },
    generateChatStream: async function* (_history, _message, _t, _h, options) {
      if (!options?.dryRun) networkCalls += 1;
      yield { textDelta: 'dry-chat' };
    },
    editTranscript: async (_text, _mode, options) => {
      if (!options?.dryRun) networkCalls += 1;
      return 'dry-edit';
    },
  };

  const result = await runDryRunPipeline(
    {
      sessionId: 'session-1',
      assetId: 'asset-1',
      transcript: [
        {
          id: 'segment-1',
          assetId: 'asset-1',
          startMs: 0,
          endMs: 1000,
          text: 'Hello world',
          isFinal: true,
          createdAt: new Date().toISOString(),
        },
      ],
      handouts: [],
    },
    { providerOverride: mockProvider }
  );

  assert.equal(result.providerId, 'openai');
  assert.equal(result.validation.missingFields.length, 0);
  assert.ok(result.generators.find(item => item.id === 'notes'));
  assert.ok(result.generators.find(item => item.id === 'flashcards'));
  assert.equal(networkCalls, 0);
};

const testRedaction = () => {
  const redactedText = redactSensitiveText('Authorization: Bearer super-secret-token');
  assert.equal(redactedText, 'Authorization: [REDACTED]');

  const redactedData = redactSensitiveData({
    apiKey: 'secret-key',
    nested: { token: 'token-value', note: 'Bearer abc123' },
    headers: { Authorization: 'Bearer other-secret' },
    api_key: 'sk-1234567890abcdef',
  }) as Record<string, unknown>;
  assert.equal(redactedData.apiKey, '[REDACTED]');
  assert.deepEqual(redactedData.nested, { token: '[REDACTED]', note: '[REDACTED]' });
  assert.deepEqual(redactedData.headers, { Authorization: '[REDACTED]' });
  assert.equal(redactedData.api_key, '[REDACTED]');
};

const testDiagnosticsBundleShape = () => {
  const buildLabel = 'IntelliNote5000 0.0.0 (test)';
  const bundle = buildDiagnosticsBundle({
    appInfo: {
      name: 'IntelliNote',
      version: '0.0.0',
      buildMode: 'test',
      buildTime: '2024-01-01T00:00:00.000Z',
      buildLabel,
      buildCommit: 'abc123',
    },
    platform: { target: 'web' },
    providerConfigPresence: { aiConfigured: true, sttConfigured: false },
    logs: [
      {
        id: 'log-1',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'api_key=super-secret-token',
        data: { apiKey: 'super-secret-token' },
      },
    ],
    sttProbeSummary: null,
  });

  assert.equal(bundle.app.version, '0.0.0');
  assert.equal(bundle.app.buildLabel, buildLabel);
  assert.equal(bundle.app.buildCommit, 'abc123');
  assert.equal(bundle.app.buildTime, '2024-01-01T00:00:00.000Z');
  assert.equal(bundle.platform.target, 'web');
  assert.equal(bundle.providerConfigPresence.aiConfigured, true);
  assert.equal(bundle.logs[0].message, '[REDACTED]');
  assert.equal(bundle.logs[0].data?.apiKey, '[REDACTED]');
  assert.ok(!JSON.stringify(bundle).includes('super-secret-token'));
};

const run = async () => {
  testTranscriptReconciliation();
  testSessionMigration();
  testProviderErrorMapping();
  testSttProbeStatsAggregation();
  testRedaction();
  testDiagnosticsBundleShape();
  await testDryRunPipeline();
  console.log('unit.test.ts: all tests passed');
};

run().catch(error => {
  console.error('unit.test.ts: test failure', error);
  process.exitCode = 1;
});
