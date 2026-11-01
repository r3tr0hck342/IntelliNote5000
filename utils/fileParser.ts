import { Handout } from '../types';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Bundled locally: the desktop CSP blocks CDNs, and PDF import must work offline.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const parseFile = async (file: File): Promise<Handout | null> => {
    const { name } = file;
    if (file.type === 'application/pdf') {
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    if (!event.target?.result) {
                        return reject(new Error("File could not be read."));
                    }
                    const pdf = await pdfjsLib.getDocument(event.target.result as ArrayBuffer).promise;
                    let content = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        content += textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                        content += '\n\n'; // Add a blank line between pages
                    }
                    resolve({ name, content });
                } catch (error) {
                    console.error('Error parsing PDF:', error);
                    reject(error);
                }
            };
            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
        });
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    if (!event.target?.result) {
                        return reject(new Error("File could not be read."));
                    }
                    const result = await mammoth.extractRawText({ arrayBuffer: event.target.result as ArrayBuffer });
                    resolve({ name, content: result.value });
                } catch (error) {
                    console.error('Error parsing DOCX:', error);
                    reject(error);
                }
            };
            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
        });
    } else if (file.type.startsWith('text/') || file.name.endsWith('.md')) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve({ name, content: event.target?.result as string });
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    }
    // Silently ignore unsupported files by returning null
    console.warn(`Unsupported file type: ${file.type} (${file.name}). File was ignored.`);
    return null;
};
