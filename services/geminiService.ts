import { GoogleGenAI, Type, Chat } from "@google/genai";
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
        case GenerationMode.Summary:
            return `You are an expert summarizer. Your task is to synthesize information from BOTH the lecture transcript and any supplementary handouts provided. Generate a detailed, multi-paragraph summary that covers all the main topics discussed. Structure your summary with the following sections in Markdown:
1.  **Overview**: A brief, one-paragraph introduction to the lecture's core subject.
2.  **Key Concepts**: A bulleted list of the most important terms, definitions, and concepts presented.
3.  **Detailed Breakdown**: A more in-depth explanation of the main arguments and findings, organized by topic.
4.  **Conclusion**: A concluding paragraph that summarizes the main takeaways and implications.

${context}`;
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

export const processTranscript = async (transcript: TranscriptSegment[], mode: GenerationMode, handouts: Handout[], useThinkingMode: boolean): Promise<string> => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const prompt = getPromptForMode(mode, context);
        
        const config: any = {};
        if (useThinkingMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
            config: Object.keys(config).length > 0 ? config : undefined,
        });
        return response.text;
    } catch (error) {
        console.error("Error processing transcript:", error);
        return "An error occurred while generating content. Please check the console for details.";
    }
};

export const generateFlashcards = async (transcript: TranscriptSegment[], handouts: Handout[], count: number = 10, useThinkingMode: boolean): Promise<Flashcard[]> => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const prompt = `Based on the combined information from the following lecture transcript and supplementary handouts, identify the most important key terms, concepts, and facts. Create flashcards for concepts found in either the transcript or the handouts. For each, create a flashcard with a 'front' (the term/question) and a 'back' (the definition/answer). Return exactly ${count} flashcards if the content allows, otherwise return as many as possible up to that number.

${context}`;

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

        if (useThinkingMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
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


export const generateDiagram = async (prompt: string, diagramType: string, advancedConfig: string, transcript: TranscriptSegment[], handouts: Handout[], useThinkingMode: boolean): Promise<string> => {
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
        const config: any = {};
        if (useThinkingMode) {
            config.thinkingConfig = { thinkingBudget: 32768 };
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: diagramPrompt,
            config: Object.keys(config).length > 0 ? config : undefined,
        });
        
        return response.text.trim();
    } catch (error) {
        console.error("Error generating diagram:", error);
        return `graph TD;\nA["An error occurred while generating the diagram."];`;
    }
};

export const generateTags = async (transcript: TranscriptSegment[], handouts: Handout[]): Promise<string[]> => {
    try {
        const ai = getAi();
        const context = formatContext(transcript, handouts);
        const prompt = `You are an expert at information retrieval and categorization. Analyze the following lecture context (transcript and handouts) and identify the most relevant and concise tags. These tags should represent the main topics, concepts, or themes.
- Return between 3 to 5 tags.
- Each tag should be 1-3 words long.
- The tags should be distinct and cover different aspects of the content.

Based on the context, provide a list of tags.

${context}`;

        const config = {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    tags: {
                        type: Type.ARRAY,
                        description: "A list of 3-5 relevant tags.",
                        items: {
                            type: Type.STRING
                        }
                    }
                },
                required: ['tags']
            }
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: config
        });

        const jsonText = response.text.trim();
        const result: { tags: string[] } = JSON.parse(jsonText);
        
        return result.tags.map(tag => tag.trim()).filter(Boolean);

    } catch (error) {
        console.error("Error generating tags:", error);
        return [];
    }
};

