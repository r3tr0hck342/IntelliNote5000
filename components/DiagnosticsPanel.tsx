import React, { useEffect, useMemo, useState } from 'react';
import { LogEntry, LogLevel, clearLogs, subscribeToLogs } from '../utils/logger';
import { XIcon, TrashIcon } from './icons';
import type { SttConfig } from '../types/stt';
import { runSttProbe } from '../services/stt/probe';
import type { SttProbeSummary } from '../utils/sttProbe';
import type { DryRunPipelineResult } from '../services/aiService';

interface DiagnosticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sttConfig: SttConfig | null;
  onRunDryRunImportPipeline: () => Promise<DryRunPipelineResult>;
}

const levelStyles: Record<LogLevel, string> = {
  debug: 'text-gray-500',
  info: 'text-blue-500',
  warn: 'text-yellow-600',
  error: 'text-red-600',
};

const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ isOpen, onClose, sttConfig, onRunDryRunImportPipeline }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [sttProbeStatus, setSttProbeStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [sttProbeError, setSttProbeError] = useState<string | null>(null);
  const [sttProbeResult, setSttProbeResult] = useState<SttProbeSummary | null>(null);
  const [dryRunStatus, setDryRunStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunPipelineResult | null>(null);

  useEffect(() => subscribeToLogs(setEntries), []);

  const handleRunSttProbe = async () => {
    if (!sttConfig?.apiKey) {
      setSttProbeError('Configure a transcription provider API key first.');
      setSttProbeStatus('error');
      return;
    }
    setSttProbeStatus('running');
    setSttProbeError(null);
    setSttProbeResult(null);
    try {
      const result = await runSttProbe(sttConfig, {
        onProgress: (summary) => setSttProbeResult(summary),
      });
      setSttProbeResult(result);
      setSttProbeStatus('done');
    } catch (error) {
      setSttProbeError(error instanceof Error ? error.message : 'STT probe failed.');
      setSttProbeStatus('error');
    }
  };

  const handleDryRunPipeline = async () => {
    setDryRunStatus('running');
    setDryRunError(null);
    setDryRunResult(null);
    try {
      const result = await onRunDryRunImportPipeline();
      setDryRunResult(result);
      setDryRunStatus('done');
    } catch (error) {
      setDryRunError(error instanceof Error ? error.message : 'Dry-run pipeline failed.');
      setDryRunStatus('error');
    }
  };

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter(entry => entry.level === filter);
  }, [entries, filter]);

  const sttProbeEntries = useMemo(() => {
    if (!sttProbeResult) return [];
    return [
      ['time_to_first_interim_ms', sttProbeResult.time_to_first_interim_ms ?? '—'],
      ['interim_events_count', sttProbeResult.interim_events_count],
      ['interim_cadence_per_sec', sttProbeResult.interim_cadence_per_sec],
      ['time_to_first_final_ms', sttProbeResult.time_to_first_final_ms ?? '—'],
      ['final_events_count', sttProbeResult.final_events_count],
      ['reconnect_count', sttProbeResult.reconnect_count],
      ['ws_open_to_close_reason', sttProbeResult.ws_open_to_close_reason ?? '—'],
      ['audio_frames_sent', sttProbeResult.audio_frames_sent],
      ['audio_frames_dropped', sttProbeResult.audio_frames_dropped],
      ['avg_frame_queue_depth', sttProbeResult.avg_frame_queue_depth ?? '—'],
    ];
  }, [sttProbeResult]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[55] w-full max-w-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Diagnostics</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Recent events for debugging (no sensitive keys logged).</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearLogs}
            className="p-2 rounded-md text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            aria-label="Clear logs"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            aria-label="Close diagnostics"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400">{filteredEntries.length} events</div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as LogLevel | 'all')}
          className="text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1"
        >
          <option value="all">All levels</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">Run 10s STT Probe</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Streams mic audio to Deepgram and reports timing stats.</div>
            </div>
            <button
              onClick={handleRunSttProbe}
              disabled={sttProbeStatus === 'running'}
              className="text-xs px-3 py-1 rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              {sttProbeStatus === 'running' ? 'Running…' : 'Run 10s STT Probe'}
            </button>
          </div>
          {sttProbeError && (
            <div className="mt-2 text-xs text-red-500 dark:text-red-400">{sttProbeError}</div>
          )}
          {sttProbeEntries.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
              {sttProbeEntries.map(([label, value]) => (
                <div key={label} className="flex flex-col rounded-md border border-gray-100 dark:border-gray-800 p-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">Dry-run Import Pipeline</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Validates import wiring without calling providers.</div>
            </div>
            <button
              onClick={handleDryRunPipeline}
              disabled={dryRunStatus === 'running'}
              className="text-xs px-3 py-1 rounded-md bg-gray-800 text-white disabled:opacity-50"
            >
              {dryRunStatus === 'running' ? 'Running…' : 'Dry-run Import Pipeline'}
            </button>
          </div>
          {dryRunError && (
            <div className="mt-2 text-xs text-red-500 dark:text-red-400">{dryRunError}</div>
          )}
          {dryRunResult && (
            <div className="mt-2 space-y-2 text-xs text-gray-600 dark:text-gray-300">
              <div className="flex flex-wrap gap-3">
                <span className="text-gray-500">Provider: <span className="font-semibold text-gray-800 dark:text-gray-100">{dryRunResult.providerId}</span></span>
                <span className="text-gray-500">Segments: <span className="font-semibold text-gray-800 dark:text-gray-100">{dryRunResult.validation.transcriptSegments}</span></span>
                <span className="text-gray-500">Handouts: <span className="font-semibold text-gray-800 dark:text-gray-100">{dryRunResult.validation.handoutCount}</span></span>
              </div>
              {dryRunResult.validation.missingFields.length > 0 && (
                <div className="text-xs text-yellow-600 dark:text-yellow-400">
                  Missing: {dryRunResult.validation.missingFields.join(', ')}
                </div>
              )}
              <ul className="space-y-1">
                {dryRunResult.generators.map(generator => (
                  <li key={generator.id} className="border border-gray-100 dark:border-gray-800 rounded-md p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">{generator.id}</div>
                    <div className="text-gray-800 dark:text-gray-100">{generator.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto px-4 py-3 space-y-3 text-xs">
        {filteredEntries.length === 0 ? (
          <div className="text-gray-500 dark:text-gray-400">No diagnostics yet.</div>
        ) : (
          filteredEntries
            .slice()
            .reverse()
            .map(entry => (
              <div key={entry.id} className="border-b border-gray-100 dark:border-gray-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold uppercase ${levelStyles[entry.level]}`}>{entry.level}</span>
                  <span className="text-gray-400">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="text-gray-800 dark:text-gray-200">{entry.message}</div>
                {entry.data && (
                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500 dark:text-gray-400">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
        )}
      </div>
    </div>
  );
};

export default DiagnosticsPanel;
