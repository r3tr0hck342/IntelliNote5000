import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LectureAsset, StudySession, TranscriptSegment } from '../types';
import { MicIcon, StopIcon } from './icons';
import { createId, buildTranscriptText } from '../utils/transcript';
import { localEngine, describeTranscriptionError } from '../services/transcription/localEngine';
import { logEvent } from '../utils/logger';
import { parseTranscript, toTranscriptSegments } from '../services/transcription/schema';

// On-device live recording (desktop). Capture, the encrypted archive, and recognition all run in
// the app backend, so a webview reload does not stop the recording: this view reattaches.

type Source = 'mic' | 'system';
type RecorderEvent =
  | { type: 'level'; rms: number; seconds: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; segment: { id: string; start: number; end: number; text: string }; modelVersion: string }
  | { type: 'recordOnly'; reason: string }
  | { type: 'stopped'; durationSec: number; segments: number }
  | { type: 'error'; code: string };

interface Props {
  sessions: StudySession[];
  onCreateSession: (title: string, topic: string) => string;
  onCreateLiveAsset: (sessionId: string, sourceType: LectureAsset['sourceType'], language: string) => string;
  onTranscriptUpdate: (sessionId: string, assetId: string, segments: TranscriptSegment[], transcriptText: string, hasFinalUpdate: boolean) => void;
  onUseCloud: () => void;
}

const CONSENT_KEY = 'intellinote-recording-consent-v1';
const LOW_LEVEL_RMS = 0.005;
const LOW_LEVEL_SECONDS = 5;

const invoke = async <T,>(command: string, args?: Record<string, unknown>) =>
  (await import('@tauri-apps/api/core')).invoke<T>(command, args);

const RECORD_ONLY_TEXT: Record<string, string> = {
  models_missing: 'Speech models are not installed: recording audio only. It will be transcribed after you stop.',
  falling_behind: 'This computer could not keep up with live text: recording continues, and the transcript is produced after you stop.',
  below_floor: 'This computer is too slow for live text: recording audio only. The full transcript is produced after you stop.',
  recognizer_stopped: 'Live transcription stopped: recording continues, and the transcript is produced after you stop.',
};

