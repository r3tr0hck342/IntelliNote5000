import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { StudySession, GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, GroundingSource, AiEditMode } from '../types';
import { processTranscript, generateFlashcards, getChatResponseStream, editTranscriptWithAi } from '../services/aiService';
import { DownloadIcon, NoteIcon, ArrowLeftIcon, ArrowRightIcon, RefreshIcon, PaperclipIcon, TagIcon, XIcon, EditIcon, ChatBubbleIcon, SendIcon, UploadIcon, FileTextIcon, BrainIcon, SparklesIcon, LayersIcon, BookOpenIcon, QuestionMarkCircleIcon, MenuIcon, SearchIcon, ChevronUpIcon, ChevronDownIcon } from './icons';
import { parseFile } from '../utils/fileParser';
import ReactQuill from 'react-quill';
import TurndownService from 'turndown';
import { isTauri, nativeSave } from '../utils/native';
import { buildTranscriptText, normalizeImportedTranscript } from '../utils/transcript';

const FlashcardViewer: React.FC<{ cards: Flashcard[] }> = ({ cards }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [isFlipping, setIsFlipping] = useState(false);

    const card = cards[currentIndex];

    useEffect(() => {
        setIsFlipped(false);
    }, [currentIndex]);

    const handleFlip = () => {
        if (isFlipping) return;
        setIsFlipping(true);
        setIsFlipped(!isFlipped);
        setTimeout(() => setIsFlipping(false), 300); // duration of the fade
    };

    const handleNext = () => {
        if (currentIndex < cards.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-full p-4 md:p-8">
            <div className="w-full max-w-2xl aspect-[16/9] perspective-1000">
                <div 
                    className={`relative w-full h-full rounded-xl shadow-2xl flex items-center justify-center p-6 text-center bg-gray-200 dark:bg-gray-700 cursor-pointer transition-opacity duration-300 ${isFlipping ? 'opacity-0' : 'opacity-100'}`}
                    onClick={handleFlip}
                >
                    <p className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">
                        {isFlipped ? card.back : card.front}
                    </p>
                    <div className="absolute bottom-4 right-4 text-gray-500 dark:text-gray-400">
                        <RefreshIcon className="w-6 h-6" />
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-center w-full max-w-2xl mt-6">
                <button onClick={handlePrev} disabled={currentIndex === 0} className="p-3 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white disabled:opacity-50 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <span className="mx-6 text-lg font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                    {currentIndex + 1} / {cards.length}
                </span>
                <button onClick={handleNext} disabled={currentIndex === cards.length - 1} className="p-3 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white disabled:opacity-50 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                    <ArrowRightIcon className="w-6 h-6" />
                </button>
            </div>
        </div>
    );
};


interface MainPanelProps {
  session: StudySession;
  updateSession: (id: string, updates: Partial<StudySession>) => void;
  isMobile: boolean;
  onToggleSidebar: () => void;
  isApiKeyReady: boolean;
  onOpenSettings: () => void;
  theme: 'light' | 'dark';
  activeAssetId: string | null;
  onSelectAsset: (id: string | null) => void;
}

type ActiveTab = 'transcript' | 'notes' | 'guide' | 'questions' | 'flashcards' | 'handouts' | 'chat';

const TABS: { id: ActiveTab; label: string; icon: React.FC<{className?: string}> }[] = [
    { id: 'transcript', label: 'Transcript', icon: FileTextIcon },
    { id: 'handouts', label: 'Handouts', icon: PaperclipIcon },
    { id: 'notes', label: 'Notes', icon: NoteIcon },
    { id: 'chat', label: 'Chat', icon: ChatBubbleIcon },
    { id: 'guide', label: 'Study Guide', icon: BookOpenIcon },
    { id: 'questions', label: 'Test Questions', icon: QuestionMarkCircleIcon },
    { id: 'flashcards', label: 'Flashcards', icon: LayersIcon },
];

const ApiKeyBanner = ({ onOpenSettings }: { onOpenSettings: () => void; }) => (
    <div className="bg-yellow-100 dark:bg-yellow-900 border-b border-yellow-300 dark:border-yellow-700 p-3 text-center text-sm text-yellow-800 dark:text-yellow-200 flex-shrink-0">
        AI features are disabled. Please{' '}
        <button onClick={onOpenSettings} className="font-bold underline hover:text-yellow-900 dark:hover:text-yellow-100">
            configure your API key
        </button>
        {' '}to continue.
    </div>
);


const MainPanel: React.FC<MainPanelProps> = ({ session, updateSession, isMobile, onToggleSidebar, isApiKeyReady, onOpenSettings, theme, activeAssetId, onSelectAsset }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');
  const [isLoading, setIsLoading] = useState(false);
  const activeAsset = session.assets.find(asset => asset.id === activeAssetId) ?? session.assets[0] ?? null;
  const sessionTranscript = session.assets.flatMap(asset => asset.segments).filter(segment => segment.isFinal);
  
  // State for the notes editor with debouncing
  const [editorContent, setEditorContent] = useState(session.organizedNotes || '');
  const editorUpdateTimeoutRef = useRef<number | null>(null);

  // Transcript editing state
  const [editedTranscript, setEditedTranscript] = useState(activeAsset ? buildTranscriptText(activeAsset.segments, true) : '');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved');
  const saveTimeoutRef = useRef<number | null>(null);
  const transcriptTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const highlightsRef = useRef<HTMLDivElement>(null);
  const [isAiEditing, setIsAiEditing] = useState<AiEditMode | null>(null);
  const [aiEditError, setAiEditError] = useState<string | null>(null);
  const [topicsModalOpen, setTopicsModalOpen] = useState(false);
  const [identifiedTopics, setIdentifiedTopics] = useState('');
  const [customAiPrompt, setCustomAiPrompt] = useState('');
  
  // Transcript search state
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{start: number, end: number}[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);

  // Tagging state
  const [newTag, setNewTag] = useState('');
  const [editingTag, setEditingTag] = useState<{ index: number; value: string } | null>(null);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [useSearchGrounding, setUseSearchGrounding] = useState(false);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);

  // Handout Upload State
  const [isParsingHandouts, setIsParsingHandouts] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const handoutsFileInputRef = useRef<HTMLInputElement>(null);
  
  // Flashcard state
  const [flashcardCount, setFlashcardCount] = useState(10);
  
  // Inline editing state for session info
  const [editingField, setEditingField] = useState<'title' | null>(null);
  const [editValue, setEditValue] = useState('');
  
  // Advanced generation state
  const [useIntelligenceMode, setUseIntelligenceMode] = useState(false);

  useEffect(() => {
    // Reset to notes tab when session/asset changes
    setActiveTab('notes');
    setEditedTranscript(activeAsset ? buildTranscriptText(activeAsset.segments, true) : '');
    setSaveStatus('saved');
    setEditingField(null);
  }, [session.id, activeAsset]);
  
  // Update local editor state when the session's notes change from an outside source (e.g., AI generation)
  useEffect(() => {
      setEditorContent(session.organizedNotes || '');
  }, [session.organizedNotes]);

  // Debounced update from local editor state to the global session state
  useEffect(() => {
      if (editorContent !== session.organizedNotes) {
          if (editorUpdateTimeoutRef.current) {
              clearTimeout(editorUpdateTimeoutRef.current);
          }
          editorUpdateTimeoutRef.current = window.setTimeout(() => {
              updateSession(session.id, { organizedNotes: editorContent });
          }, 1500); // Debounce saves by 1.5 seconds
      }
      return () => {
          if (editorUpdateTimeoutRef.current) {
              clearTimeout(editorUpdateTimeoutRef.current);
          }
      };
  }, [editorContent, session.id, session.organizedNotes, updateSession]);

  // Transcript Auto-save logic
  useEffect(() => {
    if (saveStatus === 'unsaved' && activeAsset) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        setSaveStatus('saving');
        const createdAt = new Date().toISOString();
        const newSegments: TranscriptSegment[] = normalizeImportedTranscript(editedTranscript, activeAsset.id, createdAt);
        updateSession(session.id, {
          assets: session.assets.map(asset =>
            asset.id === activeAsset.id
              ? { ...asset, segments: newSegments, transcriptText: buildTranscriptText(newSegments) }
              : asset
          ),
        });
        setTimeout(() => setSaveStatus('saved'), 500); // Simulate save time
      }, 3000);
    }
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    }
  }, [editedTranscript, saveStatus, session.id, session.assets, updateSession, activeAsset]);
  
  const handleTranscriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditedTranscript(e.target.value);
    setSaveStatus('unsaved');
  };
  
  const formatTime = (seconds: number) => {
    const floorSeconds = Math.floor(seconds);
    const min = Math.floor(floorSeconds / 60);
    const sec = floorSeconds % 60;
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const currentContent = useMemo(() => {
    switch (activeTab) {
      case 'guide': return session.studyGuide;
      case 'questions': return session.testQuestions;
      default: return null;
    }
  }, [activeTab, session]);
  
  const handleGenerateTextContent = async () => {
    if (!isApiKeyReady) return;
    let mode: GenerationMode;
    let statusKey: 'organizedNotesStatus' | undefined;

    switch (activeTab) {
      case 'notes': mode = GenerationMode.Notes; statusKey = 'organizedNotesStatus'; break;
      case 'guide': mode = GenerationMode.StudyGuide; break;
      case 'questions': mode = GenerationMode.TestQuestions; break;
      default: return;
    }

    setIsLoading(true);
    if (statusKey) {
        updateSession(session.id, { [statusKey]: 'generating' });
    }

    const handleResult = (result: string) => {
      const updates: Partial<StudySession> = statusKey ? { [statusKey]: 'success' } : {};
      switch (activeTab) {
        case 'notes': updates.organizedNotes = result; break;
        case 'guide': updates.studyGuide = result; break;
        case 'questions': updates.testQuestions = result; break;
      }
      updateSession(session.id, updates);
    };

    try {
      const result = await processTranscript(sessionTranscript, mode, session.handouts, useIntelligenceMode, {
        onRetrySuccess: handleResult,
      });
      handleResult(result);
    } catch (e) {
      console.error("Error generating content:", e);
      if (statusKey) {
          updateSession(session.id, { [statusKey]: 'error' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateFlashcards = async () => {
      if (!isApiKeyReady) return;
      setIsLoading(true);
      try {
          const updateCards = (cards: Flashcard[]) => updateSession(session.id, { flashcards: cards });
          const cards = await generateFlashcards(sessionTranscript, session.handouts, flashcardCount, useIntelligenceMode, {
            onRetrySuccess: updateCards,
          });
          updateCards(cards);
      } catch (error) {
          console.error(error);
      } finally {
          setIsLoading(false);
      }
  };
  
    const canExport = useMemo(() => {
        if (isLoading) return false;
        switch (activeTab) {
            case 'guide':
            case 'questions':
                return !!currentContent;
            case 'transcript':
                return !!activeAsset && activeAsset.segments.length > 0;
            case 'flashcards':
                return !!session.flashcards && session.flashcards.length > 0;
            case 'notes':
                return !!session.organizedNotes;
             case 'handouts':
                return !!session.handouts && session.handouts.length > 0;
            default:
                return false;
        }
    }, [activeTab, isLoading, currentContent, activeAsset, session]);


  const handleExport = async () => {
    let content: string;
    let filenameSuffix: string;

    if (activeTab === 'flashcards') {
        if (!session.flashcards || session.flashcards.length === 0) return;
        content = session.flashcards.map(card => `Front:\n${card.front}\n\nBack:\n${card.back}`).join('\n\n---\n\n');
        filenameSuffix = 'Flashcards';
    } else if (activeTab === 'transcript') {
        if (!activeAsset) return;
        content = activeAsset.segments.map(s => `[${formatTime(s.startMs / 1000)}] ${s.text}`).join('\n');
        filenameSuffix = 'Transcript';
    } else if (activeTab === 'notes') {
        if (!session.organizedNotes) return;
        const turndownService = new TurndownService();
        content = turndownService.turndown(session.organizedNotes);
        filenameSuffix = 'Organized_Notes';
    } else if (activeTab === 'handouts') {
        if (!session.handouts || session.handouts.length === 0) return;
        content = session.handouts.map(h => `## Handout: ${h.name}\n\n${h.content}`).join('\n\n---\n\n');
        filenameSuffix = 'Handouts';
    } else {
        const textContent = currentContent;
        if (!textContent) return;
        content = textContent;
        switch (activeTab) {
            case 'guide': filenameSuffix = 'Study_Guide'; break;
            case 'questions': filenameSuffix = 'Test_Questions'; break;
            default: return;
        }
    }

    const sanitizedTitle = session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${sanitizedTitle}_${filenameSuffix}.md`;

    if (isTauri()) {
        const success = await nativeSave(content, filename);
        if (success) return; // If native save was successful or cancelled by user, we're done.
    }

    // Fallback to web download
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement("a");

    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTag = newTag.trim();
    if (trimmedTag && !session.tags.find(t => t.toLowerCase() === trimmedTag.toLowerCase())) {
        const updatedTags = [...session.tags, trimmedTag];
        updateSession(session.id, { tags: updatedTags });
        setNewTag('');
    }
  };

  const handleRemoveTag = (indexToRemove: number) => {
    const updatedTags = session.tags.filter((_, index) => index !== indexToRemove);
    updateSession(session.id, { tags: updatedTags });
  };
  
  const handleStartEditTag = (index: number, value: string) => {
    setEditingTag({ index, value });
  };

  const handleUpdateTag = () => {
    if (!editingTag) return;

    const newTagName = editingTag.value.trim();
    const index = editingTag.index;

    // Reset editing state first
    setEditingTag(null);
    
    // If tag is empty after trim, treat it as a removal
    if (!newTagName) {
        handleRemoveTag(index);
        return;
    }

    // If tag is unchanged, do nothing
    if (newTagName === session.tags[index]) {
        return;
    }
    
    // Check for duplicates (case-insensitive)
    if (session.tags.some((tag, i) => tag.toLowerCase() === newTagName.toLowerCase() && i !== index)) {
        console.warn("Attempted to add a duplicate tag.");
        // Optionally, show an error to the user here.
        return;
    }

    const updatedTags = [...session.tags];
    updatedTags[index] = newTagName;
    updateSession(session.id, { tags: updatedTags });
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading || !isApiKeyReady) return;

    const newHistory: ChatMessage[] = [...session.chatHistory, { role: 'user', content: chatInput }];
    updateSession(session.id, { chatHistory: newHistory });
    const messageToSend = chatInput;
    setChatInput('');

    try {
        const consumeStream = async (stream: AsyncGenerator<{ textDelta: string; sources?: GroundingSource[] }>) => {
            let currentResponse = '';
            let sources: GroundingSource[] = [];

            updateSession(session.id, { chatHistory: [...newHistory, {role: 'model', content: ''}] });

            for await (const chunk of stream) {
                currentResponse += chunk.textDelta;
                if (chunk.sources && chunk.sources.length > 0) {
                    chunk.sources.forEach(source => {
                        if (!sources.some(s => s.uri === source.uri)) {
                            sources.push(source);
                        }
                    });
                }

                updateSession(session.id, { chatHistory: [...newHistory, { role: 'model', content: currentResponse, sources: sources.length > 0 ? sources : undefined }] });
            }
        };

        const runChatStream = async (stream: AsyncGenerator<{ textDelta: string; sources?: GroundingSource[] }>) => {
            setIsChatLoading(true);
            await consumeStream(stream);
            setIsChatLoading(false);
        };

        const stream = await getChatResponseStream(session.chatHistory, messageToSend, sessionTranscript, session.handouts, useSearchGrounding, useIntelligenceMode, {
          onRetrySuccess: runChatStream,
        });
        await runChatStream(stream);
    } catch (error) {
        console.error("Chat error:", error);
        updateSession(session.id, { chatHistory: [...newHistory, { role: 'model', content: "Sorry, I encountered an error." }] });
    } finally {
        setIsChatLoading(false);
    }
  };

  const handleHandoutFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsParsingHandouts(true);
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
    
    const currentHandoutNames = new Set(session.handouts.map(h => h.name));
    const uniqueNewHandouts = newHandouts.filter(h => !currentHandoutNames.has(h.name));
    
    if (uniqueNewHandouts.length > 0) {
        updateSession(session.id, { handouts: [...session.handouts, ...uniqueNewHandouts] });
    }

    setIsParsingHandouts(false);
  }, [session.id, session.handouts, updateSession]);

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(isOver);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    handleDragEvents(e, false);
    handleHandoutFiles(e.dataTransfer.files);
  };

  const handleRemoveHandout = (indexToRemove: number) => {
    const updatedHandouts = session.handouts.filter((_, index) => index !== indexToRemove);
    updateSession(session.id, { handouts: updatedHandouts });
  };
  
    const handleStartEditing = (field: 'title', currentValue: string) => {
        setEditingField(field);
        setEditValue(currentValue);
    };

    const handleFinishEditing = () => {
        if (!editingField) return;
        
        const trimmedValue = editValue.trim();
        if (trimmedValue && editingField === 'title' && trimmedValue !== session.title) {
            updateSession(session.id, { title: trimmedValue });
        }
        
        setEditingField(null);
        setEditValue('');
    };

    const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleFinishEditing();
        } else if (e.key === 'Escape') {
            setEditingField(null);
            setEditValue('');
        }
    };

  const handleAiEdit = useCallback(async (mode: AiEditMode, prompt?: string) => {
    if (!isApiKeyReady) return;
    setIsAiEditing(mode);
    setAiEditError(null);
    let textToEdit = editedTranscript;

    if (mode === AiEditMode.Summarize) {
        const ta = transcriptTextAreaRef.current;
        if (ta && ta.selectionStart !== ta.selectionEnd) {
            textToEdit = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        } else {
            alert("Please select a portion of the transcript to summarize.");
            setIsAiEditing(null);
            return;
        }
    }

    const handleResult = (result: string) => {
        if (mode === AiEditMode.Topics) {
            setIdentifiedTopics(result);
            setTopicsModalOpen(true);
        } else if (mode === AiEditMode.Summarize) {
            const ta = transcriptTextAreaRef.current;
            if (ta) {
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const newText = `${ta.value.substring(0, start)}\n\n--- SUMMARY ---\n${result}\n--- END SUMMARY ---\n\n${ta.value.substring(end)}`;
                setEditedTranscript(newText);
            }
        } else {
            setEditedTranscript(result);
        }
        setSaveStatus('unsaved');
    };

    try {
        const result = await editTranscriptWithAi(textToEdit, mode, useIntelligenceMode, prompt, {
          onRetrySuccess: handleResult,
        });
        handleResult(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        setAiEditError(errorMessage);
    } finally {
        setIsAiEditing(null);
        setCustomAiPrompt('');
    }
  }, [editedTranscript, isApiKeyReady, useIntelligenceMode]);

    // Transcript Search Logic
    useEffect(() => {
        if (!searchQuery) {
            setSearchResults([]);
            setCurrentMatchIndex(-1);
            return;
        }
        const regex = new RegExp(searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
        const results = [];
        let match;
        while ((match = regex.exec(editedTranscript)) !== null) {
            results.push({ start: match.index, end: match.index + match[0].length });
        }
        setSearchResults(results);
        setCurrentMatchIndex(results.length > 0 ? 0 : -1);
    }, [searchQuery, editedTranscript]);
    
    // Scroll to current search match
    useEffect(() => {
        if (currentMatchIndex > -1 && searchResults[currentMatchIndex]) {
            const { start, end } = searchResults[currentMatchIndex];
            const textarea = transcriptTextAreaRef.current;
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(start, end);
                
                // Scroll into view logic
                const textBefore = textarea.value.substring(0, start);
                const lines = textBefore.split('\n').length;
                const avgLineHeight = textarea.scrollHeight / (textarea.value.split('\n').length || 1);
                const scrollTop = (lines - 1) * avgLineHeight;

                const visibleTop = textarea.scrollTop;
                const visibleBottom = textarea.scrollTop + textarea.clientHeight;
                
                if (scrollTop < visibleTop || scrollTop > visibleBottom - avgLineHeight) {
                    textarea.scrollTop = Math.max(0, scrollTop - textarea.clientHeight / 3);
                }
            }
        }
    }, [currentMatchIndex, searchResults]);

    const handleCloseSearch = () => {
        setIsSearchVisible(false);
        setSearchQuery('');
    };

    const handleNextMatch = () => {
        if (searchResults.length > 0) {
            setCurrentMatchIndex(prev => (prev + 1) % searchResults.length);
        }
    };
    
    const handlePrevMatch = () => {
        if (searchResults.length > 0) {
            setCurrentMatchIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
        }
    };
    
    const renderTranscriptHighlights = useCallback(() => {
        if (!searchQuery || searchResults.length === 0) {
            return editedTranscript;
        }
        const parts = [];
        let lastIndex = 0;
        searchResults.forEach((match, index) => {
            if (match.start > lastIndex) {
                parts.push(editedTranscript.substring(lastIndex, match.start));
            }
            const isCurrent = index === currentMatchIndex;
            const className = isCurrent ? 'bg-orange-400/50 rounded' : 'bg-yellow-400/50 rounded';
            parts.push(
                <span key={index} className={className}>
                    {editedTranscript.substring(match.start, match.end)}
                </span>
            );
            lastIndex = match.end;
        });
        if (lastIndex < editedTranscript.length) {
            parts.push(editedTranscript.substring(lastIndex));
        }
        return parts;
    }, [searchQuery, searchResults, editedTranscript, currentMatchIndex]);
    
    const handleTranscriptScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
        if (highlightsRef.current) {
            highlightsRef.current.scrollTop = e.currentTarget.scrollTop;
            highlightsRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }
    };


  useEffect(() => {
    if (activeTab === 'chat') {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session.chatHistory, activeTab]);

  const quillModules = {
    toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        [{ 'color': [] }, { 'background': [] }],
        ['link'],
        ['clean']
    ],
  };

  const renderContent = () => {
    const loadingState = (text: string) => (
      <div className="p-6 text-center text-gray-500 dark:text-gray-400 animate-pulse">{text}</div>
    );
    const errorState = (text: string, onRetry: () => void) => (
      <div className="p-6 text-center text-gray-600 dark:text-gray-500">
        <p className="mb-4 text-red-500 dark:text-red-400">{text}</p>
        <button onClick={onRetry} disabled={isLoading || !isApiKeyReady} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400">
          Try Again
        </button>
      </div>
    );
    
    if (activeTab === 'transcript') {
        const transcriptEditorClassName = "w-full h-full p-4 rounded-md resize-none font-mono text-sm leading-relaxed absolute inset-0";

        return (
            <div className="p-6 overflow-hidden h-full flex flex-col">
                {topicsModalOpen && (
                    <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg">
                            <h3 className="text-xl font-bold mb-4">Identified Key Topics</h3>
                            <div className="prose prose-sm dark:prose-invert max-w-none bg-gray-100 dark:bg-gray-900 p-4 rounded-md">{identifiedTopics}</div>
                            <div className="flex justify-end mt-6">
                                <button onClick={() => setTopicsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700">Close</button>
                            </div>
                        </div>
                    </div>
                )}
                <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-gray-100 dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Session Assets</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Select a live recording or imported transcript.</p>
                    </div>
                    <select
                        value={activeAsset?.id ?? ''}
                        onChange={(e) => onSelectAsset(e.target.value || null)}
                        className="border border-gray-300 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                    >
                        {session.assets.length === 0 && <option value="">No assets yet</option>}
                        {session.assets.map(asset => (
                            <option key={asset.id} value={asset.id}>
                                {asset.sourceType === 'live' ? 'Live' : 'Import'} • {new Date(asset.createdAt).toLocaleString()}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex justify-between items-center mb-4 flex-wrap gap-2 bg-gray-100 dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                     <div className="flex items-center space-x-2 flex-wrap gap-2">
                        <span className="text-sm font-medium text-indigo-500 dark:text-indigo-400 flex items-center"><SparklesIcon className="w-5 h-5 mr-2"/>AI Assistant:</span>
                        <button onClick={() => handleAiEdit(AiEditMode.Improve)} disabled={!!isAiEditing || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">{isAiEditing === 'improve' ? 'Improving...' : 'Improve Readability'}</button>
                        <button onClick={() => handleAiEdit(AiEditMode.Format)} disabled={!!isAiEditing || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">{isAiEditing === 'format' ? 'Formatting...' : 'Format as Notes'}</button>
                        <button onClick={() => handleAiEdit(AiEditMode.Topics)} disabled={!!isAiEditing || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">{isAiEditing === 'topics' ? 'Identifying...' : 'Identify Key Topics'}</button>
                        <button onClick={() => handleAiEdit(AiEditMode.Summarize)} disabled={!!isAiEditing || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50" title="Select text to enable">{isAiEditing === 'summarize' ? 'Summarizing...' : 'Summarize Selection'}</button>
                     </div>
                     <div className="flex items-center space-x-2">
                        <button onClick={() => setIsSearchVisible(prev => !prev)} className="p-1 rounded-full text-gray-500 hover:bg-gray-300 dark:hover:bg-gray-600" title="Search Transcript">
                            <SearchIcon className="w-5 h-5" />
                        </button>
                         <span className="text-xs font-mono text-gray-500 dark:text-gray-400 self-center">
                            {saveStatus === 'saved' && 'All changes saved'}
                            {saveStatus === 'unsaved' && 'Unsaved changes...'}
                            {saveStatus === 'saving' && 'Saving...'}
                        </span>
                     </div>
                </div>
                <div className="flex items-center space-x-2 mb-4">
                    <input
                        type="text"
                        value={customAiPrompt}
                        onChange={(e) => setCustomAiPrompt(e.target.value)}
                        placeholder="Or, type a custom edit instruction here..."
                        disabled={!!isAiEditing || !isApiKeyReady}
                        className="flex-1 p-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                    />
                     <button onClick={() => handleAiEdit(AiEditMode.Custom, customAiPrompt)} disabled={!!isAiEditing || !customAiPrompt.trim() || !isApiKeyReady} className="px-4 py-2 text-sm bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">{isAiEditing === 'custom' ? 'Applying...' : 'Apply'}</button>
                </div>

                {isSearchVisible && (
                    <div className="flex items-center space-x-2 p-2 mb-2 bg-gray-100 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <input 
                            type="text" 
                            placeholder="Search..." 
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            autoFocus
                            className="flex-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <span className="text-sm text-gray-500 dark:text-gray-400 w-24 text-center">
                            {searchResults.length > 0 ? `${currentMatchIndex + 1} of ${searchResults.length}` : '0 results'}
                        </span>
                        <button onClick={handlePrevMatch} disabled={searchResults.length === 0} className="p-1 rounded-md disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-700"><ChevronUpIcon className="w-5 h-5"/></button>
                        <button onClick={handleNextMatch} disabled={searchResults.length === 0} className="p-1 rounded-md disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-700"><ChevronDownIcon className="w-5 h-5"/></button>
                        <button onClick={handleCloseSearch} className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"><XIcon className="w-5 h-5"/></button>
                    </div>
                )}
                
                {aiEditError && <p className="text-red-500 dark:text-red-400 text-sm mb-2">Error: {aiEditError}</p>}

                 <div className="relative w-full flex-1 bg-white dark:bg-gray-900 rounded-md border border-gray-300 dark:border-gray-700 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                    <div
                        ref={highlightsRef}
                        className={`${transcriptEditorClassName} text-transparent pointer-events-none whitespace-pre-wrap break-words overflow-hidden`}
                    >
                        {renderTranscriptHighlights()}
                    </div>
                    <textarea
                        ref={transcriptTextAreaRef}
                        value={editedTranscript}
                        onChange={handleTranscriptChange}
                        onScroll={handleTranscriptScroll}
                        readOnly={!!isAiEditing || !activeAsset}
                        className={`${transcriptEditorClassName} bg-transparent text-gray-800 dark:text-gray-300 focus:ring-0 focus:border-transparent z-10 disabled:bg-gray-100 dark:disabled:bg-gray-800`}
                        placeholder={activeAsset ? "Transcript will appear here..." : "No transcript yet. Start a live lecture or import one."}
                    />
                 </div>
            </div>
        )
    }
      
    if (activeTab === 'notes') {
        if (session.organizedNotesStatus === 'generating') return loadingState('Generating Organized Notes...');
        if (session.organizedNotesStatus === 'error') return errorState('An error occurred while generating notes.', handleGenerateTextContent);
        
        if (session.organizedNotes !== null) {
            return (
                <div className="h-full bg-white dark:bg-gray-900">
                    <ReactQuill
                        theme="snow"
                        value={editorContent}
                        onChange={setEditorContent}
                        modules={quillModules}
                        className="h-full flex flex-col [&_.ql-toolbar]:bg-gray-100 [&_.ql-toolbar]:dark:bg-gray-800 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-gray-200 [&_.ql-toolbar]:dark:border-gray-700 [&_.ql-container]:border-none"
                    />
                </div>
            );
        }

        return (
             <div className="w-full h-full flex flex-col items-center justify-center text-center text-gray-600 dark:text-gray-500 p-4">
                <NoteIcon className="w-12 h-12 mb-4 text-gray-400 dark:text-gray-600" />
                <p className="mb-4">Generate organized notes from the transcript to start.</p>
                <button onClick={handleGenerateTextContent} disabled={isLoading || !isApiKeyReady} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">
                    {isLoading ? 'Generating...' : 'Generate Notes'}
                </button>
             </div>
        );
    }

    if (activeTab === 'flashcards') {
        if (isLoading) return loadingState('Generating Flashcards...');
        if (session.flashcards && session.flashcards.length > 0) {
            return <FlashcardViewer cards={session.flashcards} />;
        }
        return (
            <div className="p-6 text-center text-gray-600 dark:text-gray-500">
              <p className="mb-4">Generate a deck of flashcards from the key terms in the transcript.</p>
                <div className="flex items-center justify-center space-x-2 mb-4 max-w-xs mx-auto">
                    <label htmlFor="flashcard-count" className="text-sm text-gray-700 dark:text-gray-300">Number of flashcards:</label>
                    <input
                        id="flashcard-count"
                        type="number"
                        value={flashcardCount}
                        onChange={(e) => setFlashcardCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-20 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-1 text-center"
                        min="1"
                        max="50"
                    />
                </div>
              <button onClick={handleGenerateFlashcards} disabled={isLoading || !isApiKeyReady} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400">
                Generate Flashcards
              </button>
            </div>
        );
    }

    if (activeTab === 'handouts') {
        return (
            <div className="p-6 overflow-y-auto h-full flex flex-col">
                <input
                    type="file"
                    ref={handoutsFileInputRef}
                    onChange={(e) => handleHandoutFiles(e.target.files)}
                    multiple
                    className="hidden"
                    accept=".pdf,.docx,.txt,.md,.text"
                />
                <div
                    onDragEnter={(e) => handleDragEvents(e, true)}
                    onDragLeave={(e) => handleDragEvents(e, false)}
                    onDragOver={(e) => handleDragEvents(e, true)}
                    onDrop={handleDrop}
                    className={`mb-6 border-2 border-dashed rounded-md p-6 text-center transition-colors ${
                        dragOver ? 'border-indigo-500 bg-gray-100 dark:bg-gray-700' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                >
                    <UploadIcon className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-600 dark:text-gray-400">Drag & drop files here, or</p>
                    <button 
                        onClick={() => handoutsFileInputRef.current?.click()} 
                        className="cursor-pointer text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium bg-transparent border-none p-0"
                    >
                        browse to upload
                    </button>
                    <p className="text-xs text-gray-500 mt-2">Supported formats: PDF, DOCX, TXT, MD</p>
                </div>

                {isParsingHandouts && <p className="text-center text-gray-500 dark:text-gray-400 animate-pulse my-4">Parsing files...</p>}

                <div className="max-w-4xl mx-auto w-full">
                    {session.handouts.length === 0 && !isParsingHandouts ? (
                        <div className="text-center text-gray-500 py-10">
                            <PaperclipIcon className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-600" />
                            <h3 className="text-lg font-medium text-gray-800 dark:text-white">No Handouts Attached</h3>
                            <p>Upload documents using the area above to supplement your session notes.</p>
                        </div>
                    ) : (
                        session.handouts.map((handout, index) => (
                            <div key={index} className="bg-white dark:bg-gray-900 rounded-lg shadow-md mb-6 overflow-hidden">
                                <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate pr-4">{handout.name}</h3>
                                    <button onClick={() => handleRemoveHandout(index)} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white flex-shrink-0">
                                        <XIcon className="w-5 h-5" />
                                    </button>
                                </div>
                                <pre className="p-4 text-gray-700 dark:text-gray-300 whitespace-pre font-sans text-sm overflow-auto">{handout.content}</pre>
                            </div>
                        ))
                    )}
                </div>
            </div>
        )
    }

    if (activeTab === 'chat') {
        return (
            <div className="flex flex-col h-full">
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="max-w-4xl mx-auto space-y-4">
                        {session.chatHistory.length === 0 ? (
                             <div className="text-center text-gray-500">
                                 <ChatBubbleIcon className="w-12 h-12 mx-auto mb-4" />
                                 <p>Ask a question about the session to get started.</p>
                             </div>
                        ) : (
                            session.chatHistory.map((msg, index) => (
                                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-xl p-3 rounded-lg ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-200'}`}>
                                        <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br />') }} />
                                        {isChatLoading && msg.role === 'model' && index === session.chatHistory.length - 1 && <span className="animate-pulse">...</span>}
                                        {msg.sources && msg.sources.length > 0 && (
                                            <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600">
                                                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Sources:</h4>
                                                <ul className="text-xs space-y-1">
                                                    {msg.sources.map((source, i) => (
                                                        <li key={i} className="truncate">
                                                            <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-indigo-500 dark:text-indigo-400 hover:underline" title={source.title || source.uri}>
                                                                {i + 1}. {source.title || source.uri}
                                                            </a>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                        <div ref={chatMessagesEndRef} />
                    </div>
                </div>
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <form onSubmit={handleChatSubmit} className="max-w-4xl mx-auto">
                        <div className="flex items-center space-x-2">
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Ask a question about the session..."
                                disabled={isChatLoading || !isApiKeyReady}
                                className="flex-1 p-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                            />
                            <button type="submit" disabled={isChatLoading || !chatInput.trim() || !isApiKeyReady} className="p-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed">
                                <SendIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex items-center space-x-4 mt-2">
                            <div className="flex items-center space-x-2">
                                <input
                                    id="search-grounding-toggle"
                                    type="checkbox"
                                    checked={useSearchGrounding}
                                    onChange={(e) => setUseSearchGrounding(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-400 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-indigo-500"
                                    disabled={!isApiKeyReady}
                                />
                                <label htmlFor="search-grounding-toggle" className={`text-sm text-gray-600 dark:text-gray-400 ${!isApiKeyReady ? 'opacity-50' : ''}`}>
                                    Search web for up-to-date info
                                </label>
                            </div>
                            <div className="flex items-center space-x-2" title={!isApiKeyReady ? "Connect your API key in settings to enable" : "Uses more powerful AI for higher quality results"}>
                                <input
                                    id="chat-intelligence-mode-toggle"
                                    type="checkbox"
                                    checked={useIntelligenceMode}
                                    onChange={(e) => setUseIntelligenceMode(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-400 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                                    disabled={!isApiKeyReady}
                                />
                                <label htmlFor="chat-intelligence-mode-toggle" className={`text-sm text-gray-600 dark:text-gray-400 flex items-center ${!isApiKeyReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                                    <BrainIcon className="w-4 h-4 mr-1 text-indigo-500 dark:text-indigo-400" />
                                    Intelligence Mode
                                </label>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        )
    }

    if (isLoading) return loadingState('Generating...');
    
    if (!currentContent) {
      let placeholder = '';
      switch (activeTab) {
        case 'guide': placeholder = 'Generate a study guide from the transcript.'; break;
        case 'questions': placeholder = 'Generate potential test questions from the transcript.'; break;
      }
      return (
        <div className="p-6 text-center text-gray-600 dark:text-gray-500">
          <p className="mb-4">{placeholder}</p>
          <button 
            onClick={handleGenerateTextContent} 
            disabled={isLoading || !isApiKeyReady} 
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-900 focus:ring-indigo-500"
          >
            Generate
          </button>
        </div>
      );
    }

    return <div className="h-full prose dark:prose-invert p-6 prose-sm md:prose-base max-w-none whitespace-pre-wrap overflow-auto">{currentContent}</div>;
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-800 overflow-hidden">
        {!isApiKeyReady && <ApiKeyBanner onOpenSettings={onOpenSettings} />}
        <header className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-4 flex justify-between items-center">
            <div className="flex items-center min-w-0">
                {isMobile && (
                     <button onClick={onToggleSidebar} className="p-1 mr-4 -ml-2 text-gray-600 dark:text-gray-300">
                        <MenuIcon className="w-6 h-6" />
                    </button>
                )}
                <div className="flex flex-col min-w-0">
                    {editingField === 'title' ? (
                        <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleFinishEditing}
                            onKeyDown={handleEditKeyDown}
                            autoFocus
                            className="text-xl md:text-2xl font-bold bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-2 -mx-2"
                        />
                    ) : (
                        <h2 
                            className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md px-2 -mx-2 truncate"
                            onClick={() => handleStartEditing('title', session.title)}
                        >
                            {session.title}
                        </h2>
                    )}
                    <p className="text-sm text-gray-500 dark:text-gray-400 px-2 -mx-2 mt-1">
                        Created {new Date(session.createdAt).toLocaleString()} • Updated {new Date(session.updatedAt).toLocaleString()}
                    </p>
                </div>
            </div>
            <div className="flex items-center space-x-2 md:space-x-4 flex-shrink-0">
                 <div className="hidden md:flex items-center space-x-2" title={!isApiKeyReady ? "Connect your API key in settings to enable" : "Uses more powerful AI for higher quality results"}>
                    <input
                        id="intelligence-mode-toggle"
                        type="checkbox"
                        checked={useIntelligenceMode}
                        onChange={(e) => setUseIntelligenceMode(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                        disabled={!isApiKeyReady}
                    />
                    <label htmlFor="intelligence-mode-toggle" className={`text-sm text-gray-700 dark:text-gray-300 flex items-center ${!isApiKeyReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <BrainIcon className="w-5 h-5 mr-1 text-indigo-500 dark:text-indigo-400" />
                        Intelligence Mode
                    </label>
                </div>
                <button onClick={handleExport} disabled={!canExport} className="flex items-center px-3 py-2 text-sm font-medium text-gray-800 dark:text-white bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
                    <DownloadIcon className="w-5 h-5 md:mr-2" />
                    <span className="hidden md:inline">Export</span>
                </button>
            </div>
        </header>

         {/* Tags Section */}
         <div className="bg-white dark:bg-gray-900 p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-4xl mx-auto">
                {session.tagsStatus === 'generating' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse mb-2">Generating suggested tags...</p>
                )}
                {session.tagsStatus === 'success' && session.suggestedTags && session.suggestedTags.length > 0 && (
                    <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Suggested Tags</h4>
                        <div className="flex flex-wrap gap-2">
                            {session.suggestedTags.filter(st => !session.tags.find(t => t.toLowerCase() === st.toLowerCase())).map((tag, index) => (
                                <button 
                                    key={`${tag}-${index}`}
                                    onClick={() => {
                                        const updatedTags = [...session.tags, tag];
                                        updateSession(session.id, { tags: updatedTags });
                                    }}
                                    className="px-2 py-1 text-xs rounded-full bg-teal-600 text-white hover:bg-teal-500 transition-colors"
                                >
                                    + {tag}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">My Tags</h4>
                <div className="flex flex-wrap items-center gap-2">
                    {session.tags.map((tag, index) => (
                        <div key={index} className="flex items-center bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded-full pl-3 pr-1 py-1">
                            {editingTag?.index === index ? (
                                <input
                                    type="text"
                                    value={editingTag.value}
                                    onChange={(e) => setEditingTag({ ...editingTag, value: e.target.value })}
                                    onBlur={handleUpdateTag}
                                    onKeyDown={(e) => e.key === 'Enter' && handleUpdateTag()}
                                    autoFocus
                                    className="bg-transparent text-sm w-24 focus:outline-none"
                                />
                            ) : (
                                <>
                                    <span>{tag}</span>
                                    <button onClick={() => handleStartEditTag(index, tag)} className="ml-2 p-0.5 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600"><EditIcon className="w-3 h-3"/></button>
                                    <button onClick={() => handleRemoveTag(index)} className="ml-1 p-0.5 rounded-full hover:bg-red-500"><XIcon className="w-3 h-3"/></button>
                                </>
                            )}
                        </div>
                    ))}
                    <form onSubmit={handleAddTag} className="flex-shrink-0">
                        <input
                            type="text"
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            placeholder="+ Add tag"
                            className="bg-transparent text-sm w-24 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-full px-3 py-1"
                        />
                    </form>
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-hidden">
            <div className="h-full flex flex-col">
                <nav className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                    <div className="flex space-x-2 p-2 overflow-x-auto">
                        {TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                                activeTab === tab.id 
                                    ? 'bg-indigo-600 text-white shadow-md' 
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                                }`}
                                aria-current={activeTab === tab.id ? 'page' : undefined}
                            >
                                <tab.icon className="w-5 h-5 flex-shrink-0" />
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </nav>
                <div className="flex-1 overflow-auto h-full">
                    {renderContent()}
                </div>
            </div>
        </div>
    </div>
  );
};

export default MainPanel;
