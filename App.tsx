import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import LiveNoteTaker from './components/LiveNoteTaker';
import FileUploadModal from './components/FileUploadModal';
import SettingsModal from './components/SettingsModal';
import { Lecture, AppView, Handout, TranscriptSegment, GenerationMode } from './types';
import { BrainIcon, MenuIcon } from './components/icons';
import { processTranscript, generateTags } from './services/geminiService';
import { App as CapacitorApp } from '@capacitor/app';
import mermaid from 'mermaid';

// Mock the aistudio object if it doesn't exist for local dev
if (typeof window.aistudio === 'undefined') {
  console.log("Mocking window.aistudio for development. Set MOCK_API_KEY to true to simulate a connected key.");
  const MOCK_API_KEY = false;
  (window as any).aistudio = {
    hasSelectedApiKey: async () => {
      return Promise.resolve(MOCK_API_KEY);
    },
    openSelectKey: async () => {
      console.log("window.aistudio.openSelectKey() called");
      if (!MOCK_API_KEY) {
        alert("This is a mock flow. In a real environment, you would select your API key. We'll now simulate a successful connection.");
      }
      return Promise.resolve();
    },
  };
}

const getInitialTheme = (): 'light' | 'dark' => {
  const storedTheme = localStorage.getItem('intellinote-theme');
  // Ensure the stored value is valid
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }
  // Otherwise, check for user's system preference as a better default
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  // Default to dark
  return 'dark';
};