const NativeLiveRecorder: React.FC<Props> = ({ sessions, onCreateSession, onCreateLiveAsset, onTranscriptUpdate, onUseCloud }) => {
  const [consented, setConsented] = useState(() => localStorage.getItem(CONSENT_KEY) === 'yes');
  const [source, setSource] = useState<Source>('mic');
  const [selectedSessionId, setSelectedSessionId] = useState('new');
  const [title, setTitle] = useState('');
  const [recording, setRecording] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [recordOnly, setRecordOnly] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [lowLevel, setLowLevel] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [liveModelsMissing, setLiveModelsMissing] = useState(false);
  const [download, setDownload] = useState<{ done: number; total: number } | null>(null);
  const [finalizing, setFinalizing] = useState<{ processed: number; total: number } | null>(null);
  const [tier, setTier] = useState<string | null>(null);

  const ids = useRef<{ sessionId: string; assetId: string } | null>(null);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const quietSince = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);

  const commitSegment = useCallback((segment: TranscriptSegment) => {
    const target = ids.current;
    if (!target) return;
    segmentsRef.current = [...segmentsRef.current, segment];
    setSegments(segmentsRef.current);
    onTranscriptUpdate(target.sessionId, target.assetId, segmentsRef.current, buildTranscriptText(segmentsRef.current), true);
  }, [onTranscriptUpdate]);

  const handleEvent = useCallback((event: RecorderEvent) => {
    const target = ids.current;
    switch (event.type) {
      case 'level': {
        setLevel(event.rms);
        setElapsed(event.seconds);
        const now = Date.now();
        if (event.rms < LOW_LEVEL_RMS) {
          quietSince.current ??= now;
          setLowLevel(now - quietSince.current > LOW_LEVEL_SECONDS * 1000);
        } else {
          quietSince.current = null;
          setLowLevel(false);
        }
        break;
      }
      case 'partial':
        setPartial(event.text);
        break;
      case 'final':
        setPartial('');
        if (target) {
          commitSegment({
            id: createId('segment-final'),
            assetId: target.assetId,
            startMs: Math.round(event.segment.start * 1000),
            endMs: Math.round(event.segment.end * 1000),
            text: event.segment.text,
            isFinal: true,
            engine: 'sherpa-onnx',
            modelVersion: event.modelVersion,
            createdAt: new Date().toISOString(),
          });
        }
        break;
      case 'recordOnly':
        setRecordOnly(RECORD_ONLY_TEXT[event.reason] ?? RECORD_ONLY_TEXT.recognizer_stopped);
        logEvent('warn', 'Recording switched to record-only', { reason: event.reason });
        break;
      case 'stopped':
        logEvent('info', 'Native recording stopped', { durationSec: Math.round(event.durationSec), segments: event.segments });
        break;
      case 'error':
        setError(describeTranscriptionError(event.code));
        break;
    }
  }, [commitSegment]);

  const makeChannel = useCallback(async () => {
    const { Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<RecorderEvent>();
    channel.onmessage = handleEvent;
    return channel;
  }, [handleEvent]);

  // Reattach to a recording that survived a reload, and check which models are installed.
  // One-time ~10 s benchmark (cached afterwards) picks live vs record-only for this machine.
  useEffect(() => {
    invoke<{ tier: string } | null>('transcription_tier')
      .then(result => setTier(result?.tier ?? null))
      .catch(() => setTier(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const caps = await localEngine.capabilities();
      if (!cancelled) setLiveModelsMissing(caps.models.some(model => model.role !== 'final' && !model.installed));
      const status = await invoke<{ active: boolean; sessionId?: string; assetId?: string; source?: Source; recordOnly?: boolean }>('recording_status');
      if (cancelled || !status.active || !status.sessionId || !status.assetId) return;
      ids.current = { sessionId: status.sessionId, assetId: status.assetId };
      const existing = sessions.find(s => s.id === status.sessionId)?.assets.find(a => a.id === status.assetId)?.segments ?? [];
      segmentsRef.current = existing;
      setSegments(existing);
      setSource(status.source ?? 'mic');
      setRecordOnly(status.recordOnly ? RECORD_ONLY_TEXT.recognizer_stopped : null);
      setRecording(true);
      await invoke('recording_attach', { onEvent: await makeChannel() });
    })().catch(() => setError(describeTranscriptionError('sidecar_missing')));
    return () => { cancelled = true; };
    // Run once on mount; `sessions` is only read to seed a reattached recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el && followTail.current) el.scrollTop = el.scrollHeight;
  }, [segments, partial]);

  const handleScroll = () => {
    const el = scroller.current;
    if (el) followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const handleDownload = async () => {
    setError(null);
    setDownload({ done: 0, total: 0 });
    try {
      await localEngine.installModels(['live', 'vad', 'final'], (done, total) => setDownload({ done, total }));
      setLiveModelsMissing(false);
    } catch (err) {
      setError(describeTranscriptionError(String(err)));
    } finally {
      setDownload(null);
    }
  };

  const handleStart = async () => {
    setError(null);
    setRecordOnly(null);
    setPartial('');
    segmentsRef.current = [];
    setSegments([]);
    followTail.current = true;
    const sessionId = selectedSessionId === 'new' ? onCreateSession(title, '') : selectedSessionId;
    const assetId = onCreateLiveAsset(sessionId, 'live', 'en');
    ids.current = { sessionId, assetId };
    try {
      await invoke('recording_start', { sessionId, assetId, source, onEvent: await makeChannel() });
      setRecording(true);
    } catch (err) {
      ids.current = null;
      setError(String(err) === 'system_audio_unavailable'
        ? 'System audio capture is not available on this computer. Use the microphone instead.'
        : describeTranscriptionError(String(err)));
    }
  };

  // Final pass: Parakeet over the encrypted archive replaces the live text, then the notes
  // pipeline runs on it (onTranscriptUpdate with a final update triggers auto-generation).
  const runFinalPass = useCallback(async (target: { sessionId: string; assetId: string }) => {
    setFinalizing({ processed: 0, total: 0 });
    try {
      const { Channel } = await import('@tauri-apps/api/core');
      const channel = new Channel<{ type: string; processedSec?: number; durationSec?: number }>();
      channel.onmessage = event => {
        if (event.type === 'progress') setFinalizing({ processed: event.processedSec ?? 0, total: event.durationSec ?? 0 });
      };
      const started = Date.now();
      const transcript = parseTranscript(await invoke<unknown>('recording_finalize', { assetId: target.assetId, onEvent: channel }));
      const finalSegments = toTranscriptSegments(transcript, target.assetId, new Date().toISOString());
      if (finalSegments.length > 0) {
        segmentsRef.current = finalSegments;
        setSegments(finalSegments);
        onTranscriptUpdate(target.sessionId, target.assetId, finalSegments, buildTranscriptText(finalSegments), true);
      }
      logEvent('info', 'Final transcript ready', { segments: finalSegments.length, elapsedMs: Date.now() - started });
    } catch (err) {
      // The live transcript stays; the archive is kept, so the final pass can be retried.
      setError(`Final transcript failed: ${describeTranscriptionError(String(err))} The live transcript was kept.`);
    } finally {
      setFinalizing(null);
    }
  }, [onTranscriptUpdate]);

  const handleStop = async () => {
    setStopping(true);
    const target = ids.current;
    try {
      await invoke('recording_stop');
    } finally {
      setStopping(false);
      setRecording(false);
      setPartial('');
      setLevel(0);
    }
    if (target) await runFinalPass(target);
  };

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  const sessionLocked = recording || stopping || !!finalizing;

  if (!consented) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-800 p-8">
        <div className="max-w-lg bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Before you record</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Recording lectures may be restricted by your institution&apos;s policy and by local consent laws. You are responsible for getting permission from the instructor and anyone else being recorded.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Audio and transcripts stay on this computer, encrypted. Notes generation sends transcript text to the AI provider you chose in Settings (use Ollama to keep everything local).
          </p>
          <button
            onClick={() => { localStorage.setItem(CONSENT_KEY, 'yes'); setConsented(true); }}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
          >
            I understand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col items-center bg-gray-50 dark:bg-gray-800 p-8 overflow-y-auto">
      <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Live Note Taker</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        On-device transcription · free · offline{' '}
        <button onClick={onUseCloud} disabled={sessionLocked} className="underline disabled:opacity-50">Use a cloud provider instead</button>
      </p>

      {liveModelsMissing && !recording && (
        <div className="mb-4 w-full max-w-2xl rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 p-3 text-sm text-gray-700 dark:text-gray-300 flex items-center justify-between gap-3">
          <span>Live text needs the speech models (~950 MB, one time). Without them, audio is still recorded.</span>
          <button onClick={handleDownload} disabled={!!download} className="px-3 py-1.5 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
            {download ? `${Math.round(download.done / 1e6)} / ${Math.round((download.total || 0) / 1e6)} MB` : 'Download'}
          </button>
        </div>
      )}

      <div className="mb-6 w-full max-w-2xl grid grid-cols-1 md:grid-cols-3 gap-3">
        <select value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)} disabled={sessionLocked} aria-label="Session"
          className="border border-gray-300 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
          <option value="new">Create new session</option>
          {sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
        </select>
        {selectedSessionId === 'new' ? (
          <input value={title} onChange={e => setTitle(e.target.value)} disabled={sessionLocked} placeholder="Session title" aria-label="Session title"
            className="border border-gray-300 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200" />
        ) : <div />}
        <select value={source} onChange={e => setSource(e.target.value as Source)} disabled={sessionLocked} aria-label="Input source"
          className="border border-gray-300 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
          <option value="mic">Microphone</option>
          <option value="system">System audio (online lecture)</option>
        </select>
      </div>

      {tier && !recording && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {tier === 'below-floor'
            ? 'This computer records first and transcribes after you stop.'
            : `Live text on this computer: ${tier === 'high' ? 'fast' : 'standard'}.`}
        </p>
      )}

      <button
        onClick={recording ? handleStop : handleStart}
        disabled={stopping || !!finalizing}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={`${recording ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'} text-white rounded-full p-6 shadow-lg disabled:opacity-50 mb-4`}
      >
        {recording ? <StopIcon className="w-12 h-12" /> : <MicIcon className="w-12 h-12" />}
      </button>

      {(recording || stopping) && (
        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-3">
          <span className="font-semibold tabular-nums">{stopping ? 'Finishing…' : clock}</span>
          <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden" role="meter" aria-label="Input level" aria-valuenow={Math.round(level * 100)}>
            <div className="h-full bg-indigo-500 transition-all duration-100" style={{ width: `${Math.min(100, level * 400)}%` }} />
          </div>
          {lowLevel && <span className="text-yellow-600 dark:text-yellow-400">Very quiet input: check the source or move closer.</span>}
        </div>
      )}

      {finalizing && (
        <div className="mb-3 w-full max-w-3xl" role="status">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
            Finalizing transcript… {finalizing.total > 0 ? `${Math.round((finalizing.processed / finalizing.total) * 100)}%` : ''}
          </p>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${finalizing.total > 0 ? Math.min(100, (finalizing.processed / finalizing.total) * 100) : 5}%` }} />
          </div>
        </div>
      )}

      {recordOnly && (
        <div className="mb-3 w-full max-w-3xl rounded-md bg-yellow-50 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
          ● Record-only mode. {recordOnly}
        </div>
      )}

      <div ref={scroller} onScroll={handleScroll} className="w-full max-w-3xl h-72 bg-white dark:bg-gray-900 rounded-lg p-4 overflow-y-auto border border-gray-200 dark:border-gray-700 text-left">
        <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
          {segments.map(segment => segment.text).join(' ')}
          {partial && <span className="text-gray-400 dark:text-gray-500 italic">{segments.length ? ' ' : ''}{partial}</span>}
          {!segments.length && !partial && <span className="text-gray-400">{recording ? 'Listening…' : 'Press the microphone to start.'}</span>}
        </p>
      </div>
      {error && <p className="text-red-500 dark:text-red-400 mt-3 text-sm">{error}</p>}
    </div>
  );
};

export default NativeLiveRecorder;