export const getChatResponseStream = async (
    history: ChatMessage[],
    newMessage: string,
    transcript: TranscriptSegment[],
    handouts: Handout[],
    useSearch: boolean,
    useThinkingMode: boolean
) => {
    const ai = getAi();
    const context = formatContext(transcript, handouts);
    
    const model = useThinkingMode ? 'gemini-2.5-pro' : (useSearch ? 'gemini-2.5-flash' : 'gemini-flash-lite-latest');

    const systemInstruction = useSearch
        ? `You are a helpful AI tutor. Your primary knowledge source is the provided lecture transcript and supplementary handouts. You can also use Google Search to find up-to-date information or concepts not covered in the materials. When you use web sources, you MUST prioritize academic and scholarly articles. Use Google Scholar for your searches whenever possible. You must cite your sources.`
        : `You are a helpful AI tutor. Your knowledge is strictly limited to the provided lecture transcript and supplementary handouts. Answer the user's questions based ONLY on this context. If the answer cannot be found in the provided materials, say "I cannot answer that based on the provided lecture materials." Do not use any external knowledge.

--- CONTEXT ---
${context}
--- END CONTEXT ---
`;
    
    const config: any = { systemInstruction };
    if (useSearch) {
        config.tools = [{googleSearch: {}}];
    }
    if (useThinkingMode) {
        config.thinkingConfig = { thinkingBudget: 32768 };
    }


    const chat = ai.chats.create({
        model,
        config,
        history: history.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }]
        }))
    });
    
    return chat.sendMessageStream({ message: newMessage });
};

export const editTranscriptWithAi = async (
    text: string,
    mode: AiEditMode,
    customPrompt?: string
): Promise<string> => {
    try {
        const ai = getAi();
        let model: string;
        let prompt: string;
        let config: any = {};

        switch (mode) {
            case AiEditMode.Improve:
                model = 'gemini-flash-lite-latest';
                prompt = `You are an expert editor. Your task is to improve the readability of the following text, which is a transcript of a spoken lecture. Do not change the meaning. Only perform the following actions:
- Correct spelling mistakes.
- Fix grammatical errors.
- Add or correct punctuation.
- Improve sentence structure for clarity.
- Your output should be ONLY the improved text.

--- TEXT ---
${text}
--- END TEXT ---
`;
                break;

            case AiEditMode.Format:
                model = 'gemini-2.5-flash';
                prompt = `You are a professional note-taker. Convert the following raw lecture transcript into well-structured notes.
- Use Markdown for formatting.
- Use headings (#, ##) for main topics.
- Use bullet points (-) for lists or key details.
- Use bold syntax (**) to highlight important terms.
- Your output should be ONLY the formatted notes in Markdown.

--- TEXT ---
${text}
--- END TEXT ---
`;
                break;
            
            case AiEditMode.Topics:
                 model = 'gemini-2.5-flash';
                 prompt = `Analyze the following lecture transcript and identify the main topics discussed. Return a list of these topics.

--- TEXT ---
${text}
--- END TEXT ---
`;
                 config = {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            topics: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            }
                        },
                        required: ['topics']
                    }
                };
                break;

            case AiEditMode.Summarize:
                model = 'gemini-flash-lite-latest';
                prompt = `Summarize the following text excerpt from a lecture transcript in 1-3 sentences. Provide ONLY the summary.

--- TEXT ---
${text}
--- END TEXT ---
`;
                break;

            case AiEditMode.Custom:
                if (!customPrompt) throw new Error("Custom prompt is required for custom edit mode.");
                model = 'gemini-2.5-pro';
                prompt = `You are an expert AI assistant. Apply the following instruction to the provided text. Return only the modified text as a result.

Instruction: "${customPrompt}"

--- TEXT ---
${text}
--- END TEXT ---
`;
                break;
            
            default:
                throw new Error("Invalid AI edit mode.");
        }
        
        const response = await ai.models.generateContent({ model, contents: prompt, config: Object.keys(config).length > 0 ? config : undefined });
        
        if (mode === AiEditMode.Topics) {
            const jsonText = response.text.trim();
            const result = JSON.parse(jsonText);
            return result.topics.map((topic: string) => `- ${topic}`).join('\n');
        }

        return response.text.trim();

    } catch (error) {
        console.error(`Error during AI edit mode '${mode}':`, error);
        throw new Error("An error occurred while processing your request with the AI assistant.");
    }
};
