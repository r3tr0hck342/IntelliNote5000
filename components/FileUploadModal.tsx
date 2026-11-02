import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Handout, StudySession } from '../types';
import { UploadIcon, FileTextIcon, XIcon, MicIcon } from './icons';
import { parseFile } from '../utils/fileParser';
import { estimateTranscriptStats, normalizeTranscriptText } from '../utils/transcript';
import { isTauri } from '../utils/native';
import { localEngine, describeTranscriptionError } from '../services/transcription/localEngine';
import type { Transcript } from '../services/transcription/schema';
import type { TranscriptionProgress } from '../services/transcription/engine';

type DeviceStatus = 'checking' | 'unavailable' | 'needs-models' | 'downloading' | 'ready' | 'transcribing';

const formatMb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
const formatClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

type ImportPipelineStage = 'notes' | 'study-guide' | 'test-questions' | 'flashcards' | 'tags';
type ImportPipelineStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

interface ImportPipelineProgress {
  stage: ImportPipelineStage;
  status: ImportPipelineStatus;
  error?: string;
}

interface FileUploadModalProps {
  onClose: () => void;
  onCreateLecture: (data: {
    title: string;
    transcript: string;
    handouts: Handout[];
    sessionId?: string;
    /** Set when the text came from on-device transcription: keeps word timings and engine info. */
    transcriptData?: Transcript;
    onProgress?: (progress: ImportPipelineProgress) => void;
  }) => { cancel: () => void; done: Promise<void> };
  sessions: StudySession[];
}

