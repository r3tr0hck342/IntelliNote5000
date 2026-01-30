import type { TranscriptSegment } from '../types';

export const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
};

export const buildTranscriptText = (segments: TranscriptSegment[], includeInterim = false) =>
  segments
    .filter(segment => includeInterim || segment.isFinal)
    .map(segment => segment.text)
    .join(' ')
    .trim();

export const normalizeImportedTranscript = (text: string, assetId: string, createdAt: string): TranscriptSegment[] => {
  const lines = text
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  return lines.map(line => ({
    id: createId('segment'),
    assetId,
    startMs: 0,
    endMs: 0,
    text: line,
    isFinal: true,
    createdAt,
  }));
};

export const upsertInterimSegment = (
  segments: TranscriptSegment[],
  interimSegment: TranscriptSegment
): TranscriptSegment[] => {
  const existingIndex = segments.findIndex(segment =>
    (segment.utteranceId && interimSegment.utteranceId && segment.utteranceId === interimSegment.utteranceId) ||
    segment.id === interimSegment.id
  );
  if (existingIndex >= 0) {
    const updated = [...segments];
    updated[existingIndex] = interimSegment;
    return updated;
  }
  return [...segments.filter(segment => segment.isFinal), interimSegment];
};

export const finalizeSegment = (
  segments: TranscriptSegment[],
  finalSegment: TranscriptSegment,
  interimId?: string
): TranscriptSegment[] => {
  const withoutInterim = segments.filter(segment => {
    if (finalSegment.utteranceId && segment.utteranceId === finalSegment.utteranceId) {
      return false;
    }
    if (interimId && segment.id === interimId) {
      return false;
    }
    return segment.isFinal;
  });
  return [...withoutInterim, finalSegment];
};

export const mergeFinalSegments = (
  existing: TranscriptSegment[],
  incoming: TranscriptSegment[]
): TranscriptSegment[] => {
  const finals = existing.filter(segment => segment.isFinal);
  const merged = [...finals];
  for (const segment of incoming) {
    const matchIndex = merged.findIndex(item =>
      (segment.utteranceId && item.utteranceId === segment.utteranceId) ||
      (item.text === segment.text && item.startMs === segment.startMs && item.endMs === segment.endMs)
    );
    if (matchIndex >= 0) {
      merged[matchIndex] = segment;
    } else {
      merged.push(segment);
    }
  }
  return merged.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
};
