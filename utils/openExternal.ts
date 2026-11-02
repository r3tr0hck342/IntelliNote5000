/** Opens an https link in the system browser (desktop) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  if (!url.startsWith('https://')) return;
  if ('__TAURI_INTERNALS__' in window) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
