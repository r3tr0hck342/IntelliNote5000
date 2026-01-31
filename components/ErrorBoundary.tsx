import React from 'react';
import { logEvent } from '../utils/logger';
import { exportDiagnosticsBundle } from '../utils/diagnosticsBundle';
import { getCachedApiConfig } from '../utils/apiConfig';
import { getCachedSttConfig } from '../utils/transcriptionConfig';
import { resetAppState } from '../utils/appReset';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logEvent('error', 'UI crash', { message: error.message, stack: error.stack, componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              IntelliNote ran into an unexpected error. You can reload the app to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Reload App
            </button>
            <div className="flex flex-col gap-2">
              <button
                onClick={() =>
                  exportDiagnosticsBundle({
                    providerConfigPresence: {
                      aiConfigured: Boolean(getCachedApiConfig()?.apiKey),
                      sttConfigured: Boolean(getCachedSttConfig()?.apiKey),
                    },
                  })
                }
                className="px-4 py-2 rounded-md bg-gray-800 text-white hover:bg-gray-900"
              >
                Export Diagnostics Bundle
              </button>
              <button
                onClick={async () => {
                  const confirmed = window.confirm('Reset app state? This clears local sessions and cached settings.');
                  if (!confirmed) return;
                  const includeSecureStorage = window.confirm('Also clear secure storage credentials? This removes saved API keys.');
                  await resetAppState({ includeSecureStorage });
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                Reset App State
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
