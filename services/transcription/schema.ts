import { z } from 'zod';
import type { TranscriptSegment } from '../../types';
import { createId } from '../../utils/transcript';

// The engine-neutral transcript every engine must produce. The notes pipeline only ever sees
// TranscriptSegment[] built from this, so it never knows which engine ran.
// Times are seconds from the start of the recording.

const seconds = z.number().finite().min(0);

export const WordSchema = z.object({
  w: z.string(),
  start: seconds,
  end: seconds,
  conf: z.number().min(0).max(1).optional(),
});

export const SegmentSchema = z
  .object({
    id: z.string().min(1),
    start: seconds,
    end: seconds,
    text: z.string(),
    isFinal: z.boolean(),
    words: z.array(WordSchema),
  })
  .refine(segment => segment.end >= segment.start, { message: 'segment ends before it starts' });

export const TranscriptSchema = z.object({
  engine: z.string().min(1),
  modelVersion: z.string().min(1),
  language: z.string().min(1),
  segments: z.array(SegmentSchema),
});

export type Word = z.infer<typeof WordSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;

/** Validates untrusted engine output (it crosses a process boundary). Throws on invalid input. */
export const parseTranscript = (value: unknown): Transcript => TranscriptSchema.parse(value);

/** Converts a validated Transcript into the app's stored segment format for one asset. */
export const toTranscriptSegments = (transcript: Transcript, assetId: string, createdAt: string): TranscriptSegment[] =>
  transcript.segments
    .filter(segment => segment.text.trim().length > 0)
    .map(segment => ({
      id: createId('segment'),
      assetId,
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
      text: segment.text.trim(),
      isFinal: segment.isFinal,
      words: segment.words.map(word => ({
        w: word.w,
        startMs: Math.round(word.start * 1000),
        endMs: Math.round(word.end * 1000),
        ...(word.conf !== undefined ? { conf: word.conf } : {}),
      })),
      engine: transcript.engine,
      modelVersion: transcript.modelVersion,
      createdAt,
    }));
