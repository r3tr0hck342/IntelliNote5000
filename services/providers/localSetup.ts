import { httpFetch } from '../../utils/http';

const localRequestOptions = { redirect: 'error', maxRedirections: 0 } as const;

const localBase = (baseUrl: string): URL => {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)
        || !['localhost', '127.0.0.1'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash) {
        throw new Error('Use a local server URL on localhost or 127.0.0.1.');
    }
    return url;
};

const keyHeader = (apiKey: string): Record<string, string> =>
    apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

export async function findLocalModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const url = localBase(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
    const response = await httpFetch(url.toString(), {
        ...localRequestOptions,
        headers: keyHeader(apiKey),
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Could not list models.');
    const body: { data?: { id?: unknown }[] } | null = await response.json();
    if (!Array.isArray(body?.data)) throw new Error('The server did not return a model list.');
    return [...new Set(body.data.flatMap(entry =>
        typeof entry?.id === 'string' && entry.id.trim() ? [entry.id] : []
    ))];
}

export async function downloadOllamaModel(baseUrl: string, apiKey: string, model: string): Promise<void> {
    const url = localBase(baseUrl);
    if (!['/v1', '/v1/'].includes(url.pathname)) throw new Error('Expected an Ollama URL ending in /v1.');
    url.pathname = '/api/pull';
    const response = await httpFetch(url.toString(), {
        ...localRequestOptions,
        method: 'POST',
        headers: { ...keyHeader(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false }),
    });
    if (!response.ok || (await response.json())?.status !== 'success') {
        throw new Error('Ollama did not finish the model download.');
    }
}
