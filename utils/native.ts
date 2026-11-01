import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';

// Check if running in Tauri environment
export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI__;

// Native file save dialog
export const nativeSave = async (content: string, defaultPath: string): Promise<boolean> => {
    if (!isTauri()) {
        console.warn("Tauri API not available. Falling back to web download.");
        return false;
    }
    try {
        const filePath = await save({
            defaultPath,
            filters: [{ name: 'Markdown', extensions: ['md'] }]
        });
        if (filePath) {
            await writeTextFile(filePath, content);
            return true; // Indicates native save was successful
        }
        return true; // User cancelled, which we count as a handled "success" to prevent fallback download.
    } catch (error) {
        console.error("Tauri save dialog failed:", error);
        return false; // Error occurred, allow fallback.
    }
};

// Native save dialog for binary files (e.g. recorded audio). Same return contract as nativeSave.
export const nativeSaveBytes = async (bytes: Uint8Array, defaultPath: string, extension: string): Promise<boolean> => {
    if (!isTauri()) return false;
    try {
        const filePath = await save({
            defaultPath,
            filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
        });
        if (filePath) {
            await writeFile(filePath, bytes);
        }
        return true;
    } catch (error) {
        console.error("Tauri save dialog failed:", error);
        return false;
    }
};

export const triggerBrowserDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
