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
import type { LegacyLecture } from '../types.ts';
import { redactSensitiveData, redactSensitiveText } from '../utils/redaction.ts';
import { buildDiagnosticsBundle } from '../utils/diagnosticsBundle.ts';
import { createDeepgramProvider } from '../services/stt/deepgramProvider.ts';
import { createProvider, isApiConfigReady, PROVIDER_METADATA } from '../services/providers/index.ts';
import { parseFlashcards, parseTags, resolveModel } from '../services/providers/shared.ts';
import { isSttConfigReady } from '../services/stt/index.ts';
import { createWhisperProvider, encodeWav, toSegments, toWhisperLanguage } from '../services/stt/whisperProvider.ts';
import { assertSecureEndpoint, httpFetch } from '../utils/http.ts';
import { GenerationMode } from '../types.ts';

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
  const legacy: LegacyLecture[] = [
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
    requiresApiKey: true,
    defaultModel: 'mock-fast',
    defaultAdvancedModel: 'mock-pro',
    suggestedModels: [],
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

const testDeepgramZeroTimestamps = async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    results: { channels: [{ alternatives: [{
      transcript: 'hello',
      paragraphs: { paragraphs: [{ text: 'hello', start: 0, end: 1.5, words: [{ word: 'hello', start: 0, end: 0.4 }] }] },
    }] }] },
  }))) as typeof fetch;
  try {
    const provider = createDeepgramProvider({ provider: 'deepgram', apiKey: 'test' });
    const result = await provider.transcribeAudio!({ blob: new Blob([]), mimeType: 'audio/webm' });
    assert.equal(result.segments[0].startMs, 0, 'A 0 s paragraph start must stay 0, not undefined');
    assert.equal(result.segments[0].endMs, 1500);
    assert.equal(result.segments[0].words?.[0].startMs, 0, 'A 0 s word start must stay 0, not undefined');
  } finally {
    globalThis.fetch = realFetch;
  }
};

// Captures every fetch made by the code under test and answers with `respond`.
const withMockFetch = async (
  respond: (url: string, init: RequestInit) => unknown,
  body: (calls: { url: string; init: RequestInit }[]) => Promise<void>
) => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    return new Response(JSON.stringify(respond(url, init)), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
};

const headerValue = (init: RequestInit, name: string) => new Headers(init.headers).get(name);
const transcript = [{ id: 's1', assetId: 'a1', startMs: 0, endMs: 1, text: 'Cells divide by mitosis.', isFinal: true, createdAt: '' }];

const testModelParsingAndResolution = () => {
  assert.deepEqual(
    parseFlashcards('Sure! Here they are:\n```json\n[{"front":"Q","back":"A"},{"front":1}]\n```'),
    [{ front: 'Q', back: 'A' }],
    'Fenced JSON with extra text parses; malformed cards are dropped'
  );
  assert.deepEqual(parseTags('["biology", "", 3, "cells"]'), ['biology', 'cells']);
  assert.throws(() => parseTags('no json here'));

  const meta = PROVIDER_METADATA.openai;
  assert.equal(resolveModel({ provider: 'openai', apiKey: 'k' }, meta), meta.defaultModel);
  assert.equal(resolveModel({ provider: 'openai', apiKey: 'k' }, meta, { useIntelligenceMode: true }), meta.defaultAdvancedModel);
  assert.equal(resolveModel({ provider: 'openai', apiKey: 'k', model: ' gpt-4.1 ' }, meta), 'gpt-4.1');
  assert.equal(resolveModel({ provider: 'openai', apiKey: 'k', advancedModel: 'o3' }, meta, { useIntelligenceMode: true }), 'o3');
};

const testReadiness = () => {
  assert.equal(isApiConfigReady({ provider: 'ollama', apiKey: '' }), true, 'Ollama needs no key');
  assert.equal(isApiConfigReady({ provider: 'openai', apiKey: '  ' }), false);
  assert.equal(isApiConfigReady(null), false);
  assert.equal(isSttConfigReady({ provider: 'whisper', apiKey: '' }), true, 'A local Whisper server needs no key');
  assert.equal(isSttConfigReady({ provider: 'deepgram', apiKey: '' }), false);
  Object.values(PROVIDER_METADATA).forEach(meta => {
    assert.ok(meta.defaultModel && meta.defaultAdvancedModel, `${meta.id} has default models`);
  });
};

const testOpenAiCompatibleRouting = async () => {
  await withMockFetch(
    () => ({ choices: [{ message: { content: ' Notes ' } }] }),
    async (calls) => {
      const ollama = createProvider({ provider: 'ollama', apiKey: '' });
      assert.equal(ollama.id, 'ollama');
      assert.equal(await ollama.processTranscript(transcript, GenerationMode.Notes, []), 'Notes');
      assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
      assert.equal(headerValue(calls[0].init, 'authorization'), null, 'No auth header without a key');
      assert.equal(JSON.parse(String(calls[0].init.body)).model, 'llama3.2');

      const router = createProvider({ provider: 'openrouter', apiKey: 'or-key', model: 'x/y:free' });
      await router.processTranscript(transcript, GenerationMode.Notes, []);
      assert.equal(calls[1].url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(headerValue(calls[1].init, 'authorization'), 'Bearer or-key');
      const body = JSON.parse(String(calls[1].init.body));
      assert.equal(body.model, 'x/y:free');
      assert.equal('temperature' in body, false, 'No temperature: newer OpenAI models reject it');
    }
  );
};

const anthropicMessage = (text: string, stopReason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'text', text }], stop_reason: stopReason, stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