const FileUploadModal: React.FC<FileUploadModalProps> = ({ onClose, onCreateLecture, sessions }) => {
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('new');
  const [transcriptFileName, setTranscriptFileName] = useState<string | null>(null);
  const [importController, setImportController] = useState<{ cancel: () => void; done: Promise<void> } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<Record<ImportPipelineStage, ImportPipelineStatus>>({
    notes: 'queued',
    tags: 'queued',
    'study-guide': 'queued',
    'test-questions': 'queued',
    flashcards: 'queued',
  });
  const [importError, setImportError] = useState<string | null>(null);
  const [importComplete, setImportComplete] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>(isTauri() ? 'checking' : 'unavailable');
  const [modelsBytes, setModelsBytes] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState({ done: 0, total: 0 });
  const [transcribeProgress, setTranscribeProgress] = useState<TranscriptionProgress | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceTranscript, setDeviceTranscript] = useState<Transcript | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    localEngine.capabilities()
      .then(caps => {
        const missing = caps.models.filter(model => !model.installed && (model.role === 'final' || model.role === 'vad'));
        setModelsBytes(missing.reduce((sum, model) => sum + model.downloadBytes, 0));
        setDeviceStatus(missing.length > 0 ? 'needs-models' : 'ready');
      })
      .catch(() => setDeviceStatus('unavailable'));
  }, []);

  const handleDownloadModels = async () => {
    setDeviceError(null);
    setDeviceStatus('downloading');
    try {
      await localEngine.installModels(['final', 'vad'], (done, total) => setDownloadProgress({ done, total }));
      setDeviceStatus('ready');
    } catch (error) {
      setDeviceError(describeTranscriptionError(String(error)));
      setDeviceStatus('needs-models');
    }
  };

  const handleTranscribeOnDevice = async () => {
    setDeviceError(null);
    setDeviceStatus('transcribing');
    setTranscribeProgress(null);
    try {
      const result = await localEngine.transcribeFile({ kind: 'picker' }, { language: 'auto', onProgress: setTranscribeProgress });
      if (result) {
        setTranscript(result.segments.map(segment => segment.text).join('\n\n'));
        setTranscriptFileName('On-device transcript');
        setDeviceTranscript(result);
      }
    } catch (error) {
      setDeviceError(describeTranscriptionError(String(error)));
    } finally {
      setDeviceStatus('ready');
      setTranscribeProgress(null);
    }
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsParsing(true);
    const newHandouts: Handout[] = [];
    for (const file of Array.from(files)) {
      try {
        const handout = await parseFile(file);
        if (handout) {
          newHandouts.push(handout);
        }
      } catch (error) {
        alert(`Failed to parse ${file.name}. Please ensure it's a valid and non-corrupted file.`);
      }
    }
    setHandouts(prev => [...prev, ...newHandouts]);
    setIsParsing(false);
  }, []);

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(isOver);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    handleDragEvents(e, false);
    handleFiles(e.dataTransfer.files);
  };

  const handleTranscriptFile = (file: File | null) => {
    if (!file) return;
    const isSupported = file.name.endsWith('.txt') || file.name.endsWith('.md') || file.type.startsWith('text/');
    if (!isSupported) {
      alert('Unsupported transcript format. Please upload a .txt or .md file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      if (content) {
        setTranscript(content);
        setTranscriptFileName(file.name);
      }
    };
    reader.onerror = () => {
      alert(`Failed to read ${file.name}. Please try again.`);
    };
    reader.readAsText(file);
  };

  const handleCreate = () => {
    if (!transcript.trim()) {
      alert('A transcript is required to use the AI features.');
      return;
    }
    setIsImporting(true);
    setImportComplete(false);
    setImportError(null);
    setImportProgress({
      notes: 'queued',
      tags: 'queued',
      'study-guide': 'queued',
      'test-questions': 'queued',
      flashcards: 'queued',
    });
    const controller = onCreateLecture({
      title,
      transcript,
      handouts,
      sessionId: selectedSessionId === 'new' ? undefined : selectedSessionId,
      transcriptData: deviceTranscript ?? undefined,
      onProgress: (progress) => {
        setImportProgress(prev => ({ ...prev, [progress.stage]: progress.status }));
        if (progress.status === 'error' && progress.error) {
          setImportError(progress.error);
        }
      },
    });
    setImportController(controller);
    controller.done
      .then(() => {
        setImportComplete(true);
      })
      .catch((error: Error) => {
        setImportError(error.message);
      })
      .finally(() => {
        setIsImporting(false);
      });
  };
  
  const removeHandout = (index: number) => {
      setHandouts(prev => prev.filter((_, i) => i !== index));
  }

  const handleCancelPipeline = () => {
    if (importController) {
      importController.cancel();
    }
    setIsImporting(false);
  };

  const stats = useMemo(() => estimateTranscriptStats(transcript), [transcript]);
  const previewText = useMemo(() => normalizeTranscriptText(transcript).slice(0, 800), [transcript]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Import Transcript or Handouts</h2>
          <button
            onClick={isImporting ? undefined : onClose}
            disabled={isImporting}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="space-y-3">
            <div>
              <label htmlFor="session-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Save to Session</label>
              <select
                id="session-select"
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                disabled={isImporting}
                className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="new">Create new session</option>
                {sessions.map(session => (
                  <option key={session.id} value={session.id}>{session.title}</option>
                ))}
              </select>
            </div>
            {selectedSessionId === 'new' && (
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Session Title</label>
                  <input
                    id="title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isImporting}
                    placeholder="e.g., Introduction to Quantum Physics"
                    className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
            )}
          </div>

          {deviceStatus !== 'unavailable' && (
            <div className="rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 p-4 space-y-2">
              <div className="flex items-center gap-2 font-medium text-gray-800 dark:text-gray-200">
                <MicIcon className="w-5 h-5 text-indigo-500" />
                Transcribe a recording on this device
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">Free · offline</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Audio or video (MP3, M4A, MP4, WAV, FLAC, OGG…) is transcribed with open-source models on your computer. Nothing is uploaded.
              </p>
              {deviceStatus === 'checking' && <p className="text-sm text-gray-500">Checking speech models…</p>}
              {deviceStatus === 'needs-models' && (
                <button
                  type="button"
                  onClick={handleDownloadModels}
                  disabled={isImporting}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  Download speech models ({formatMb(modelsBytes)}, one time)
                </button>
              )}
              {deviceStatus === 'downloading' && (
                <div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${downloadProgress.total ? Math.min(100, (downloadProgress.done / downloadProgress.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatMb(downloadProgress.done)} of {formatMb(downloadProgress.total || modelsBytes)} · verifying each file before use
                  </p>
                </div>
              )}
              {deviceStatus === 'ready' && (
                <button
                  type="button"
                  onClick={handleTranscribeOnDevice}
                  disabled={isImporting}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  Choose audio or video file…
                </button>
              )}
              {deviceStatus === 'transcribing' && (
                <p className="text-sm text-gray-700 dark:text-gray-300 animate-pulse">
                  {transcribeProgress?.stage === 'converting'
                    ? 'Converting the file…'
                    : transcribeProgress && 'processedSec' in transcribeProgress && transcribeProgress.processedSec
                      ? `Transcribing… ${formatClock(transcribeProgress.processedSec)}${transcribeProgress.durationSec ? ` of ${formatClock(transcribeProgress.durationSec)}` : ''}`
                      : 'Loading models and transcribing…'}
                </p>
              )}
              {deviceError && <p className="text-sm text-red-500 dark:text-red-400">{deviceError}</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transcript File (.txt, .md)</label>
            <div className="flex items-center space-x-3">
              <label className="cursor-pointer text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium">
                Choose file
                <input
                  type="file"
                  className="sr-only"
                  onChange={(e) => handleTranscriptFile(e.target.files?.[0] ?? null)}
                  accept=".txt,.md,text/plain,text/markdown"
                  disabled={isImporting}
                />
              </label>
              {transcriptFileName && (
                <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 space-x-2">
                  <span className="truncate max-w-[220px]">{transcriptFileName}</span>
                  <button
                    onClick={() => {
                      setTranscriptFileName(null);
                      setTranscript('');
                      setDeviceTranscript(null);
                    }}
                    className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
                    disabled={isImporting}
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="transcript" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Transcript Text <span className="text-red-500 dark:text-red-400">*</span>
            </label>
            <textarea
              id="transcript"
              value={transcript}
              onChange={(e) => {
                setTranscript(e.target.value);
                setDeviceTranscript(null); // hand edits invalidate the word timings
              }}
              disabled={isImporting}
              rows={8}
              placeholder="Paste the full transcript here. This is required for all AI features."
              className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-3">
              <span>{stats.charCount.toLocaleString()} characters</span>
              <span>{stats.wordCount.toLocaleString()} words</span>
              <span>~{stats.estimatedMinutes} min read</span>
            </div>
            {previewText && (
              <div className="mt-3 p-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {previewText}
                {previewText.length < normalizeTranscriptText(transcript).length && '…'}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Attach Handouts (PDF, DOCX, TXT, MD)</label>
            <div
              onDragEnter={(e) => handleDragEvents(e, true)}
              onDragLeave={(e) => handleDragEvents(e, false)}
              onDragOver={(e) => handleDragEvents(e, true)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-md p-6 text-center transition-colors ${
                dragOver ? 'border-indigo-500 bg-gray-100 dark:bg-gray-700' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <UploadIcon className="w-10 h-10 mx-auto text-gray-500 mb-2" />
              <p className="text-gray-600 dark:text-gray-400">Drag & drop files here, or</p>
              <label htmlFor="file-upload" className="cursor-pointer text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium">
                browse to upload
                <input id="file-upload" type="file" multiple className="sr-only" onChange={(e) => handleFiles(e.target.files)} accept=".pdf,.docx,.txt,.md,.text" disabled={isImporting} />
              </label>
            </div>
          </div>
          
          {isParsing && <p className="text-center text-gray-500 dark:text-gray-400 animate-pulse">Parsing files...</p>}

          {handouts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Attached Files:</h3>
              <ul className="space-y-2">
                {handouts.map((handout, index) => (
                  <li key={index} className="bg-gray-100 dark:bg-gray-700 rounded-md p-2 flex items-center justify-between text-sm">
                    <div className="flex items-center overflow-hidden">
                      <FileTextIcon className="w-5 h-5 mr-2 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                      <span className="text-gray-800 dark:text-gray-200 truncate">{handout.name}</span>
                    </div>
                     <button onClick={() => removeHandout(index)} disabled={isImporting} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white flex-shrink-0 disabled:opacity-50">
                        <XIcon className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(isImporting || importComplete || importError) && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-md p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">AI Import Pipeline</h3>
              <ul className="space-y-2 text-sm">
                {(['notes', 'study-guide', 'test-questions', 'flashcards', 'tags'] as ImportPipelineStage[]).map(stage => (
                  <li key={stage} className="flex items-center justify-between">
                    <span className="capitalize text-gray-600 dark:text-gray-400">{stage.replace('-', ' ')}</span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {importProgress[stage] === 'running' && 'Running…'}
                      {importProgress[stage] === 'queued' && 'Queued'}
                      {importProgress[stage] === 'success' && 'Done'}
                      {importProgress[stage] === 'error' && 'Error'}
                      {importProgress[stage] === 'cancelled' && 'Cancelled'}
                    </span>
                  </li>
                ))}
              </ul>
              {importError && (
                <p className="text-sm text-red-500 dark:text-red-400">Error: {importError}</p>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={isImporting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {importComplete ? 'Close' : 'Cancel'}
          </button>
          {isImporting && (
            <button
              onClick={handleCancelPipeline}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-md hover:bg-red-600"
            >
              Cancel AI Pipeline
            </button>
          )}
          <button
            onClick={handleCreate}
            disabled={isParsing || !transcript.trim() || isImporting}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed"
          >
            {isImporting ? 'Importing...' : 'Import Transcript'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileUploadModal;
