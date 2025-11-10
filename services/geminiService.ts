import { GoogleGenAI, Type, Chat, GenerateContentResponse } from "@google/genai";
import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode } from '../types';

// Use the pre-configured process.env.API_KEY
const API_KEY = process.env.API_KEY;

const getAi = () => {
    if (!API_KEY) {
        throw new Error("API_KEY is not configured. Please configure it in the AI Settings.");
    }
    return new GoogleGenAI({ apiKey: API_KEY });
};

const getTranscriptText = (transcript: TranscriptSegment[]): string => {
    return transcript.map(segment => segment.text).join(' ');
};

const formatContext = (transcript: TranscriptSegment[], handouts: Handout[]): string => {
    const transcriptText = getTranscriptText(transcript);
    let context = `Transcript:\n---\n${transcriptText}\n---`;
    if (handouts && handouts.length > 0) {
        const handoutContent = handouts.map(h => `Handout: ${h.name}\n---\n${h.content}`).join('\n\n');
        context += `\n\nSupplementary Handouts:\n===\n${handoutContent}\n===`;
    }
    return context;
};

const getPromptForMode = (mode: GenerationMode, context: string): string => {
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

export const processTranscript = async (transcript: TranscriptSegment[], mode: GenerationMode, handouts: Handout[], useIntelligenceMode: boolean): Promise<string> => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const prompt = getPromptForMode(mode, context);
        
        const model = useIntelligenceMode ? 'gemini-2.5-pro' : 'gemini-flash-lite-latest';
        const config: any = {};
        if (useIntelligenceMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }
        
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: Object.keys(config).length > 0 ? config : undefined,
        });
        return response.text;
    } catch (error) {
        console.error("Error processing transcript:", error);
        return "An error occurred while generating content. Please check the console for details.";
    }
};

export const generateFlashcards = async (transcript: TranscriptSegment[], handouts: Handout[], count: number = 10, useIntelligenceMode: boolean): Promise<Flashcard[]> => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const prompt = `Based on the combined information from the following lecture transcript and supplementary handouts, identify the most important key terms, concepts, and facts. Create flashcards for concepts found in either the transcript or the handouts. For each, create a flashcard with a 'front' (the term/question) and a 'back' (the definition/answer). Return exactly ${count} flashcards if the content allows, otherwise return as many as possible up to that number.

${context}`;
        
        const model = useIntelligenceMode ? 'gemini-2.5-pro' : 'gemini-flash-lite-latest';
        const config: any = {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        front: {
                            type: Type.STRING,
                            description: 'The key term, concept, or question for the front of the flashcard.'
                        },
                        back: {
                            type: Type.STRING,
                            description: 'The definition, explanation, or answer for the back of the flashcard.'
                        }
                    },
                    required: ['front', 'back']
                }
            }
        };

        if (useIntelligenceMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }

        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: config
        });
        
        const jsonText = response.text.trim();
        const flashcards: Flashcard[] = JSON.parse(jsonText);
        return flashcards;

    } catch (error) {
        console.error("Error generating flashcards:", error);
        throw new Error("Failed to generate flashcards. The AI response might be invalid.");
    }
};


export const generateDiagram = async (prompt: string, diagramType: string, advancedConfig: string, transcript: TranscriptSegment[], handouts: Handout[], useIntelligenceMode: boolean): Promise<string> => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const diagramPrompt = `You are an expert in data visualization using Mermaid.js. You have the context of a lecture transcript and handouts. Based on this context and the following user request, generate ONLY the corresponding Mermaid.js syntax for a ${diagramType}.
- Your response must start directly with the Mermaid syntax (e.g., "graph TD", "sequenceDiagram", "pie", etc.).
- Do NOT include markdown fences (\`\`\`mermaid) or any other explanatory text.
- If the user provides an advanced configuration, apply it to the diagram.
- If the request is impossible, return a valid Mermaid graph with an error message, like: graph TD; A["Error: Could not generate a ${diagramType} from the prompt."];

User Request: "${prompt}"
${advancedConfig ? `Advanced Configuration: "${advancedConfig}"` : ''}

Lecture Context:
---
${context}
---`;
        const model = useIntelligenceMode ? 'gemini-2.5-pro' : 'gemini-flash-lite-latest';
        const config: any = {};
        if (useIntelligenceMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }
        
        const response = await ai.models.generateContent({
            model,
            contents: diagramPrompt,
            config: Object.keys(config).length > 0 ? config : undefined,
        });

        return response.text;

    } catch (error) {
        console.error("Error generating diagram:", error);
        return `graph TD;\n  A["An error occurred while generating the diagram."];`;
    }
};

