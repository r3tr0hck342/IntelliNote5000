import { GenerationMode, Handout, TranscriptSegment, AiEditMode } from '../types';

export const getTranscriptText = (transcript: TranscriptSegment[]): string => {
    return transcript.map(segment => segment.text).join(' ');
};

export const formatContext = (transcript: TranscriptSegment[], handouts: Handout[]): string => {
    const transcriptText = getTranscriptText(transcript);
    let context = `Transcript:\n---\n${transcriptText}\n---`;
    if (handouts && handouts.length > 0) {
        const handoutContent = handouts
            .map(h => `Handout: ${h.name}\n---\n${h.content}`)
            .join('\n\n');
        context += `\n\nSupplementary Handouts:\n===\n${handoutContent}\n===`;
    }
    return context;
};

export const getPromptForMode = (mode: GenerationMode, context: string): string => {
    switch (mode) {
        case GenerationMode.Notes:
            return `You are an expert note-taker. Your task is to create a single, cohesive set of notes by integrating information from BOTH the lecture transcript and any supplementary handouts. Organize the combined information into a structured, easy-to-read document using semantic HTML.
- Your entire response MUST be valid HTML. Do not include Markdown.
- Use headings (e.g., <h1>, <h2>), paragraphs (<p>), lists (<ul>, <ol>, <li>), and bold important terms (<strong>).
- This HTML will be rendered in a rich text editor, so ensure it is clean and well-formatted.

${context}`;
        case GenerationMode.StudyGuide:
            return `You are an expert academic assistant. Based on the combined information from the following lecture transcript and supplementary handouts, create a comprehensive study guide in Markdown format. The guide must synthesize content from all sources and should include:
1.  A brief summary of the main topic, integrating points from both transcript and handouts.
2.  A list of key concepts with clear definitions, drawn from all provided material.
3.  An outline of the most important points, combining information from all sources.
4.  Potential areas of confusion or topics that require further study, considering all materials.

${context}`;
        case GenerationMode.TestQuestions:
            return `You are an expert educator. Based on the combined information from the following lecture transcript and supplementary handouts, create a set of potential test questions in Markdown format to assess understanding of the entire material. The questions should cover concepts present in either the transcript, the handouts, or the intersection of both. Generate the following:
- 3 multiple-choice questions, each with four options (A, B, C, D) and indicate the correct answer.
- 2 short-answer questions that require a brief explanation.
- 1 essay question that prompts for a more in-depth analysis.

${context}`;
        default:
            throw new Error("Invalid generation mode");
    }
};

export const getFlashcardPrompt = (context: string, count: number): string => `You are an expert academic assistant creating study materials. Based on the combined information from the following lecture transcript and supplementary handouts, generate a set of flashcards. The flashcards should promote active recall and deeper understanding, not just simple definitions.

For each flashcard, create a 'front' and a 'back'.
- The 'front' should be a clear, concise question. Vary the question types to cover different levels of understanding. Include questions like:
    - "What is [key term]?"
    - "Explain the concept of [concept]."
    - "Compare and contrast [concept A] and [concept B]."
    - "What is the significance of [event/finding]?"
    - "Describe the process of [process]."
- The 'back' should be a comprehensive answer to the question on the front.

Identify the most important key terms, concepts, facts, and relationships from the provided materials. Create flashcards for concepts found in either the transcript or the handouts. Return exactly ${count} flashcards if the content allows, otherwise return as many as possible up to that number.

${context}`;

export const getTagPrompt = (context: string): string => `Based on the following lecture transcript and handouts, identify 5 to 7 key topics or themes. Return these as a JSON array of strings.
        
Context:
---
${context}
---`;

export const getChatSystemPrompt = (context: string): string =>
    `You are a helpful academic assistant. Your knowledge base is the provided lecture transcript and handouts. Answer the user's questions based ONLY on this context. If the answer isn't in the context, say that you don't have enough information.\n\n${context}`;

export const getEditPrompt = (mode: AiEditMode, text: string, customPrompt?: string): string => {
    switch (mode) {
        case AiEditMode.Improve:
            return `You are an expert editor. Review the following text from a lecture transcript. Your task is to improve its readability by correcting any typos, grammatical errors, and awkward phrasing. Do not add new information or change the meaning. Return only the improved text.

Original text:
---
${text}
---`;
        case AiEditMode.Format:
            return `You are an expert note-taker. Convert the following lecture transcript into a structured set of notes. Use Markdown for formatting, including headings, lists, and bold text for key terms. Return only the formatted notes.

Original text:
---
${text}
---`;
        case AiEditMode.Topics:
            return `You are an expert analyst. Read the following text from a lecture transcript and identify the key topics and concepts discussed. Present them as a concise bulleted list in Markdown. Return only the list of topics.

Original text:
---
${text}
---`;
        case AiEditMode.Summarize:
            return `You are an expert summarizer. Provide a concise summary of the following text from a lecture transcript. The summary should capture the main points and be about 1/4 of the original length. Return only the summary.

Original text:
---
${text}
---`;
        case AiEditMode.Custom:
            if (!customPrompt) throw new Error("Custom prompt is required for custom edit mode.");
            return `You are an expert editor following user instructions. Apply the following instruction to the provided text. Return only the modified text, with no extra commentary.

Instruction: "${customPrompt}"

Original text:
---
${text}
---`;
        default:
            throw new Error("Invalid AI edit mode.");
    }
};