const testAnthropicProvider = async () => {
  await withMockFetch(
    () => anthropicMessage('```json\n["cells", "mitosis"]\n```'),
    async (calls) => {
      const claude = createProvider({ provider: 'anthropic', apiKey: 'sk-ant-test' });
      assert.deepEqual(await claude.generateTags(transcript, []), ['cells', 'mitosis']);
      const body = JSON.parse(String(calls[0].init.body));
      assert.equal(body.model, 'claude-opus-5-5');
      assert.equal(body.fallbacks, 'default', 'Refusal fallback on for Opus 5.5');
      assert.equal('temperature' in body, false);
      assert.match(headerValue(calls[0].init, 'anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
      assert.equal(headerValue(calls[0].init, 'authorization'), 'Bearer sk-ant-test', 'SDK 1.x sends the key as a Bearer token');
      assert.ok(calls[0].url.startsWith('https://api.anthropic.com/'), 'Pinned base URL ignores ANTHROPIC_BASE_URL in the environment');

      await claude.processTranscript(transcript, GenerationMode.Notes, [], { useIntelligenceMode: true });
      assert.deepEqual(JSON.parse(String(calls[1].init.body)).output_config, { effort: 'high' });

      const haiku = createProvider({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5' });
      await haiku.processTranscript(transcript, GenerationMode.Notes, []);
      assert.equal('fallbacks' in JSON.parse(String(calls[2].init.body)), false, 'No fallbacks on models that reject them');
    }
  );
  await withMockFetch(
    () => anthropicMessage('', 'refusal'),
    async () => {
      const claude = createProvider({ provider: 'anthropic', apiKey: 'k' });
      await assert.rejects(claude.processTranscript(transcript, GenerationMode.Notes, []), /declined/);
    }
  );
};

const testEndpointSafetyAndWhisperParsing = async () => {
  assert.throws(() => assertSecureEndpoint('http://evil.example.com/v1'), /plain HTTP/);
  assert.doesNotThrow(() => assertSecureEndpoint('http://localhost:11434/v1'));
  assert.doesNotThrow(() => assertSecureEndpoint('http://127.0.0.1:8000/v1'));
  assert.doesNotThrow(() => assertSecureEndpoint('https://api.groq.com/openai/v1'));
  await assert.rejects(httpFetch('http://evil.example.com/v1/chat/completions'), /plain HTTP/);
  // A hostile or buggy server returning non-string fields must not crash the recorder.
  assert.deepEqual(toSegments({ text: 42, segments: [{ text: null, start: 'x' }, { text: ' ok ', start: 1 }] } as never, 1000),
    [{ text: 'ok', startMs: 2000, endMs: undefined, isFinal: true }]);
};

const testWhisperProvider = async () => {
  assert.equal(toWhisperLanguage('en-US'), 'en');
  assert.equal(toWhisperLanguage(undefined), undefined);
  const wav = encodeWav(new Int16Array(16000), 16000);
  assert.equal(wav.size, 44 + 32000, 'WAV = 44-byte header + 2 bytes per sample');
  assert.equal(new TextDecoder().decode(new Uint8Array(await wav.slice(0, 4).arrayBuffer())), 'RIFF');

  await withMockFetch(
    () => ({ text: 'Hello class. Today: cells.', segments: [{ text: ' Hello class.', start: 0, end: 1.2 }, { text: 'Today: cells.', start: 1.2, end: 3 }] }),
    async (calls) => {
      const whisper = createWhisperProvider({ provider: 'whisper', apiKey: 'gsk_test', language: 'en-US' });
      const result = await whisper.transcribeAudio!({ blob: new Blob([new Uint8Array(4)]), mimeType: 'audio/webm' });
      assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
      assert.equal(headerValue(calls[0].init, 'authorization'), 'Bearer gsk_test');
      const form = calls[0].init.body as FormData;
      assert.equal(form.get('model'), 'whisper-large-v3-turbo');
      assert.equal(form.get('language'), 'en');
      assert.equal(form.get('response_format'), 'verbose_json');
      assert.deepEqual(result.segments.map(s => [s.text, s.startMs, s.endMs]), [['Hello class.', 0, 1200], ['Today: cells.', 1200, 3000]]);

      const local = createWhisperProvider({ provider: 'whisper', apiKey: '', baseUrl: 'http://localhost:8000/v1/' });
      await local.transcribeAudio!({ blob: new Blob([new Uint8Array(4)]), mimeType: 'audio/webm' });
      assert.equal(calls[1].url, 'http://localhost:8000/v1/audio/transcriptions');
      assert.equal(headerValue(calls[1].init, 'authorization'), null);
    }
  );
};

const run = async () => {
  testTranscriptReconciliation();
  testSessionMigration();
  testProviderErrorMapping();
  testSttProbeStatsAggregation();
  testRedaction();
  testDiagnosticsBundleShape();
  await testDryRunPipeline();
  await testDeepgramZeroTimestamps();
  testModelParsingAndResolution();
  testReadiness();
  await testOpenAiCompatibleRouting();
  await testAnthropicProvider();
  await testWhisperProvider();
  await testEndpointSafetyAndWhisperParsing();
  console.log('unit.test.ts: all tests passed');
};

run().catch(error => {
  console.error('unit.test.ts: test failure', error);
  process.exitCode = 1;
});
