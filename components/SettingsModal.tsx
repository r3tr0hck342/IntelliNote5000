import React, { useMemo, useState, useEffect } from 'react';
import { XIcon, BrainIcon, SunIcon, MoonIcon } from './icons';
import { ApiConfig } from '../utils/apiConfig';
import { ProviderId } from '../types/ai';
import { ProviderMetadata } from '../services/providers/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiConfig: ApiConfig | null;
  onSaveApiConfig: (config: ApiConfig) => Promise<void>;
  onClearApiConfig: () => Promise<void>;
  availableProviders: ProviderMetadata[];
  isApiKeyReady: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiConfig,
  onSaveApiConfig,
  onClearApiConfig,
  availableProviders,
  isApiKeyReady,
  theme,
  onToggleTheme,
}) => {
  const defaultProvider = useMemo<ProviderId>(() => availableProviders[0]?.id ?? 'gemini', [availableProviders]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(apiConfig?.provider ?? defaultProvider);
  const [apiKey, setApiKey] = useState(apiConfig?.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(apiConfig?.baseUrl ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelectedProvider(apiConfig?.provider ?? defaultProvider);
    setApiKey(apiConfig?.apiKey ?? '');
    setBaseUrl(apiConfig?.baseUrl ?? '');
  }, [apiConfig, defaultProvider]);

  if (!isOpen) return null;

  const selectedMetadata = availableProviders.find(p => p.id === selectedProvider) || availableProviders[0];
  const requiresBaseUrl = Boolean(selectedMetadata?.allowsCustomBaseUrl);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setIsSaving(true);
    try {
      await onSaveApiConfig({
        provider: selectedProvider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
            <BrainIcon className="w-6 h-6 mr-3 text-indigo-500" />
            Settings
          </h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            <XIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-8 overflow-y-auto max-h-[75vh]">
          <section>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">Appearance</h3>
            <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between">
              <span className="font-medium text-gray-800 dark:text-gray-200">Theme</span>
              <button onClick={onToggleTheme} className="flex items-center space-x-2 px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                {theme === 'dark' ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">AI Provider</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              IntelliNote runs entirely on your credentials. Choose your preferred provider and paste your API key below. Keys are stored locally (or in secure storage on native builds) and never bundled into release binaries.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {availableProviders.map(provider => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
                {selectedMetadata && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <p>{selectedMetadata.description}</p>
                    <a href={selectedMetadata.docsUrl} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">
                      Provider documentation
                    </a>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{selectedMetadata?.keyLabel ?? 'API Key'}</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={selectedMetadata?.placeholder ?? 'Paste your API key'}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
              </div>
              {requiresBaseUrl && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Custom Base URL (optional)</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  />
                </div>
              )}
              {selectedMetadata?.notes && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{selectedMetadata.notes}</p>
              )}
              <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between">
                <span className="font-medium text-gray-800 dark:text-gray-200">Connection Status:</span>
                {isApiKeyReady ? (
                  <span className="text-green-600 dark:text-green-400 font-semibold px-2 py-1 bg-green-100 dark:bg-green-900 rounded-md">Configured</span>
                ) : (
                  <span className="text-yellow-600 dark:text-yellow-400 font-semibold px-2 py-1 bg-yellow-100 dark:bg-yellow-900 rounded-md">Missing</span>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between flex-wrap gap-3">
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await onClearApiConfig();
                setApiKey('');
              }}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Clear Key
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600">
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || isSaving}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save API Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
