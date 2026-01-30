import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import LiveNoteTaker from './components/LiveNoteTaker';
import FileUploadModal from './components/FileUploadModal';
import SettingsModal from './components/SettingsModal';
import ToastViewport from './components/ToastViewport';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import { AppView, Handout, TranscriptSegment, GenerationMode, StudySession, LectureAsset } from './types';
import { BrainIcon, MenuIcon } from './components/icons';
import { processTranscript, generateFlashcards, generateTags } from './services/aiService';
import { App as CapacitorApp } from '@capacitor/app';
import mermaid from 'mermaid';
import { ApiConfig, loadApiConfig, persistApiConfig, clearStoredApiConfig } from './utils/apiConfig';
import { PROVIDER_METADATA } from './services/providers';
import { SttConfig } from './types/stt';
import { loadSttConfig, persistSttConfig, clearStoredSttConfig } from './utils/transcriptionConfig';
import { STT_PROVIDER_METADATA } from './services/stt';
import { buildTranscriptText, createId, normalizeImportedTranscript } from './utils/transcript';
import { loadPersistedSessions, persistSessions } from './utils/sessionStorage';
import { loadDiagnosticsPreference, persistDiagnosticsPreference } from './utils/diagnosticsConfig';
import { loadAutoGenerationConfig, persistAutoGenerationConfig } from './utils/autoGenerationConfig';
import { getCredentialFallbackPreference, setCredentialFallbackPreference } from './utils/credentialPolicy';
import { clearAllCredentials } from './utils/credentialCleanup';
import { logEvent } from './utils/logger';

const PROVIDERS = Object.values(PROVIDER_METADATA);
const STT_PROVIDERS = Object.values(STT_PROVIDER_METADATA);

const getInitialTheme = (): 'light' | 'dark' => {
  const storedTheme = localStorage.getItem('intellinote-theme');
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }
  return 'dark';
};


