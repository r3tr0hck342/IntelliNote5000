import assert from 'node:assert/strict';
import { finalizeSegment, normalizeImportedTranscript, normalizeTranscriptText, parseImportedTranscript, parseTimestampToMs, upsertInterimSegment } from '../utils/transcript.ts';

const createdAt = new Date('2024-01-01T00:00:00Z').toISOString();

const imported = normalizeImportedTranscript('Line one\n\nLine two', 'asset-1', createdAt);
assert.equal(imported.length, 2);
assert.equal(imported[0].text, 'Line one');
assert.equal(imported[1].text, 'Line two');
assert.ok(imported.every(segment => segment.isFinal));

const normalizedText = normalizeTranscriptText('  Hello\tworld \n\n\nThis   is  a test. ');
assert.equal(normalizedText, 'Hello world\n\nThis is a test.');

assert.equal(parseTimestampToMs('00:12:03'), 723000);
assert.equal(parseTimestampToMs('01:02:03.456'), 3723456);
assert.equal(parseTimestampToMs('1:02:03,5'), 3723500);

const timestamped = normalizeImportedTranscript('[00:00:01] First line\n[00:00:05] Second line', 'asset-1', createdAt);
assert.equal(timestamped.length, 2);
assert.equal(timestamped[0].startMs, 1000);
assert.equal(timestamped[1].startMs, 5000);

const vttTimestamped = normalizeImportedTranscript('WEBVTT\n\n00:12.345 --> 00:15.678\nHello VTT\n\n00:20.000 --> 00:21.500\nSecond line', 'asset-1', createdAt);
assert.equal(vttTimestamped.length, 2);
assert.equal(vttTimestamped[0].startMs, 12345);
assert.equal(vttTimestamped[0].endMs, 15678);
assert.equal(vttTimestamped[1].startMs, 20000);
assert.equal(vttTimestamped[1].endMs, 21500);

const interim = {
  id: 'segment-interim',
  assetId: 'asset-1',
  startMs: 0,
  endMs: 1000,
  text: 'hello wor',
  isFinal: false,
  createdAt,
};

const withInterim = upsertInterimSegment(imported, interim);
assert.equal(withInterim.some(segment => !segment.isFinal), true);

const final = {
  ...interim,
  id: 'segment-final',
  text: 'hello world',
  isFinal: true,
};

const finalized = finalizeSegment(withInterim, final, interim.id);
assert.equal(finalized.some(segment => !segment.isFinal), false);
assert.ok(finalized.find(segment => segment.id === 'segment-final'));

const desktopRows = [{ text: 'Native cue', startMs: 1000, endMs: 2000 }];
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __TAURI__: {},
    __TAURI_INTERNALS__: {
      invoke: async (command: string, args: unknown) => {
        assert.equal(command, 'parse_transcript_import');
        assert.deepEqual(args, { text: 'Input transcript' });
        return desktopRows;
      },
    },
  },
});
const desktop = await parseImportedTranscript('Input transcript', 'asset-1', createdAt);
assert.deepEqual(desktop.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), desktopRows);
assert.equal(desktop[0].assetId, 'asset-1');
assert.equal(desktop[0].isFinal, true);
Reflect.deleteProperty(globalThis, 'window');

const browser = await parseImportedTranscript('Line one\n\nLine two', 'asset-1', createdAt);
assert.deepEqual(browser.map(segment => segment.text), ['Line one', 'Line two']);

console.log('Transcript pipeline tests passed.');
