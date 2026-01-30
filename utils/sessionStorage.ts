import type { LegacyLecture, LectureAsset, StudySession, TranscriptSegment, PersistedSessions } from '../types';
import { createId, buildTranscriptText } from './transcript.ts';

const STORAGE_KEY = 'intellinote-sessions';
const LEGACY_KEY = 'intellinote-lectures';

const CURRENT_SCHEMA_VERSION = 1;

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

export const loadPersistedSessions = (): PersistedSessions => {
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

export const persistSessions = (sessions: StudySession[]) => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  const payload: PersistedSessions = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sessions,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

export const clearPersistedSessions = () => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
};

export const getSessionSchemaVersion = () => CURRENT_SCHEMA_VERSION;
