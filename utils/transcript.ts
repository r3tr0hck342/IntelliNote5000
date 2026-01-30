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
  const existingIndex = segments.findIndex(segment => segment.id === interimSegment.id);
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
  const withoutInterim = interimId
    ? segments.filter(segment => segment.id !== interimId)
    : segments.filter(segment => segment.isFinal);
  return [...withoutInterim, finalSegment];
};
