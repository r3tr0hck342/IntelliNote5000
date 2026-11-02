import type { LegacyLecture, LectureAsset, StudySession, TranscriptSegment, PersistedSessions } from '../types';
import { createId, buildTranscriptText } from './transcript.ts';
import { appendAudioChunk, clearLocalDb, hasRecording, kvGet, kvSet } from './localDb.ts';

const STORAGE_KEY = 'intellinote-sessions';
const LEGACY_KEY = 'intellinote-lectures';
const IDB_SESSIONS_KEY = 'sessions';

// v2 adds optional word timings/engine fields to segments; v1 data needs no rewrite.
const CURRENT_SCHEMA_VERSION = 2;

const isString = (value: unknown): value is string => typeof value === 'string';
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isTranscriptSegment = (value: unknown): value is TranscriptSegment => {
  if (!value || typeof value !== 'object') return false;
  const segment = value as TranscriptSegment;
  return (
    isString(segment.id) &&
    isString(segment.assetId) &&
    typeof segment.startMs === 'number' &&
    typeof segment.endMs === 'number' &&
    isString(segment.text) &&
    typeof segment.isFinal === 'boolean' &&
    isString(segment.createdAt)
  );
};

const isLectureAsset = (value: unknown): value is LectureAsset => {
  if (!value || typeof value !== 'object') return false;
  const asset = value as LectureAsset;
  return (
    isString(asset.id) &&
    isString(asset.sessionId) &&
    (asset.sourceType === 'live' || asset.sourceType === 'import') &&
    isString(asset.transcriptText) &&
    isString(asset.language) &&
    isString(asset.createdAt) &&
    isArray(asset.segments) &&
    asset.segments.every(isTranscriptSegment)
  );
};

const isStudySession = (value: unknown): value is StudySession => {
  if (!value || typeof value !== 'object') return false;
  const session = value as StudySession;
  return (
    isString(session.id) &&
    isString(session.title) &&
    isString(session.topic) &&
    isString(session.createdAt) &&
    isString(session.updatedAt) &&
    isArray(session.assets) &&
    session.assets.every(isLectureAsset) &&
    isArray(session.handouts) &&
    isArray(session.tags) &&
    isArray(session.chatHistory)
  );
};

export const migrateLegacyLectures = (
  legacyLectures: LegacyLecture[],
  existingSessions: StudySession[] = []
): StudySession[] => {
  const existingIds = new Set(existingSessions.map(session => session.id));
  const migratedSessions = legacyLectures
    .filter(lecture => !existingIds.has(lecture.id))
    .map(lecture => {
      const sessionId = lecture.id || createId('session');
      const assetId = `asset-${sessionId}`;
      const createdAt = new Date().toISOString();
      const segments: TranscriptSegment[] = lecture.transcript.map((segment, index) => ({
        id: `segment-${sessionId}-${index}`,
        assetId,
        startMs: Math.round(segment.startTime * 1000),
        endMs: Math.round(segment.startTime * 1000),
        text: segment.text,
        isFinal: true,
        createdAt,
      }));
      const asset: LectureAsset = {
        id: assetId,
        sessionId,
        sourceType: 'import',
        transcriptText: buildTranscriptText(segments),
        transcriptPath: undefined,
        audioPath: undefined,
        language: 'en-US',
        createdAt,
        segments,
      };
      return {
        id: sessionId,
        title: lecture.title,
        topic: '',
        createdAt,
        updatedAt: createdAt,
        assets: [asset],
        handouts: lecture.handouts,
        organizedNotes: lecture.organizedNotes,
        organizedNotesStatus: lecture.organizedNotesStatus,
        studyGuide: lecture.studyGuide,
        testQuestions: lecture.testQuestions,
        flashcards: lecture.flashcards,
        tags: lecture.tags,
        suggestedTags: lecture.suggestedTags,
        tagsStatus: lecture.tagsStatus,
        chatHistory: lecture.chatHistory,
      } satisfies StudySession;
    });

  return [...existingSessions, ...migratedSessions];
};

const normalizePersistedSessions = (payload: PersistedSessions): PersistedSessions => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  sessions: payload.sessions.filter(isStudySession),
});

export const migratePersistedSessions = (payload: PersistedSessions): PersistedSessions => {
  if (payload.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return normalizePersistedSessions(payload);
  }
  return normalizePersistedSessions({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sessions: payload.sessions,
  });
};

const loadLocalStorageSessions = (): PersistedSessions => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, sessions: [] };
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as PersistedSessions;
      if (parsed && typeof parsed.schemaVersion === 'number' && isArray(parsed.sessions)) {
        return migratePersistedSessions(parsed);
      }
    } catch {
      // fall through to legacy migration
    }
  }

  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const legacyLectures = JSON.parse(legacy) as LegacyLecture[];
      if (Array.isArray(legacyLectures)) {
        const migrated = migrateLegacyLectures(legacyLectures);
        const payload = { schemaVersion: CURRENT_SCHEMA_VERSION, sessions: migrated };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        localStorage.removeItem(LEGACY_KEY);
        return payload;
      }
    } catch {
      // ignore legacy migration errors
    }
  }

  return { schemaVersion: CURRENT_SCHEMA_VERSION, sessions: [] };
};

// Builds before IndexedDB kept recordings as base64 data URLs on the asset; move them to the audio store.
const moveInlineAudioToStore = (sessions: StudySession[]): Promise<StudySession[]> =>
  Promise.all(sessions.map(async session => ({
    ...session,
    assets: await Promise.all(session.assets.map(async asset => {
      if (!asset.audioPath?.startsWith('data:')) return asset;
      // hasRecording guard keeps a retried migration from duplicating the audio.
      if (!(await hasRecording(asset.id))) {
        const blob = await (await fetch(asset.audioPath)).blob();
        await appendAudioChunk(asset.id, blob, blob.type || 'audio/webm');
      }
      return { ...asset, audioPath: undefined };
    })),
  })));

export const loadPersistedSessions = async (): Promise<PersistedSessions> => {
  const stored = await kvGet<PersistedSessions>(IDB_SESSIONS_KEY);
  if (stored && typeof stored.schemaVersion === 'number' && isArray(stored.sessions)) {
    return migratePersistedSessions(stored);
  }

  const legacy = loadLocalStorageSessions();
  if (legacy.sessions.length === 0) return legacy;
  const migrated: PersistedSessions = { ...legacy, sessions: await moveInlineAudioToStore(legacy.sessions) };
  await kvSet(IDB_SESSIONS_KEY, migrated);
  // Drop the localStorage copy only after IndexedDB holds the data.
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  return migrated;
};

// Rejects on failure (quota, blocked storage) so callers can tell the user.
export const persistSessions = (sessions: StudySession[]): Promise<void> =>
  kvSet(IDB_SESSIONS_KEY, { schemaVersion: CURRENT_SCHEMA_VERSION, sessions } satisfies PersistedSessions);

export const clearPersistedSessions = async () => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  }
  await clearLocalDb();
};

export const getSessionSchemaVersion = () => CURRENT_SCHEMA_VERSION;
