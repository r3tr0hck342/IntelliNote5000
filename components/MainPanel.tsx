import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Lecture, GenerationMode, CanvasElement, Flashcard, Handout, TranscriptSegment, ChatMessage, GroundingSource, AiEditMode } from '../types';
import { processTranscript, generateDiagram, generateFlashcards, getChatResponseStream, editTranscriptWithAi } from '../services/geminiService';
import { DownloadIcon, NoteIcon, ChartBarIcon, ArrowLeftIcon, ArrowRightIcon, RefreshIcon, PaperclipIcon, TagIcon, XIcon, EditIcon, ChatBubbleIcon, SendIcon, UploadIcon, FileTextIcon, BrainIcon, SparklesIcon, LayersIcon, BookOpenIcon, QuestionMarkCircleIcon, MenuIcon } from './icons';
import Draggable from 'react-draggable';
import { ResizableBox } from 'react-resizable';
import mermaid from 'mermaid';
import { parseFile } from '../utils/fileParser';
import ReactQuill from 'react-quill';
import TurndownService from 'turndown';
import { isTauri, nativeSave } from '../utils/native';


const MermaidDiagram: React.FC<{ chart: string; id: string; onEdit: () => void; theme: 'light' | 'dark' }> = ({ chart, id, onEdit, theme }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (ref.current && chart) {
            const renderDiagram = async () => {
                try {
                    // The theme is set globally by mermaid.initialize in App.tsx.
                    // This useEffect is re-triggered by the theme prop changing, ensuring the diagram re-renders with the new theme.
                    const { svg } = await mermaid.render(`mermaid-${id}`, chart);
                    if(ref.current) {
                       ref.current.innerHTML = svg;
                    }
                } catch (e) {
                    console.error("Mermaid render error:", e);
                    if(ref.current) {
                        ref.current.innerHTML = `<p class="text-red-400 p-2">Error rendering diagram. The Mermaid syntax might be invalid.</p>`;
                    }
                }
            };
            renderDiagram();
        }
    }, [chart, id, theme]);

    return (
        <div className="relative w-full h-full bg-gray-200 dark:bg-gray-700">
            <div ref={ref} className="w-full h-full p-2 flex items-center justify-center" />
            <button onClick={onEdit} className="absolute top-1 right-1 p-1 rounded-full bg-gray-800 bg-opacity-50 hover:bg-opacity-80 text-gray-300 hover:text-white transition-opacity opacity-0 group-hover:opacity-100 no-drag z-10">
                <EditIcon className="w-4 h-4" />
            </button>
        </div>
    );
};


interface CanvasItemProps {
  element: CanvasElement;
  onUpdate: (id: string, updates: Partial<CanvasElement>) => void;
  onDelete: (id: string) => void;
  onEditDiagram: (element: CanvasElement) => void;
  theme: 'light' | 'dark';
}

