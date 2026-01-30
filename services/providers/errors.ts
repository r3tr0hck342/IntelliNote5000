import type { ProviderId } from '../../types/ai';

export type ProviderErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'invalid_request'
  | 'network_error'
  | 'timeout'
  | 'server_error'
  | 'unknown';

export interface ProviderErrorDetails {
  status?: number;
  provider?: ProviderId;
  rawMessage?: string;
}

export class ProviderError extends Error {
  code: ProviderErrorCode;
  retryable: boolean;
  details?: ProviderErrorDetails;

  constructor(message: string, code: ProviderErrorCode, retryable: boolean, details?: ProviderErrorDetails) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

const isNetworkError = (error: any) =>
  error?.name === 'TypeError' || (typeof error?.message === 'string' && error.message.includes('Network'));

export const mapProviderError = (error: unknown, provider?: ProviderId): ProviderError => {
  if (error instanceof ProviderError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'Unknown provider error.';
  const details: ProviderErrorDetails = { provider, rawMessage: message };

  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (typeof status === 'number') {
    details.status = status;
    if (status === 401 || status === 403) {
      return new ProviderError('Authentication failed. Check your API key.', 'auth_failed', false, details);
    }
    if (status === 429) {
      return new ProviderError('Rate limited by the provider. Please try again shortly.', 'rate_limited', true, details);
    }
    if (status >= 400 && status < 500) {
      return new ProviderError('The request was rejected by the provider.', 'invalid_request', false, details);
    }
    if (status >= 500) {
      return new ProviderError('The provider service is unavailable. Please retry.', 'server_error', true, details);
    }
  }

  if (isNetworkError(error)) {
    return new ProviderError('Network error while contacting the provider.', 'network_error', true, details);
  }

  if (typeof message === 'string' && message.toLowerCase().includes('timeout')) {
    return new ProviderError('The provider request timed out. Please retry.', 'timeout', true, details);
  }

  return new ProviderError('Unexpected provider error. Please retry.', 'unknown', true, details);
};

export const getProviderErrorSummary = (error: ProviderError) => {
  switch (error.code) {
    case 'auth_failed':
      return 'Authentication failed';
    case 'rate_limited':
      return 'Rate limit reached';
    case 'invalid_request':
      return 'Invalid request';
    case 'network_error':
      return 'Network error';
    case 'timeout':
      return 'Timeout';
    case 'server_error':
      return 'Provider error';
    default:
      return 'Provider error';
  }
};
