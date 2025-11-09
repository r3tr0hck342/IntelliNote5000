export interface Flashcard {
  front: string;
  back: string;
}

export interface CanvasElement {
  id: string;
  type: 'note' | 'diagram';
  content: string; // For 'note', this will be HTML. For 'diagram', it's Mermaid syntax.
  position: { x: number; y: number };
  size: { width: number | string; height: number | string };
  // New fields for diagram regeneration
  prompt?: string;
  diagramType?: string;
  advancedConfig?: string;
}

export interface Handout {
    name: string;
    content: string;
}

export interface TranscriptSegment {
    text: string;
    startTime: number; // in seconds
}

export interface GroundingSource {
    uri: string;
    title: string;
}

export interface ChatMessage {
    role: 'user' | 'model';
    content: string;
    sources?: GroundingSource[];
}

export interface Lecture {
  id: string;
  title: string;
  date: string;
  transcript: TranscriptSegment[];
  handouts: Handout[];
  summary: string | null;
  summaryStatus?: 'generating' | 'error' | 'success';
  organizedNotes: string | null; // This will now store HTML
  organizedNotesStatus?: 'generating' | 'error' | 'success';
  canvasState: CanvasElement[] | null;
  studyGuide: string | null;
  testQuestions: string | null;
  flashcards: Flashcard[] | null;
  tags: string[];
  suggestedTags?: string[];
  tagsStatus?: 'idle' | 'generating' | 'success' | 'error';
  chatHistory: ChatMessage[];
}

export enum GenerationMode {
  Summary = 'summary',
  Notes = 'notes',
  StudyGuide = 'guide',
  TestQuestions = 'questions',
  Flashcards = 'flashcards',
}

export enum AppView {
    Live,
    Note,
    Welcome
}

export enum AiEditMode {
  Improve = 'improve',
  Format = 'format',
  Topics = 'topics',
  Summarize = 'summarize',
  Custom = 'custom',
}