import React, { useEffect, useMemo, useState } from 'react';
import { LogEntry, LogLevel, clearLogs, subscribeToLogs } from '../utils/logger';
import { XIcon, TrashIcon } from './icons';

interface DiagnosticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const levelStyles: Record<LogLevel, string> = {
  debug: 'text-gray-500',
  info: 'text-blue-500',
  warn: 'text-yellow-600',
  error: 'text-red-600',
};

const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');

  useEffect(() => subscribeToLogs(setEntries), []);

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter(entry => entry.level === filter);
  }, [entries, filter]);

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
