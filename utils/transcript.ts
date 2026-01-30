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

const normalizeLine = (line: string) => line.replace(/\s+/g, ' ').trim();

export const normalizeTranscriptText = (text: string): string => {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00a0/g, ' ');
  const normalizedLines = cleaned
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '));
  return normalizedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const estimateTranscriptStats = (text: string) => {
  const normalized = normalizeTranscriptText(text);
  const charCount = normalized.length;
  const words = normalized ? normalized.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const estimatedMinutes = wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / 130));
  return { charCount, wordCount, estimatedMinutes };
};

export const parseTimestampToMs = (value: string): number | null => {
  const cleaned = value.trim().replace(/,/g, '.');
  const match = cleaned.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const [, hoursPart, minutesPart, secondsPart, msPart] = match;
  const hours = hoursPart ? Number(hoursPart) : 0;
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  const milliseconds = msPart ? Number(msPart.padEnd(3, '0')) : 0;
  if ([hours, minutes, seconds, milliseconds].some(value => Number.isNaN(value))) {
    return null;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
};

const buildSegment = (text: string, assetId: string, createdAt: string, startMs = 0, endMs = 0): TranscriptSegment => ({
  id: createId('segment'),
  assetId,
  startMs,
  endMs,
  text: normalizeLine(text),
  isFinal: true,
  createdAt,
});

const parseSrtVttSegments = (text: string, assetId: string, createdAt: string): TranscriptSegment[] => {
  const lines = text.split('\n');
  const segments: TranscriptSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }
    if (/^\d+$/.test(line)) {
      i += 1;
      continue;
    }
    const timeMatch = line.match(/^(\d{1,2}:\d{2}:\d{2}[\.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[\.,]\d{1,3})/);
    if (!timeMatch) {
      i += 1;
      continue;
    }
    const startMs = parseTimestampToMs(timeMatch[1]);
    const endMs = parseTimestampToMs(timeMatch[2]);
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i += 1;
    }
    const segmentText = normalizeLine(textLines.join(' '));
    if (segmentText) {
      segments.push(buildSegment(segmentText, assetId, createdAt, startMs ?? 0, endMs ?? 0));
    }
    i += 1;
  }
  return segments;
};

const parseInlineTimestampSegments = (text: string, assetId: string, createdAt: string): TranscriptSegment[] => {
  const lines = text.split('\n');
  const segments: TranscriptSegment[] = [];
  let current: { startMs: number; text: string[] } | null = null;
  let hasTimestamp = false;
  const timestampRegex = /^\s*\[?(\d{1,2}:\d{2}:\d{2}(?:[\.,]\d{1,3})?|\d{1,2}:\d{2}(?:[\.,]\d{1,3})?)\]?\s*(.*)$/;

  const flushCurrent = () => {
    if (current && current.text.length > 0) {
      segments.push(buildSegment(current.text.join(' '), assetId, createdAt, current.startMs, current.startMs));
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) {
        current.text.push('');
      }
      continue;
    }
    const match = trimmed.match(timestampRegex);
    if (match) {
      const startMs = parseTimestampToMs(match[1]);
      if (startMs !== null) {
        if (current) {
          flushCurrent();
        }
        hasTimestamp = true;
        current = { startMs, text: [] };
        if (match[2]) {
          current.text.push(match[2]);
        }
        continue;
      }
    }
    if (current) {
      current.text.push(trimmed);
    } else {
      segments.push(buildSegment(trimmed, assetId, createdAt));
    }
  }
  flushCurrent();

  if (!hasTimestamp) {
    return [];
  }

  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index].startMs >= 0) {
      const next = segments.slice(index + 1).find(segment => segment.startMs >= 0);
      segments[index].endMs = next ? next.startMs : segments[index].startMs;
    }
  }
  return segments;
};

const segmentByParagraph = (text: string, assetId: string, createdAt: string): TranscriptSegment[] => {
  const paragraphs = text.split(/\n\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  const segments: TranscriptSegment[] = [];
  for (const paragraph of paragraphs) {
    const normalized = normalizeLine(paragraph);
    if (!normalized) continue;
    if (normalized.length > 400) {
      const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
      sentences.forEach(sentence => {
        if (sentence.trim()) {
          segments.push(buildSegment(sentence, assetId, createdAt));
        }
      });
    } else {
      segments.push(buildSegment(normalized, assetId, createdAt));
    }
  }
  return segments;
};

export const normalizeImportedTranscript = (text: string, assetId: string, createdAt: string): TranscriptSegment[] => {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return [];
  const srtSegments = parseSrtVttSegments(normalized, assetId, createdAt);
  if (srtSegments.length > 0) return srtSegments;
  const inlineSegments = parseInlineTimestampSegments(normalized, assetId, createdAt);
  if (inlineSegments.length > 0) return inlineSegments;
  return segmentByParagraph(normalized, assetId, createdAt);
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