const CanvasItem: React.FC<CanvasItemProps> = ({ element, onUpdate, onDelete, onEditDiagram, theme }) => {
    const nodeRef = useRef(null);
    const quillRef = useRef<ReactQuill>(null);

    const updateTimeoutRef = useRef<number | null>(null);

    const handleContentChange = (content: string) => {
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        updateTimeoutRef.current = window.setTimeout(() => {
            onUpdate(element.id, { content });
        }, 1000); // Debounce saves by 1 second
    };

    const quillModules = {
        toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'underline'],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'color': [] }, { 'background': [] }],
            ['clean']
        ],
    };
    
    const renderElement = () => {
        switch(element.type) {
            case 'note':
                 return (
                    <ReactQuill
                        ref={quillRef}
                        theme="snow"
                        defaultValue={element.content}
                        onChange={handleContentChange}
                        modules={quillModules}
                        className="w-full h-full flex flex-col [&_.ql-toolbar]:bg-gray-100 [&_.ql-toolbar]:dark:bg-gray-800 [&_.ql-container]:bg-white [&_.ql-container]:dark:bg-gray-900 [&_.ql-editor]:text-gray-900 [&_.ql-editor]:dark:text-gray-200"
                        // Fix: Cast style object to React.CSSProperties to allow custom properties.
                        style={{'--ql-snow-border': 'none'} as React.CSSProperties}
                    />
                 );
            case 'diagram':
                return <MermaidDiagram chart={element.content} id={element.id} onEdit={() => onEditDiagram(element)} theme={theme} />;
        }
    }

    return (
        <Draggable
            nodeRef={nodeRef}
            position={element.position}
            onStop={(_, data) => onUpdate(element.id, { position: { x: data.x, y: data.y } })}
            handle=".drag-handle"
            cancel=".ql-editor, .no-drag"
        >
            <ResizableBox
                width={typeof element.size.width === 'number' ? element.size.width : 400}
                height={typeof element.size.height === 'number' ? element.size.height : 300}
                onResizeStop={(_, data) => onUpdate(element.id, { size: data.size })}
                minConstraints={[200, 150]}
                className="absolute group shadow-lg rounded-md overflow-hidden flex flex-col bg-white dark:bg-gray-700"
            >
                <div ref={nodeRef} className="w-full h-full flex flex-col">
                    <div className="drag-handle h-6 w-full bg-black bg-opacity-20 cursor-move flex items-center justify-center relative">
                        <div className="w-8 h-1 bg-gray-500 rounded-full" />
                         <button onClick={() => onDelete(element.id)} className="absolute top-1/2 right-2 -translate-y-1/2 p-0.5 rounded-full bg-gray-800 bg-opacity-50 hover:bg-opacity-80 text-gray-300 hover:text-white transition-opacity opacity-0 group-hover:opacity-100" title="Delete">
                            <XIcon className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="flex-1 w-full h-full overflow-auto">
                      {renderElement()}
                    </div>
                </div>
            </ResizableBox>
        </Draggable>
    );
};

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
            setCurrentIndex(currentIndex + 1);
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
  lecture: Lecture;
  updateLecture: (id: string, updates: Partial<Lecture>) => void;
  isMobile: boolean;
  onToggleSidebar: () => void;
  isApiKeyReady: boolean;
  onOpenSettings: () => void;
  theme: 'light' | 'dark';
}

type ActiveTab = 'transcript' | 'summary' | 'notes' | 'guide' | 'questions' | 'flashcards' | 'handouts' | 'chat';

