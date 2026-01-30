export type SttErrorCode = 'auth_failed' | 'connection_failed' | 'network_error' | 'stream_error' | 'unknown';

export interface SttError extends Error {
  code: SttErrorCode;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export const createSttError = (
  message: string,
  code: SttErrorCode,
  retryable: boolean,
  details?: Record<string, unknown>
): SttError => {
  const error = new Error(message) as SttError;
  error.code = code;
  error.retryable = retryable;
  error.details = details;
  return error;
};

export const mapSttError = (error: unknown): SttError => {
  if (error && typeof error === 'object' && 'code' in error && 'retryable' in error) {
    return error as SttError;
  }
  const message = error instanceof Error ? error.message : 'Unknown transcription error.';
  if (message.toLowerCase().includes('auth') || message.toLowerCase().includes('key')) {
    return createSttError('Authentication failed for transcription provider.', 'auth_failed', false, { message });
  }
  if (message.toLowerCase().includes('network')) {
    return createSttError('Network error while streaming audio.', 'network_error', true, { message });
  }
  if (message.toLowerCase().includes('socket') || message.toLowerCase().includes('connection')) {
    return createSttError('Transcription connection failed.', 'connection_failed', true, { message });
  }
  return createSttError('Unexpected transcription error.', 'unknown', true, { message });
};
