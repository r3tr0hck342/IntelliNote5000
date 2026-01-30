export interface Flashcard {
  front: string;
  back: string;
}

export interface Handout {
    name: string;
    content: string;
}

export interface TranscriptSegment {
    id: string;
    assetId: string;
    startMs: number;
    endMs: number;
    text: string;
    isFinal: boolean;
    confidence?: number;
    speaker?: string;
    utteranceId?: string;
    createdAt: string;
}

export interface LegacyTranscriptSegment {
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

export interface LegacyLecture {
  id: string;
  title: string;
  date: string;
  transcript: LegacyTranscriptSegment[];
  handouts: Handout[];
  organizedNotes: string | null; // This will now store HTML
  organizedNotesStatus?: 'generating' | 'error' | 'success';
  studyGuide: string | null;
  testQuestions: string | null;
  flashcards: Flashcard[] | null;
  tags: string[];
  suggestedTags?: string[];
  tagsStatus?: 'idle' | 'generating' | 'success' | 'error';
  chatHistory: ChatMessage[];
}

export interface StudySession {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  assets: LectureAsset[];
  handouts: Handout[];
  organizedNotes: string | null;
  organizedNotesStatus?: 'generating' | 'error' | 'success';
  studyGuide: string | null;
  testQuestions: string | null;
  flashcards: Flashcard[] | null;
  tags: string[];
  suggestedTags?: string[];
  tagsStatus?: 'idle' | 'generating' | 'success' | 'error';
  chatHistory: ChatMessage[];
}

export interface LectureAsset {
  id: string;
  sessionId: string;
  sourceType: 'live' | 'import';
  audioPath?: string;
  transcriptText: string;
  transcriptPath?: string;
  language: string;
  createdAt: string;
  segments: TranscriptSegment[];
}

export enum GenerationMode {
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

export interface PersistedSessions {
  schemaVersion: number;
  sessions: StudySession[];
}

export const SESSION_SCHEMA_VERSION = 1;
