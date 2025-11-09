import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';

// Check if running in Tauri environment
export const isTauri = () => typeof window !== 'undefined' && !!(window as any).__TAURI__;

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