const App: React.FC = () => {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [activeLectureId, setActiveLectureId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>(AppView.Welcome);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 768);
  
  const [isApiKeyReady, setIsApiKeyReady] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  useEffect(() => {
    const checkApiKey = async () => {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setIsApiKeyReady(hasKey);
    };
    checkApiKey();
  }, []);

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
    // Handle Android back button
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
        const storedLectures = localStorage.getItem('intellinote-lectures');
        if (storedLectures) {
            setLectures(JSON.parse(storedLectures));
        }
    } catch (e) {
        console.error("Failed to load lectures from localStorage", e);
    }
  }, []);

  useEffect(() => {
    try {
        localStorage.setItem('intellinote-lectures', JSON.stringify(lectures));
    } catch (e) {
        console.error("Failed to save lectures to localStorage", e);
    }
  }, [lectures]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('intellinote-theme', theme);
    // Re-initialize Mermaid with the current theme to ensure diagrams match
    mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'dark' ? 'light' : 'dark'));
  };

  const handleNewLiveLecture = () => {
    if (!isApiKeyReady) {
      setIsSettingsModalOpen(true);
      return;
    }
    setCurrentView(AppView.Live);
    setActiveLectureId(null);
    if(isMobile) setIsSidebarOpen(false);
  };

  const updateLecture = useCallback((id: string, updates: Partial<Lecture>) => {
    setLectures(prevLectures => prevLectures.map(lec => lec.id === id ? { ...lec, ...updates } : lec));
  }, []);

  const triggerAutoGeneration = useCallback(async (lecture: Lecture) => {
    // Generate Summary
    try {
        const summary = await processTranscript(lecture.transcript, GenerationMode.Summary, lecture.handouts, true);
        updateLecture(lecture.id, { summary, summaryStatus: 'success' });
    } catch (e) {
        console.error("Failed to auto-generate summary:", e);
        updateLecture(lecture.id, { summaryStatus: 'error' });
    }

    // Generate Organized Notes
    try {
        const notes = await processTranscript(lecture.transcript, GenerationMode.Notes, lecture.handouts, false);
        updateLecture(lecture.id, { organizedNotes: notes, canvasState: null, organizedNotesStatus: 'success' });
    } catch (e) {
        console.error("Failed to auto-generate notes:", e);
        updateLecture(lecture.id, { organizedNotesStatus: 'error' });
    }
    
    // Generate Tags
    try {
        const tags = await generateTags(lecture.transcript, lecture.handouts);
        updateLecture(lecture.id, { suggestedTags: tags, tagsStatus: 'success' });
    } catch (e) {
        console.error("Failed to auto-generate tags:", e);
        updateLecture(lecture.id, { tagsStatus: 'error' });
    }
  }, [updateLecture]);

  const handleTranscriptionComplete = useCallback((transcript: TranscriptSegment[]) => {
    const now = new Date();
    const newLecture: Lecture = {
      id: `lecture-${now.getTime()}`,
      title: `Live Lecture - ${now.toLocaleDateString()}`,
      date: now.toLocaleString(),
      transcript: transcript,
      handouts: [],
      summary: null,
      summaryStatus: 'generating',
      organizedNotes: null,
      organizedNotesStatus: 'generating',
      canvasState: null,
      studyGuide: null,
      testQuestions: null,
      flashcards: null,
      tags: [],
      suggestedTags: [],
      tagsStatus: 'generating',
      chatHistory: [],
    };

    setLectures(prev => [newLecture, ...prev]);
    setActiveLectureId(newLecture.id);
    setCurrentView(AppView.Note);
    triggerAutoGeneration(newLecture);
  }, [triggerAutoGeneration]);
  
  const handleUpload = () => {
    setIsUploadModalOpen(true);
    if(isMobile) setIsSidebarOpen(false);
  };

  const handleCreateLectureFromFile = useCallback((data: { title: string; transcript: string; handouts: Handout[] }) => {
    if (!isApiKeyReady) {
      setIsSettingsModalOpen(true);
      return;
    }
    const now = new Date();
    // Convert flat transcript string to TranscriptSegment array
    const transcriptSegments: TranscriptSegment[] = data.transcript.split('\n').map(text => ({ text, startTime: 0 }));
    
    const newLecture: Lecture = {
        id: `lecture-${now.getTime()}`,
        title: data.title || `Uploaded Lecture - ${now.toLocaleDateString()}`,
        date: now.toLocaleString(),
        transcript: transcriptSegments,
        handouts: data.handouts,
        summary: null,
        summaryStatus: 'generating',
        organizedNotes: null,
        organizedNotesStatus: 'generating',
        canvasState: null,
        studyGuide: null,
        testQuestions: null,
        flashcards: null,
        tags: [],
        suggestedTags: [],
        tagsStatus: 'generating',
        chatHistory: [],
    };
    setLectures(prev => [newLecture, ...prev]);
    setActiveLectureId(newLecture.id);
    setCurrentView(AppView.Note);
    setIsUploadModalOpen(false);
    triggerAutoGeneration(newLecture);
  }, [triggerAutoGeneration, isApiKeyReady]);
  
  const handleDeleteLecture = useCallback((idToDelete: string) => {
    if (window.confirm('Are you sure you want to permanently delete this lecture and all its data?')) {
        setLectures(currentLectures => {
            const newLectures = currentLectures.filter(l => l.id !== idToDelete);
            // If the deleted lecture was active, reset the view
            if (activeLectureId === idToDelete) {
                setActiveLectureId(null);
                setCurrentView(AppView.Welcome);
            }
            return newLectures;
        });
    }
  }, [activeLectureId]);
  
  const handleSelectLecture = (id: string) => {
    setActiveLectureId(id);
    setCurrentView(AppView.Note);
    if(isMobile) setIsSidebarOpen(false);
  };

  const handleSelectApiKey = async () => {
    await window.aistudio.openSelectKey();
    // Assume key selection is successful as per guidelines
    setIsApiKeyReady(true);
    setIsSettingsModalOpen(false);
  };

  const activeLecture = lectures.find(l => l.id === activeLectureId);

  const renderMainContent = () => {
    switch(currentView) {
        case AppView.Live:
            return <LiveNoteTaker onTranscriptionComplete={handleTranscriptionComplete} isApiKeyReady={isApiKeyReady} onOpenSettings={() => setIsSettingsModalOpen(true)} />;
        case AppView.Note:
            if (activeLecture) {
                return <MainPanel theme={theme} lecture={activeLecture} updateLecture={updateLecture} isMobile={isMobile} onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} isApiKeyReady={isApiKeyReady} onOpenSettings={() => setIsSettingsModalOpen(true)} />;
            }
            // Fallback to welcome if no active lecture somehow
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
      <div className={`
        transform transition-transform duration-300 ease-in-out
        ${isMobile ? 'fixed top-0 left-0 h-full z-30' : 'relative'}
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
          <Sidebar
            lectures={lectures}
            activeLectureId={activeLectureId}
            onSelectLecture={handleSelectLecture}
            onNewLiveLecture={handleNewLiveLecture}
            onUpload={handleUpload}
            onDeleteLecture={handleDeleteLecture}
            theme={theme}
            onToggleTheme={toggleTheme}
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
        />
      )}
      <SettingsModal 
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onSelectKey={handleSelectApiKey}
        isApiKeyReady={isApiKeyReady}
      />
    </div>
  );
};

export default App;