const TABS: { id: ActiveTab; label: string; icon: React.FC<{className?: string}> }[] = [
    { id: 'transcript', label: 'Transcript', icon: FileTextIcon },
    { id: 'handouts', label: 'Handouts', icon: PaperclipIcon },
    { id: 'notes', label: 'Notes', icon: NoteIcon },
    { id: 'chat', label: 'Chat', icon: ChatBubbleIcon },
    { id: 'summary', label: 'Summary', icon: FileTextIcon },
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


const MainPanel: React.FC<MainPanelProps> = ({ lecture, updateLecture, isMobile, onToggleSidebar, isApiKeyReady, onOpenSettings, theme }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('summary');
  const [isLoading, setIsLoading] = useState(false);
  
  // Diagram Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [diagramPrompt, setDiagramPrompt] = useState('');
  const [diagramType, setDiagramType] = useState('flowchart');
  const [advancedConfig, setAdvancedConfig] = useState('');
  const [editingDiagram, setEditingDiagram] = useState<CanvasElement | null>(null);
  const [isDiagramLoading, setIsDiagramLoading] = useState(false);

  // Transcript editing state
  const [editedTranscript, setEditedTranscript] = useState(lecture.transcript.map(t => t.text).join('\n'));
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved');
  const saveTimeoutRef = useRef<number | null>(null);
  const transcriptTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const [isAiEditing, setIsAiEditing] = useState<AiEditMode | null>(null);
  const [aiEditError, setAiEditError] = useState<string | null>(null);
  const [topicsModalOpen, setTopicsModalOpen] = useState(false);
  const [identifiedTopics, setIdentifiedTopics] = useState('');
  const [customAiPrompt, setCustomAiPrompt] = useState('');


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
  
  // Inline editing state for lecture info
  const [editingField, setEditingField] = useState<'title' | 'date' | null>(null);
  const [editValue, setEditValue] = useState('');
  
  // Advanced generation state
  const [useThinkingMode, setUseThinkingMode] = useState(false);

  useEffect(() => {
    // Reset to summary tab when lecture changes
    setActiveTab('summary');
    setEditedTranscript(lecture.transcript.map(t => t.text).join('\n'));
    setSaveStatus('saved');
    // Reset editing state on lecture change
    setEditingField(null);
  }, [lecture.id, lecture.transcript]);

  useEffect(() => {
    if (activeTab === 'notes' && lecture.organizedNotes && !lecture.canvasState) {
        const initialElements: CanvasElement[] = [{
            id: `note-${Date.now()}`,
            type: 'note',
            content: lecture.organizedNotes,
            position: { x: 20, y: 20 },
            size: { width: 600, height: 450 },
        }];
        updateLecture(lecture.id, { canvasState: initialElements });
    }
  }, [activeTab, lecture, updateLecture]);

  // Transcript Auto-save logic
  useEffect(() => {
    if (saveStatus === 'unsaved') {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        setSaveStatus('saving');
        // Convert back to TranscriptSegment[] for storage
        const newSegments: TranscriptSegment[] = editedTranscript.split('\n').map((text, index) => ({
            text,
            // Preserve original timestamps if possible, otherwise use a placeholder
            startTime: lecture.transcript[index]?.startTime ?? 0
        }));
        updateLecture(lecture.id, { transcript: newSegments });
        setTimeout(() => setSaveStatus('saved'), 500); // Simulate save time
      }, 3000);
    }
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    }
  }, [editedTranscript, saveStatus, lecture.id, lecture.transcript, updateLecture]);
  
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

  const handleElementUpdate = (id: string, updates: Partial<CanvasElement>) => {
    const newCanvasState = lecture.canvasState?.map(el => el.id === id ? { ...el, ...updates } : el);
    if (newCanvasState) {
        updateLecture(lecture.id, { canvasState: newCanvasState });
    }
  };
  
  const handleDeleteElement = (id: string) => {
    const newCanvasState = lecture.canvasState?.filter(el => el.id !== id);
    if (newCanvasState) {
        updateLecture(lecture.id, { canvasState: newCanvasState });
    }
  };

  const addCanvasElement = (element: Omit<CanvasElement, 'id'>) => {
    const newElement: CanvasElement = { ...element, id: `${element.type}-${Date.now()}`};
    const newCanvasState = [...(lecture.canvasState || []), newElement];
    updateLecture(lecture.id, { canvasState: newCanvasState });
  };
  
  const handleOpenModalForEdit = (element: CanvasElement) => {
    setEditingDiagram(element);
    setDiagramPrompt(element.prompt || '');
    setDiagramType(element.diagramType || 'flowchart');
    setAdvancedConfig(element.advancedConfig || '');
    setIsModalOpen(true);
  };

  const handleAddNote = () => {
    addCanvasElement({
        type: 'note',
        content: '<p>New Note</p>',
        position: { x: 40, y: 40 },
        size: { width: 400, height: 300 },
    });
  };

  const handleGenerateDiagram = async () => {
    if (!diagramPrompt.trim() || !isApiKeyReady) return;
    setIsDiagramLoading(true);
    try {
        const mermaidSyntax = await generateDiagram(diagramPrompt, diagramType, advancedConfig, lecture.transcript, lecture.handouts, useThinkingMode);
        const diagramData: Partial<CanvasElement> = {
            content: mermaidSyntax,
            prompt: diagramPrompt,
            diagramType,
            advancedConfig,
        };

        if(editingDiagram) {
            handleElementUpdate(editingDiagram.id, diagramData);
        } else {
             addCanvasElement({
                type: 'diagram',
                position: { x: 60, y: 60 },
                size: { width: 400, height: 300 },
                ...diagramData
            } as Omit<CanvasElement, 'id'>);
        }

        setIsModalOpen(false);
        setEditingDiagram(null);
        setDiagramPrompt('');
        setDiagramType('flowchart');
        setAdvancedConfig('');
    } finally {
        setIsDiagramLoading(false);
    }
  };


  const currentContent = useMemo(() => {
    switch (activeTab) {
      case 'summary': return lecture.summary;
      case 'guide': return lecture.studyGuide;
      case 'questions': return lecture.testQuestions;
      default: return null;
    }
  }, [activeTab, lecture]);
  
  const handleGenerateTextContent = async () => {
    if (!isApiKeyReady) return;
    let mode: GenerationMode;
    let statusKey: 'summaryStatus' | 'organizedNotesStatus' | undefined;

    switch (activeTab) {
      case 'summary': mode = GenerationMode.Summary; statusKey = 'summaryStatus'; break;
      case 'notes': mode = GenerationMode.Notes; statusKey = 'organizedNotesStatus'; break;
      case 'guide': mode = GenerationMode.StudyGuide; break;
      case 'questions': mode = GenerationMode.TestQuestions; break;
      default: return;
    }

    setIsLoading(true);
    if (statusKey) {
        updateLecture(lecture.id, { [statusKey]: 'generating' });
    }

    try {
      const shouldProcessWithAdvancedMode = (activeTab === 'summary') || useThinkingMode;
      const result = await processTranscript(lecture.transcript, mode, lecture.handouts, shouldProcessWithAdvancedMode);
      
      const updates: Partial<Lecture> = statusKey ? { [statusKey]: 'success' } : {};
      switch (activeTab) {
        case 'summary': updates.summary = result; break;
        case 'notes': updates.organizedNotes = result; updates.canvasState = null; break;
        case 'guide': updates.studyGuide = result; break;
        case 'questions': updates.testQuestions = result; break;
      }
      updateLecture(lecture.id, updates);
    } catch (e) {
      console.error("Error generating content:", e);
      if (statusKey) {
          updateLecture(lecture.id, { [statusKey]: 'error' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateFlashcards = async () => {
      if (!isApiKeyReady) return;
      setIsLoading(true);
      try {
          const cards = await generateFlashcards(lecture.transcript, lecture.handouts, flashcardCount, useThinkingMode);
          updateLecture(lecture.id, { flashcards: cards });
      } catch (error) {
          console.error(error);
          alert("Sorry, an error occurred while generating flashcards. Please try again.");
      } finally {
          setIsLoading(false);
      }
  };
  
    const canExport = useMemo(() => {
        if (isLoading) return false;
        switch (activeTab) {
            case 'summary':
            case 'guide':
            case 'questions':
                return !!currentContent;
            case 'transcript':
                return lecture.transcript.length > 0;
            case 'flashcards':
                return !!lecture.flashcards && lecture.flashcards.length > 0;
            case 'notes':
                return !!lecture.canvasState && lecture.canvasState.length > 0;
             case 'handouts':
                return !!lecture.handouts && lecture.handouts.length > 0;
            default:
                return false;
        }
    }, [activeTab, isLoading, currentContent, lecture]);


  const handleExport = async () => {
    let content: string;
    let filenameSuffix: string;

    if (activeTab === 'flashcards') {
        if (!lecture.flashcards || lecture.flashcards.length === 0) return;
        content = lecture.flashcards.map(card => `Front:\n${card.front}\n\nBack:\n${card.back}`).join('\n\n---\n\n');
        filenameSuffix = 'Flashcards';
    } else if (activeTab === 'transcript') {
        content = lecture.transcript.map(s => `[${formatTime(s.startTime)}] ${s.text}`).join('\n');
        filenameSuffix = 'Transcript';
    } else if (activeTab === 'notes') {
        if (!lecture.canvasState || lecture.canvasState.length === 0) return;
        const turndownService = new TurndownService();
        content = lecture.canvasState.map(el => {
            switch (el.type) {
                case 'note':
                    return `## Note\n\n${turndownService.turndown(el.content)}\n\n---\n\n`;
                case 'diagram':
                    return `## Diagram: ${el.prompt || 'Untitled'}\n\n\`\`\`mermaid\n${el.content}\n\`\`\`\n\n---\n\n`;
                default:
                    return '';
            }
        }).join('');
        filenameSuffix = 'Organized_Notes';
    } else if (activeTab === 'handouts') {
        if (!lecture.handouts || lecture.handouts.length === 0) return;
        content = lecture.handouts.map(h => `## Handout: ${h.name}\n\n${h.content}`).join('\n\n---\n\n');
        filenameSuffix = 'Handouts';
    } else {
        const textContent = currentContent;
        if (!textContent) return;
        content = textContent;
        switch (activeTab) {
            case 'summary': filenameSuffix = 'Summary'; break;
            case 'guide': filenameSuffix = 'Study_Guide'; break;
            case 'questions': filenameSuffix = 'Test_Questions'; break;
            default: return;
        }
    }

    const sanitizedTitle = lecture.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
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
    if (trimmedTag && !lecture.tags.find(t => t.toLowerCase() === trimmedTag.toLowerCase())) {
        const updatedTags = [...lecture.tags, trimmedTag];
        updateLecture(lecture.id, { tags: updatedTags });
        setNewTag('');
    }
  };

  const handleRemoveTag = (indexToRemove: number) => {
    const updatedTags = lecture.tags.filter((_, index) => index !== indexToRemove);
    updateLecture(lecture.id, { tags: updatedTags });
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
    if (newTagName === lecture.tags[index]) {
        return;
    }
    
    // Check for duplicates (case-insensitive)
    if (lecture.tags.some((tag, i) => tag.toLowerCase() === newTagName.toLowerCase() && i !== index)) {
        console.warn("Attempted to add a duplicate tag.");
        // Optionally, show an error to the user here.
        return;
    }

    const updatedTags = [...lecture.tags];
    updatedTags[index] = newTagName;
    updateLecture(lecture.id, { tags: updatedTags });
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading || !isApiKeyReady) return;

    const newHistory: ChatMessage[] = [...lecture.chatHistory, { role: 'user', content: chatInput }];
    updateLecture(lecture.id, { chatHistory: newHistory });
    const messageToSend = chatInput;
    setChatInput('');
    setIsChatLoading(true);

    try {
        const stream = await getChatResponseStream(lecture.chatHistory, messageToSend, lecture.transcript, lecture.handouts, useSearchGrounding, useThinkingMode);
        let currentResponse = '';
        let sources: GroundingSource[] = [];

        updateLecture(lecture.id, { chatHistory: [...newHistory, {role: 'model', content: ''}] });

        for await (const chunk of stream) {
            currentResponse += chunk.text;
             const newSources = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks
                ?.map(c => c.web && { uri: c.web.uri, title: c.web.title })
                .filter((s): s is GroundingSource => !!s?.uri) ?? [];
            
            if (newSources.length > 0) {
                 newSources.forEach(source => {
                    if (!sources.some(s => s.uri === source.uri)) {
                        sources.push(source);
                    }
                });
            }

            updateLecture(lecture.id, { chatHistory: [...newHistory, { role: 'model', content: currentResponse, sources: sources.length > 0 ? sources : undefined }] });
        }
    } catch (error) {
        console.error("Chat error:", error);
        updateLecture(lecture.id, { chatHistory: [...newHistory, { role: 'model', content: "Sorry, I encountered an error." }] });
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
    
    const currentHandoutNames = new Set(lecture.handouts.map(h => h.name));
    const uniqueNewHandouts = newHandouts.filter(h => !currentHandoutNames.has(h.name));
    
    if (uniqueNewHandouts.length > 0) {
        updateLecture(lecture.id, { handouts: [...lecture.handouts, ...uniqueNewHandouts] });
    }

    setIsParsingHandouts(false);
  }, [lecture.id, lecture.handouts, updateLecture]);

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
    const updatedHandouts = lecture.handouts.filter((_, index) => index !== indexToRemove);
    updateLecture(lecture.id, { handouts: updatedHandouts });
  };
  
    const handleStartEditing = (field: 'title' | 'date', currentValue: string) => {
        setEditingField(field);
        setEditValue(currentValue);
    };

    const handleFinishEditing = () => {
        if (!editingField) return;
        
        const trimmedValue = editValue.trim();
        if (trimmedValue) {
            if (editingField === 'title' && trimmedValue !== lecture.title) {
                updateLecture(lecture.id, { title: trimmedValue });
            } else if (editingField === 'date' && trimmedValue !== lecture.date) {
                updateLecture(lecture.id, { date: trimmedValue });
            }
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

    try {
        const result = await editTranscriptWithAi(textToEdit, mode, prompt);
        
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
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        setAiEditError(errorMessage);
    } finally {
        setIsAiEditing(null);
        setCustomAiPrompt('');
    }
  }, [editedTranscript, isApiKeyReady]);


  useEffect(() => {
    if (activeTab === 'chat') {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lecture.chatHistory, activeTab]);


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
        const isSummarizeDisabled = () => {
            const ta = transcriptTextAreaRef.current;
            return !ta || ta.selectionStart === ta.selectionEnd;
        };

        return (
            <div className="p-6 overflow-y-auto h-full flex flex-col">
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
                <div className="flex justify-between items-center mb-4 flex-wrap gap-2 bg-gray-100 dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                     <div className="flex items-center space-x-2 flex-wrap gap-2">
                        <span className="text-sm font-medium text-indigo-500 dark:text-indigo-400 flex items-center"><SparklesIcon className="w-5 h-5 mr-2"/>AI Assistant:</span>
                        <button onClick={() => handleAiEdit(AiEditMode.Improve)} disabled={!!isAiEditing || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">{isAiEditing === 'improve' ? 'Improving...' : 'Improve Readability'}</button>
                        <button onClick={() => handleAiEdit(AiEditMode.Format)} disabled={!!isAiEditing || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">{isAiEditing === 'format' ? 'Formatting...' : 'Format as Notes'}</button>
                        <button onClick={() => handleAiEdit(AiEditMode.Topics)} disabled={!!isAiEditing || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">{isAiEditing === 'topics' ? 'Identifying...' : 'Identify Key Topics'}</button>
                        <button onClick={() => handleAiEdit(AiEditMode.Summarize)} disabled={!!isAiEditing || isSummarizeDisabled() || !isApiKeyReady} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50" title="Select text to enable">{isAiEditing === 'summarize' ? 'Summarizing...' : 'Summarize Selection'}</button>
                     </div>
                     <span className="text-xs font-mono text-gray-500 dark:text-gray-400 self-center">
                        {saveStatus === 'saved' && 'All changes saved'}
                        {saveStatus === 'unsaved' && 'Unsaved changes...'}
                        {saveStatus === 'saving' && 'Saving...'}
                    </span>
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
                {aiEditError && <p className="text-red-500 dark:text-red-400 text-sm mb-2">Error: {aiEditError}</p>}

                 <textarea
                    ref={transcriptTextAreaRef}
                    value={editedTranscript}
                    onChange={handleTranscriptChange}
                    readOnly={!!isAiEditing}
                    className="w-full flex-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-300 p-4 rounded-md border border-gray-300 dark:border-gray-700 focus:ring-indigo-500 focus:border-indigo-500 resize-none font-mono text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
                    placeholder="Transcript will appear here..."
                />
            </div>
        )
    }
      
    if (activeTab === 'notes') {
        if (lecture.organizedNotesStatus === 'generating') return loadingState('Generating Organized Notes...');
        if (lecture.organizedNotesStatus === 'error') return errorState('An error occurred while generating notes.', handleGenerateTextContent);
        
        return (
            <div className="relative w-full h-full bg-gray-100 dark:bg-gray-900 overflow-auto">
                 <div className="absolute top-4 left-4 z-10 flex space-x-2">
                    <button onClick={handleAddNote} className="flex items-center px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 shadow-lg">
                        <NoteIcon className="w-5 h-5 mr-2" /> Add Note
                    </button>
                    <button onClick={() => { setEditingDiagram(null); setDiagramPrompt(''); setDiagramType('flowchart'); setAdvancedConfig(''); setIsModalOpen(true); }} disabled={!isApiKeyReady} className="flex items-center px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 shadow-lg disabled:opacity-50">
                        <ChartBarIcon className="w-5 h-5 mr-2" /> Add Diagram
                    </button>
                </div>
                {(!lecture.organizedNotes && !isLoading) && (
                     <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 dark:text-gray-500">
                        <p className="mb-4">Generate organized notes from the transcript to start building your canvas.</p>
                        <button onClick={handleGenerateTextContent} disabled={!isApiKeyReady} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">Generate Notes</button>
                     </div>
                )}
                {lecture.canvasState?.map(el => <CanvasItem key={el.id} element={el} onUpdate={handleElementUpdate} onDelete={handleDeleteElement} onEditDiagram={handleOpenModalForEdit} theme={theme} />)}
            </div>
        );
    }

    if (activeTab === 'flashcards') {
        if (isLoading) return loadingState('Generating Flashcards...');
        if (lecture.flashcards && lecture.flashcards.length > 0) {
            return <FlashcardViewer cards={lecture.flashcards} />;
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
                    {lecture.handouts.length === 0 && !isParsingHandouts ? (
                        <div className="text-center text-gray-500 py-10">
                            <PaperclipIcon className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-600" />
                            <h3 className="text-lg font-medium text-gray-800 dark:text-white">No Handouts Attached</h3>
                            <p>Upload documents using the area above to supplement your lecture notes.</p>
                        </div>
                    ) : (
                        lecture.handouts.map((handout, index) => (
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
                        {lecture.chatHistory.length === 0 ? (
                             <div className="text-center text-gray-500">
                                 <ChatBubbleIcon className="w-12 h-12 mx-auto mb-4" />
                                 <p>Ask a question about the lecture to get started.</p>
                             </div>
                        ) : (
                            lecture.chatHistory.map((msg, index) => (
                                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-xl p-3 rounded-lg ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-200'}`}>
                                        <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br />') }} />
                                        {isChatLoading && msg.role === 'model' && index === lecture.chatHistory.length - 1 && <span className="animate-pulse">...</span>}
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
                                placeholder="Ask a question about the lecture..."
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
                            <div className="flex items-center space-x-2">
                                <input
                                    id="chat-thinking-mode-toggle"
                                    type="checkbox"
                                    checked={useThinkingMode}
                                    onChange={(e) => setUseThinkingMode(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-400 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-indigo-500"
                                    disabled={!isApiKeyReady}
                                />
                                <label htmlFor="chat-thinking-mode-toggle" className={`text-sm text-gray-600 dark:text-gray-400 flex items-center ${!isApiKeyReady ? 'opacity-50' : ''}`}>
                                    <BrainIcon className="w-4 h-4 mr-1 text-indigo-500 dark:text-indigo-400" />
                                    Advanced Mode
                                </label>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        )
    }

    if (activeTab === 'summary' && lecture.summaryStatus === 'generating') return loadingState('Generating Summary...');
    if (activeTab === 'summary' && lecture.summaryStatus === 'error') return errorState('An error occurred while generating the summary.', handleGenerateTextContent);
    
    if (isLoading) return loadingState('Generating...');
    
    if (!currentContent) {
      let placeholder = '';
      let isAdvancedByDefault = false;
      switch (activeTab) {
        case 'summary': 
            placeholder = 'Generate a detailed, high-quality summary of the transcript using Advanced Mode.'; 
            isAdvancedByDefault = true;
            break;
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
            {isAdvancedByDefault && <BrainIcon className="w-5 h-5 mr-2" />}
            {isAdvancedByDefault ? 'Generate Detailed Summary' : 'Generate'}
          </button>
        </div>
      );
    }

    return <div className="h-full prose dark:prose-invert p-6 prose-sm md:prose-base max-w-none whitespace-pre-wrap overflow-auto">{currentContent}</div>;
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-800 overflow-hidden">
        {!isApiKeyReady && <ApiKeyBanner onOpenSettings={onOpenSettings} />}
        {isModalOpen && (
            <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg">
                    <div className="flex justify-between items-center mb-4">
                         <h3 className="text-xl font-bold">{editingDiagram ? 'Edit Diagram' : 'Generate Diagram'}</h3>
                         <button onClick={() => setIsModalOpen(false)} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                            <XIcon className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="diagram-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
                            <textarea
                                id="diagram-prompt"
                                value={diagramPrompt}
                                onChange={(e) => setDiagramPrompt(e.target.value)}
                                rows={3}
                                placeholder="e.g., A flowchart of the scientific method"
                                className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        <div>
                             <label htmlFor="diagram-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Diagram Type</label>
                            <select
                                id="diagram-type"
                                value={diagramType}
                                onChange={(e) => setDiagramType(e.target.value)}
                                className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="flowchart">Flowchart</option>
                                <option value="sequenceDiagram">Sequence Diagram</option>
                                <option value="gantt">Gantt Chart</option>
                                <option value="pie">Pie Chart</option>
                                <option value="classDiagram">Class Diagram</option>
                            </select>
                        </div>
                         <div>
                            <label htmlFor="advanced-config" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Advanced (Optional)</label>
                            <input
                                id="advanced-config"
                                type="text"
                                value={advancedConfig}
                                onChange={(e) => setAdvancedConfig(e.target.value)}
                                placeholder="e.g., theme base, font size..."
                                className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end space-x-3 mt-6">
                        <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600">Cancel</button>
                        <button onClick={handleGenerateDiagram} disabled={isDiagramLoading || !diagramPrompt.trim() || !isApiKeyReady} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400">
                            {isDiagramLoading ? 'Generating...' : (editingDiagram ? 'Update Diagram' : 'Generate')}
                        </button>
                    </div>
                </div>
            </div>
        )}
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
                            onClick={() => handleStartEditing('title', lecture.title)}
                        >
                            {lecture.title}
                        </h2>
                    )}
                    {editingField === 'date' ? (
                        <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleFinishEditing}
                            onKeyDown={handleEditKeyDown}
                            autoFocus
                            className="text-sm bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md px-2 -mx-2 mt-1"
                        />
                    ) : (
                        <p 
                            className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md px-2 -mx-2 mt-1"
                            onClick={() => handleStartEditing('date', lecture.date)}
                        >
                            {lecture.date}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex items-center space-x-2 md:space-x-4 flex-shrink-0">
                 <div className="hidden md:flex items-center space-x-2">
                    <input
                        id="thinking-mode-toggle"
                        type="checkbox"
                        checked={useThinkingMode}
                        onChange={(e) => setUseThinkingMode(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-indigo-500"
                        disabled={!isApiKeyReady}
                    />
                    <label htmlFor="thinking-mode-toggle" className={`text-sm text-gray-700 dark:text-gray-300 flex items-center ${!isApiKeyReady ? 'opacity-50' : ''}`}>
                        <BrainIcon className="w-5 h-5 mr-1 text-indigo-500 dark:text-indigo-400" />
                        Advanced Mode
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
                {lecture.tagsStatus === 'generating' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse mb-2">Generating suggested tags...</p>
                )}
                {lecture.tagsStatus === 'success' && lecture.suggestedTags && lecture.suggestedTags.length > 0 && (
                    <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Suggested Tags</h4>
                        <div className="flex flex-wrap gap-2">
                            {lecture.suggestedTags.filter(st => !lecture.tags.find(t => t.toLowerCase() === st.toLowerCase())).map((tag, index) => (
                                <button 
                                    key={`${tag}-${index}`}
                                    onClick={() => {
                                        const updatedTags = [...lecture.tags, tag];
                                        updateLecture(lecture.id, { tags: updatedTags });
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
                    {lecture.tags.map((tag, index) => (
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