const App: React.FC = () => {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>(AppView.Welcome);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 768);
  
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [sttConfig, setSttConfig] = useState<SttConfig | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(loadDiagnosticsPreference());
  const [autoGenerationConfig, setAutoGenerationConfig] = useState(loadAutoGenerationConfig());
  const [credentialFallbackEnabled, setCredentialFallbackEnabled] = useState(getCredentialFallbackPreference());
  const isApiKeyReady = Boolean(apiConfig?.apiKey);
  const isSttKeyReady = Boolean(sttConfig?.apiKey);
  const sessionsRef = useRef<StudySession[]>([]);
  const autoGenerationTrackerRef = useRef<Record<string, { lastRunAt: number; pendingFinals: number }>>({});
  const importPipelineControllersRef = useRef<Record<string, { timeoutId?: number; cancel?: () => void }>>({});

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  useEffect(() => {
    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (!canGoBack) {
        CapacitorApp.exitApp();
      } else {
        window.history.back();
      }
    });
    return () => {
        CapacitorApp.removeAllListeners();
    }
  }, []);

  useEffect(() => {
    try {
        const { sessions: storedSessions } = loadPersistedSessions();
        setSessions(storedSessions);
        if (storedSessions.length > 0) {
          logEvent('info', 'Sessions loaded', { count: storedSessions.length });
        }
    } catch (e) {
        console.error("Failed to load sessions from localStorage", e);
        logEvent('error', 'Failed to load sessions', { message: e instanceof Error ? e.message : 'Unknown error' });
    }
  }, []);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    try {
        persistSessions(sessions);
    } catch (e) {
        console.error("Failed to save sessions to localStorage", e);
        logEvent('error', 'Failed to persist sessions', { message: e instanceof Error ? e.message : 'Unknown error' });
    }
  }, [sessions]);

  useEffect(() => {
    let mounted = true;
    loadApiConfig()
      .then(config => {
        if (mounted) setApiConfig(config);
      })
      .catch(error => {
        console.warn('Failed to load API config', error);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    loadSttConfig()
      .then(config => {
        if (mounted) setSttConfig(config);
      })
      .catch(error => {
        console.warn('Failed to load STT config', error);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('intellinote-theme', theme);
    mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'dark' ? 'light' : 'dark'));
  };

  const handleNewLiveLecture = () => {
    setCurrentView(AppView.Live);
    setActiveSessionId(null);
    setActiveAssetId(null);
    if(isMobile) setIsSidebarOpen(false);
  };

  const updateSession = useCallback((id: string, updates: Partial<StudySession>) => {
    setSessions(prevSessions => prevSessions.map(session => session.id === id ? { ...session, ...updates, updatedAt: new Date().toISOString() } : session));
  }, []);

  type ImportPipelineStage = 'notes' | 'study-guide' | 'test-questions' | 'flashcards' | 'tags';
  type ImportPipelineStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';
  type ImportPipelineProgress = { stage: ImportPipelineStage; status: ImportPipelineStatus; error?: string };

  const runAiPipeline = useCallback(async (
    session: StudySession,
    options?: { onProgress?: (progress: ImportPipelineProgress) => void; isCancelled?: () => boolean }
  ) => {
    const transcript = session.assets.flatMap(asset => asset.segments).filter(segment => segment.isFinal);
    logEvent('info', 'Auto-generation triggered', { sessionId: session.id, segments: transcript.length });

    const isCancelled = options?.isCancelled ?? (() => false);
    const report = (stage: ImportPipelineStage, status: ImportPipelineStatus, error?: string) => {
      options?.onProgress?.({ stage, status, error });
    };
    const flashcardCount = 10;

    const handleNotesSuccess = (notes: string) => {
      updateSession(session.id, { organizedNotes: notes, organizedNotesStatus: 'success' });
    };
    const handleTagsSuccess = (tags: string[]) => {
      updateSession(session.id, { suggestedTags: tags, tagsStatus: 'success' });
    };

    if (isCancelled()) return;
    report('notes', 'running');
    try {
      const notes = await processTranscript(transcript, GenerationMode.Notes, session.handouts, false, {
        onRetrySuccess: handleNotesSuccess,
      });
      if (!isCancelled()) {
        handleNotesSuccess(notes);
        report('notes', 'success');
      }
    } catch (e) {
      console.error("Failed to auto-generate notes:", e);
      if (!isCancelled()) {
        updateSession(session.id, { organizedNotesStatus: 'error' });
        report('notes', 'error', e instanceof Error ? e.message : 'Failed to generate notes');
      }
    }

    if (isCancelled()) return;
    report('tags', 'running');
    try {
      const tags = await generateTags(transcript, session.handouts, { onRetrySuccess: handleTagsSuccess });
      if (!isCancelled()) {
        handleTagsSuccess(tags);
        report('tags', 'success');
      }
    } catch (e) {
      console.error("Failed to auto-generate tags:", e);
      if (!isCancelled()) {
        updateSession(session.id, { tagsStatus: 'error' });
        report('tags', 'error', e instanceof Error ? e.message : 'Failed to generate tags');
      }
    }

    if (isCancelled()) return;
    report('study-guide', 'running');
    try {
      const guide = await processTranscript(transcript, GenerationMode.StudyGuide, session.handouts, false);
      if (!isCancelled()) {
        updateSession(session.id, { studyGuide: guide });
        report('study-guide', 'success');
      }
    } catch (e) {
      console.error("Failed to auto-generate study guide:", e);
      if (!isCancelled()) {
        report('study-guide', 'error', e instanceof Error ? e.message : 'Failed to generate study guide');
      }
    }

    if (isCancelled()) return;
    report('test-questions', 'running');
    try {
      const questions = await processTranscript(transcript, GenerationMode.TestQuestions, session.handouts, false);
      if (!isCancelled()) {
        updateSession(session.id, { testQuestions: questions });
        report('test-questions', 'success');
      }
    } catch (e) {
      console.error("Failed to auto-generate test questions:", e);
      if (!isCancelled()) {
        report('test-questions', 'error', e instanceof Error ? e.message : 'Failed to generate test questions');
      }
    }

    if (isCancelled()) return;
    report('flashcards', 'running');
    try {
      const flashcards = await generateFlashcards(transcript, session.handouts, flashcardCount, false);
      if (!isCancelled()) {
        updateSession(session.id, { flashcards });
        report('flashcards', 'success');
      }
    } catch (e) {
      console.error("Failed to auto-generate flashcards:", e);
      if (!isCancelled()) {
        report('flashcards', 'error', e instanceof Error ? e.message : 'Failed to generate flashcards');
      }
    }
  }, [updateSession]);

  const triggerAutoGeneration = useCallback(async (session: StudySession) => {
    await runAiPipeline(session);
  }, [runAiPipeline]);

  const scheduleAutoGeneration = useCallback((sessionId: string, delayMs: number) => {
    setSessions(prevSessions =>
      prevSessions.map(session =>
        session.id === sessionId
          ? { ...session, organizedNotesStatus: 'generating', tagsStatus: 'generating', updatedAt: new Date().toISOString() }
          : session
      )
    );
    const timers = (window as any).__autoGenTimers || {};
    if (timers[sessionId]) {
      window.clearTimeout(timers[sessionId]);
    }
    (window as any).__autoGenTimers = timers;
    timers[sessionId] = window.setTimeout(() => {
      const session = sessionsRef.current.find(item => item.id === sessionId);
      if (session) {
        triggerAutoGeneration(session);
      }
    }, delayMs);
  }, [triggerAutoGeneration]);

  const queueImportPipeline = useCallback((sessionId: string, onProgress?: (progress: ImportPipelineProgress) => void) => {
    const stages: ImportPipelineStage[] = ['notes', 'tags', 'study-guide', 'test-questions', 'flashcards'];
    const existing = importPipelineControllersRef.current[sessionId];
    if (existing?.timeoutId) {
      window.clearTimeout(existing.timeoutId);
    }
    if (existing?.cancel) {
      existing.cancel();
    }

    let cancelled = false;
    let resolveDone: () => void;
    const done = new Promise<void>(resolve => {
      resolveDone = resolve;
    });

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      stages.forEach(stage => onProgress?.({ stage, status: 'cancelled' }));
      resolveDone();
    };

    stages.forEach(stage => onProgress?.({ stage, status: 'queued' }));

    const timeoutId = window.setTimeout(async () => {
      if (cancelled) {
        resolveDone();
        return;
      }
      setSessions(prevSessions =>
        prevSessions.map(session =>
          session.id === sessionId
            ? { ...session, organizedNotesStatus: 'generating', tagsStatus: 'generating', updatedAt: new Date().toISOString() }
            : session
        )
      );
      const session = sessionsRef.current.find(item => item.id === sessionId);
      if (session) {
        await runAiPipeline(session, {
          onProgress,
          isCancelled: () => cancelled,
        });
      }
      resolveDone();
    }, autoGenerationConfig.debounceMs);

    importPipelineControllersRef.current[sessionId] = { timeoutId, cancel };

    return { cancel, done };
  }, [autoGenerationConfig.debounceMs, runAiPipeline]);

  const handleCreateSession = useCallback((title: string, topic: string) => {
    const now = new Date();
    const sessionId = createId('session');
    const newSession: StudySession = {
      id: sessionId,
      title: title || `Session - ${now.toLocaleDateString()}`,
      topic,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      assets: [],
      handouts: [],
      organizedNotes: null,
      organizedNotesStatus: 'generating',
      studyGuide: null,
      testQuestions: null,
      flashcards: null,
      tags: [],
      suggestedTags: [],
      tagsStatus: 'generating',
      chatHistory: [],
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(sessionId);
    return sessionId;
  }, []);

  const handleCreateAsset = useCallback((sessionId: string, sourceType: LectureAsset['sourceType'], language: string) => {
    const assetId = createId('asset');
    const createdAt = new Date().toISOString();
    const asset: LectureAsset = {
      id: assetId,
      sessionId,
      sourceType,
      transcriptText: '',
      transcriptPath: undefined,
      audioPath: undefined,
      language,
      createdAt,
      segments: [],
    };
    setSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? { ...session, assets: [asset, ...session.assets], updatedAt: createdAt }
          : session
      )
    );
    setActiveSessionId(sessionId);
    setActiveAssetId(assetId);
    return assetId;
  }, []);

  const handleTranscriptUpdate = useCallback((
    sessionId: string,
    assetId: string,
    segments: TranscriptSegment[],
    transcriptText: string,
    hasFinalUpdate: boolean,
    audioPath?: string
  ) => {
    setSessions(prev =>
      prev.map(session => {
        if (session.id !== sessionId) return session;
        const assets = session.assets.map(asset =>
          asset.id === assetId
            ? { ...asset, segments, transcriptText, audioPath: audioPath ?? asset.audioPath }
            : asset
        );
        return { ...session, assets, updatedAt: new Date().toISOString() };
      })
    );
    if (hasFinalUpdate) {
      const tracker = autoGenerationTrackerRef.current[sessionId] ?? { lastRunAt: 0, pendingFinals: 0 };
      tracker.pendingFinals += 1;
      const now = Date.now();
      const shouldRun = tracker.pendingFinals >= autoGenerationConfig.finalSegmentBatchSize ||
        now - tracker.lastRunAt >= autoGenerationConfig.minIntervalMs;
      if (shouldRun) {
        tracker.pendingFinals = 0;
        tracker.lastRunAt = now;
        autoGenerationTrackerRef.current[sessionId] = tracker;
        scheduleAutoGeneration(sessionId, autoGenerationConfig.debounceMs);
      } else {
        autoGenerationTrackerRef.current[sessionId] = tracker;
      }
    }
  }, [autoGenerationConfig.debounceMs, autoGenerationConfig.finalSegmentBatchSize, autoGenerationConfig.minIntervalMs, scheduleAutoGeneration]);
  
  const handleUpload = () => {
    setIsUploadModalOpen(true);
    if(isMobile) setIsSidebarOpen(false);
  };

  const handleCreateLectureFromFile = useCallback((data: { title: string; transcript: string; handouts: Handout[]; sessionId?: string; onProgress?: (progress: ImportPipelineProgress) => void }) => {
    const now = new Date();
    const sessionId = data.sessionId || handleCreateSession(data.title, '');
    const assetId = createId('asset');
    const createdAt = now.toISOString();
    const segments = normalizeImportedTranscript(data.transcript, assetId, createdAt);
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
    setSessions(prev => prev.map(session => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        assets: [asset, ...session.assets],
        handouts: [...session.handouts, ...data.handouts],
        updatedAt: createdAt,
      };
    }));
    setActiveSessionId(sessionId);
    setActiveAssetId(assetId);
    setCurrentView(AppView.Note);
    return queueImportPipeline(sessionId, data.onProgress);
  }, [handleCreateSession, queueImportPipeline]);
  
  const handleDeleteLecture = useCallback((idToDelete: string) => {
    if (window.confirm('Are you sure you want to permanently delete this session and all its data?')) {
        setSessions(currentSessions => {
            const newSessions = currentSessions.filter(l => l.id !== idToDelete);
            if (activeSessionId === idToDelete) {
                setActiveSessionId(null);
                setActiveAssetId(null);
                setCurrentView(AppView.Welcome);
            }
            return newSessions;
        });
    }
  }, [activeSessionId]);
  
  const handleSelectLecture = (id: string) => {
    setActiveSessionId(id);
    const session = sessions.find(item => item.id === id);
    setActiveAssetId(session?.assets[0]?.id ?? null);
    setCurrentView(AppView.Note);
    if(isMobile) setIsSidebarOpen(false);
  };

  const handleSaveApiConfig = useCallback(async (config: ApiConfig) => {
    await persistApiConfig(config);
    setApiConfig(config);
    setIsSettingsModalOpen(false);
  }, []);

  const handleClearApiConfig = useCallback(async () => {
    await clearStoredApiConfig();
    setApiConfig(null);
  }, []);

  const handleSaveSttConfig = useCallback(async (config: SttConfig) => {
    await persistSttConfig(config);
    setSttConfig(config);
  }, []);

  const handleClearSttConfig = useCallback(async () => {
    await clearStoredSttConfig();
    setSttConfig(null);
  }, []);

  const handleClearAllCredentials = useCallback(async () => {
    await clearAllCredentials();
    setApiConfig(null);
    setSttConfig(null);
    setCredentialFallbackEnabled(false);
  }, []);

  const handleToggleDiagnostics = useCallback((enabled: boolean) => {
    setDiagnosticsEnabled(enabled);
    persistDiagnosticsPreference(enabled);
  }, []);

  const handleToggleCredentialFallback = useCallback((enabled: boolean) => {
    setCredentialFallbackEnabled(enabled);
    setCredentialFallbackPreference(enabled);
  }, []);

  const handleSaveAutoGenerationConfig = useCallback((config) => {
    setAutoGenerationConfig(config);
    persistAutoGenerationConfig(config);
  }, []);

  const activeSession = sessions.find(l => l.id === activeSessionId);

  const renderMainContent = () => {
    switch(currentView) {
        case AppView.Live:
            return (
                <LiveNoteTaker
                    isSttReady={isSttKeyReady}
                    onOpenSettings={() => setIsSettingsModalOpen(true)}
                    sessions={sessions}
                    onCreateSession={handleCreateSession}
                    onCreateLiveAsset={handleCreateAsset}
                    onTranscriptUpdate={handleTranscriptUpdate}
                />
            );
        case AppView.Note:
            if (activeSession) {
                return <MainPanel theme={theme} session={activeSession} activeAssetId={activeAssetId} onSelectAsset={setActiveAssetId} updateSession={updateSession} isMobile={isMobile} onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} isApiKeyReady={isApiKeyReady} onOpenSettings={() => setIsSettingsModalOpen(true)} />;
            }
            setCurrentView(AppView.Welcome);
            return null;
        case AppView.Welcome:
        default:
            const WelcomeView = () => (
                 <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 text-center p-8">
                    <BrainIcon className="w-24 h-24 text-indigo-500 mb-6" />
                    <h2 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Welcome to IntelliNote</h2>
                    <p className="text-gray-600 dark:text-gray-400 max-w-xl">
                        Your AI-powered lecture assistant. Start a new live note or select a past lecture from the sidebar to begin.
                    </p>
                </div>
            );

            if (isMobile) {
                return (
                     <div className="flex-1 flex flex-col overflow-hidden">
                        <header className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center">
                            <button onClick={() => setIsSidebarOpen(true)} className="p-1 mr-4">
                                <MenuIcon className="w-6 h-6" />
                            </button>
                            <h1 className="text-lg font-bold">IntelliNote</h1>
                        </header>
                        <WelcomeView />
                    </div>
                )
            }
            return <WelcomeView />;
    }
  };

  return (
    <div className="relative flex h-screen font-sans bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden">
      {isMobile && isSidebarOpen && (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 z-20"
            onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div className={
        `
        transform transition-transform duration-300 ease-in-out
        ${isMobile ? 'fixed top-0 left-0 h-full z-30' : 'relative'}
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectLecture={handleSelectLecture}
            onNewLiveLecture={handleNewLiveLecture}
            onUpload={handleUpload}
            onDeleteLecture={handleDeleteLecture}
            isMobile={isMobile}
            onCloseRequest={() => setIsSidebarOpen(false)}
            onOpenSettings={() => setIsSettingsModalOpen(true)}
          />
      </div>
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderMainContent()}
      </main>
      {isUploadModalOpen && (
        <FileUploadModal
            onClose={() => setIsUploadModalOpen(false)}
            onCreateLecture={handleCreateLectureFromFile}
            sessions={sessions}
        />
      )}
      <SettingsModal 
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        apiConfig={apiConfig}
        onSaveApiConfig={handleSaveApiConfig}
        onClearApiConfig={handleClearApiConfig}
        onClearAllCredentials={handleClearAllCredentials}
        sttConfig={sttConfig}
        onSaveSttConfig={handleSaveSttConfig}
        onClearSttConfig={handleClearSttConfig}
        availableProviders={PROVIDERS}
        availableSttProviders={STT_PROVIDERS}
        isApiKeyReady={isApiKeyReady}
        theme={theme}
        onToggleTheme={toggleTheme}
        diagnosticsEnabled={diagnosticsEnabled}
        onToggleDiagnostics={handleToggleDiagnostics}
        credentialFallbackEnabled={credentialFallbackEnabled}
        onToggleCredentialFallback={handleToggleCredentialFallback}
        autoGenerationConfig={autoGenerationConfig}
        onSaveAutoGenerationConfig={handleSaveAutoGenerationConfig}
      />
      <ToastViewport />
      <DiagnosticsPanel isOpen={diagnosticsEnabled} onClose={() => handleToggleDiagnostics(false)} />
    </div>
  );
};

export default App;