export const generateTags = async (transcript: TranscriptSegment[], handouts: Handout[]): Promise<string[]> => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const prompt = `Based on the following lecture transcript and handouts, identify 5 to 7 key topics or themes. Return these as a JSON array of strings.
        
Context:
---
${context}
---`;

        const model = 'gemini-flash-lite-latest';
        
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.STRING
                    }
                }
            }
        });

        const jsonText = response.text.trim();
        const tags: string[] = JSON.parse(jsonText);
        return tags;

    } catch (error) {
        console.error("Error generating tags:", error);
        throw new Error("Failed to generate tags.");
    }
};

export const getChatResponseStream = async (
    history: ChatMessage[],
    message: string,
    transcript: TranscriptSegment[],
    handouts: Handout[],
    useSearchGrounding: boolean,
    useIntelligenceMode: boolean
) => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const model = useIntelligenceMode ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
        
        const contents = [
            ...history.map(msg => ({
                role: msg.role,
                parts: [{ text: msg.content }]
            })),
            { role: 'user', parts: [{ text: message }] }
        ];

        const config: any = {
            systemInstruction: `You are a helpful academic assistant. Your knowledge base is the provided lecture transcript and handouts. Answer the user's questions based ONLY on this context. If the answer isn't in the context, say that you don't have enough information. If search grounding is enabled, you may use it to supplement your answer.\n\n${context}`,
            tools: useSearchGrounding ? [{ googleSearch: {} }] : undefined,
        };
        if (useIntelligenceMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }
        
        const responseStream = await ai.models.generateContentStream({
            model,
            contents: contents as any,
            config: config,
        });

        return responseStream;
    } catch (error) {
        console.error("Error getting chat response stream:", error);
        throw new Error("Failed to get chat response.");
    }
};

export const editTranscriptWithAi = async (
    text: string,
    mode: AiEditMode,
    useIntelligenceMode: boolean,
    customPrompt?: string
): Promise<string> => {
    try {
        const ai = getAi();
        let prompt = '';

        switch (mode) {
            case AiEditMode.Improve:
                prompt = `You are an expert editor. Review the following text from a lecture transcript. Your task is to improve its readability by correcting any typos, grammatical errors, and awkward phrasing. Do not add new information or change the meaning. Return only the improved text.

Original text:
---
${text}
---`;
                break;
            case AiEditMode.Format:
                prompt = `You are an expert note-taker. Convert the following lecture transcript into a structured set of notes. Use Markdown for formatting, including headings, lists, and bold text for key terms. Return only the formatted notes.

Original text:
---
${text}
---`;
                break;
            case AiEditMode.Topics:
                 prompt = `You are an expert analyst. Read the following text from a lecture transcript and identify the key topics and concepts discussed. Present them as a concise bulleted list in Markdown. Return only the list of topics.

Original text:
---
${text}
---`;
                break;
            case AiEditMode.Summarize:
                prompt = `You are an expert summarizer. Provide a concise summary of the following text from a lecture transcript. The summary should capture the main points and be about 1/4 of the original length. Return only the summary.

Original text:
---
${text}
---`;
                break;
            case AiEditMode.Custom:
                if (!customPrompt) throw new Error("Custom prompt is required for custom edit mode.");
                prompt = `You are an expert editor following user instructions. Apply the following instruction to the provided text. Return only the modified text, with no extra commentary.

Instruction: "${customPrompt}"

Original text:
---
${text}
---`;
                break;
            default:
                throw new Error("Invalid AI edit mode.");
        }
        
        const model = useIntelligenceMode ? 'gemini-2.5-pro' : 'gemini-flash-lite-latest';
        const config: any = {};
        if (useIntelligenceMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }
        
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: Object.keys(config).length > 0 ? config : undefined,
        });
        
        return response.text;

    } catch (error) {
        console.error("Error editing transcript with AI:", error);
        throw new Error("Failed to edit transcript with AI.");
    }
};
