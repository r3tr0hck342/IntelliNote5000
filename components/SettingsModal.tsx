import React, { useMemo, useState, useEffect } from 'react';
import { XIcon, BrainIcon, SunIcon, MoonIcon } from './icons';
import { ApiConfig } from '../utils/apiConfig';
import { ProviderId } from '../types/ai';
import { ProviderMetadata } from '../services/providers/types';
import { SttConfig, SttProviderId } from '../types/stt';
import { SttProviderMetadata } from '../services/stt';
import type { AutoGenerationConfig } from '../utils/autoGenerationConfig';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiConfig: ApiConfig | null;
  onSaveApiConfig: (config: ApiConfig) => Promise<void>;
  onClearApiConfig: () => Promise<void>;
  sttConfig: SttConfig | null;
  onSaveSttConfig: (config: SttConfig) => Promise<void>;
  onClearSttConfig: () => Promise<void>;
  onClearAllCredentials: () => Promise<void>;
  availableProviders: ProviderMetadata[];
  availableSttProviders: SttProviderMetadata[];
  isApiKeyReady: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  diagnosticsEnabled: boolean;
  onToggleDiagnostics: (enabled: boolean) => void;
  credentialFallbackEnabled: boolean;
  onToggleCredentialFallback: (enabled: boolean) => void;
  autoGenerationConfig: AutoGenerationConfig;
  onSaveAutoGenerationConfig: (config: AutoGenerationConfig) => void;
  onExportDiagnostics: () => void;
  onResetAppState: (options: { includeSecureStorage: boolean }) => Promise<void>;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiConfig,
  onSaveApiConfig,
  onClearApiConfig,
  sttConfig,
  onSaveSttConfig,
  onClearSttConfig,
  onClearAllCredentials,
  availableProviders,
  availableSttProviders,
  isApiKeyReady,
  theme,
  onToggleTheme,
  diagnosticsEnabled,
  onToggleDiagnostics,
  credentialFallbackEnabled,
  onToggleCredentialFallback,
  autoGenerationConfig,
  onSaveAutoGenerationConfig,
  onExportDiagnostics,
  onResetAppState,
}) => {
  const defaultProvider = useMemo<ProviderId>(() => availableProviders[0]?.id ?? 'gemini', [availableProviders]);
  const defaultSttProvider = useMemo<SttProviderId>(() => availableSttProviders[0]?.id ?? 'deepgram', [availableSttProviders]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(apiConfig?.provider ?? defaultProvider);
  const [apiKey, setApiKey] = useState(apiConfig?.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(apiConfig?.baseUrl ?? '');
  const [selectedSttProvider, setSelectedSttProvider] = useState<SttProviderId>(sttConfig?.provider ?? defaultSttProvider);
  const [sttApiKey, setSttApiKey] = useState(sttConfig?.apiKey ?? '');
  const [sttLanguage, setSttLanguage] = useState(sttConfig?.language ?? '');
  const [sttModel, setSttModel] = useState(sttConfig?.model ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingStt, setIsSavingStt] = useState(false);
  const [autoGenConfig, setAutoGenConfig] = useState(autoGenerationConfig);

  useEffect(() => {
    setSelectedProvider(apiConfig?.provider ?? defaultProvider);
    setApiKey(apiConfig?.apiKey ?? '');
    setBaseUrl(apiConfig?.baseUrl ?? '');
  }, [apiConfig, defaultProvider]);

  useEffect(() => {
    setSelectedSttProvider(sttConfig?.provider ?? defaultSttProvider);
    setSttApiKey(sttConfig?.apiKey ?? '');
    setSttLanguage(sttConfig?.language ?? '');
    setSttModel(sttConfig?.model ?? '');
  }, [sttConfig, defaultSttProvider]);

  useEffect(() => {
    setAutoGenConfig(autoGenerationConfig);
  }, [autoGenerationConfig]);

  if (!isOpen) return null;

  const selectedMetadata = availableProviders.find(p => p.id === selectedProvider) || availableProviders[0];
  const requiresBaseUrl = Boolean(selectedMetadata?.allowsCustomBaseUrl);
  const selectedSttMetadata = availableSttProviders.find(p => p.id === selectedSttProvider) || availableSttProviders[0];

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

  const handleSaveStt = async () => {
    if (!sttApiKey.trim()) return;
    setIsSavingStt(true);
    try {
      await onSaveSttConfig({
        provider: selectedSttProvider,
        apiKey: sttApiKey.trim(),
        language: sttLanguage.trim() || undefined,
        model: sttModel.trim() || undefined,
      });
    } finally {
      setIsSavingStt(false);
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
              IntelliNote runs entirely on your credentials. Choose your preferred provider and paste your API key below. Keys are stored in secure storage on native builds. Browser storage is optional and must be explicitly enabled below.
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

          <section>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">Transcription Provider</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Configure streaming transcription credentials for live lecture capture. This is separate from your AI provider.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provider</label>
                <select
                  value={selectedSttProvider}
                  onChange={(e) => setSelectedSttProvider(e.target.value as SttProviderId)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {availableSttProviders.map(provider => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
                {selectedSttMetadata && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <p>{selectedSttMetadata.description}</p>
                    <a href={selectedSttMetadata.docsUrl} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">
                      Provider documentation
                    </a>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{selectedSttMetadata?.keyLabel ?? 'API Key'}</label>
                <input
                  type="password"
                  value={sttApiKey}
                  onChange={(e) => setSttApiKey(e.target.value)}
                  placeholder={selectedSttMetadata?.placeholder ?? 'Paste your transcription API key'}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Language (optional)</label>
                  <input
                    type="text"
                    value={sttLanguage}
                    onChange={(e) => setSttLanguage(e.target.value)}
                    placeholder="en-US"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model (optional)</label>
                  <input
                    type="text"
                    value={sttModel}
                    onChange={(e) => setSttModel(e.target.value)}
                    placeholder="nova-2"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
              {selectedSttMetadata?.notes && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{selectedSttMetadata.notes}</p>
              )}
              <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between">
                <span className="font-medium text-gray-800 dark:text-gray-200">Streaming Status:</span>
                {sttApiKey.trim() ? (
                  <span className="text-green-600 dark:text-green-400 font-semibold px-2 py-1 bg-green-100 dark:bg-green-900 rounded-md">Configured</span>
                ) : (
                  <span className="text-yellow-600 dark:text-yellow-400 font-semibold px-2 py-1 bg-yellow-100 dark:bg-yellow-900 rounded-md">Missing</span>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveStt}
                  disabled={!sttApiKey.trim() || isSavingStt}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingStt ? 'Saving...' : 'Save Transcription Settings'}
                </button>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">Diagnostics & Storage</h3>
            <div className="space-y-4">
              <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-800 dark:text-gray-200">Diagnostics panel</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Shows recent provider events and errors.</div>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={diagnosticsEnabled}
                    onChange={(event) => onToggleDiagnostics(event.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-11 h-6 rounded-full ${diagnosticsEnabled ? 'bg-indigo-600' : 'bg-gray-400'} relative`}>
                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${diagnosticsEnabled ? 'translate-x-5' : ''}`} />
                  </div>
                </label>
              </div>
              <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-800 dark:text-gray-200">Allow browser storage fallback</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Stores credentials in localStorage on web builds (less secure).</div>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={credentialFallbackEnabled}
                    onChange={(event) => onToggleCredentialFallback(event.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-11 h-6 rounded-full ${credentialFallbackEnabled ? 'bg-indigo-600' : 'bg-gray-400'} relative`}>
                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${credentialFallbackEnabled ? 'translate-x-5' : ''}`} />
                  </div>
                </label>
              </div>
              <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg space-y-3">
                <div className="font-medium text-gray-800 dark:text-gray-200">Auto-generation cadence</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Debounce (ms)</label>
                    <input
                      type="number"
                      min={1000}
                      value={autoGenConfig.debounceMs}
                      onChange={(event) => setAutoGenConfig({ ...autoGenConfig, debounceMs: Number(event.target.value) })}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Min interval (ms)</label>
                    <input
                      type="number"
                      min={5000}
                      value={autoGenConfig.minIntervalMs}
                      onChange={(event) => setAutoGenConfig({ ...autoGenConfig, minIntervalMs: Number(event.target.value) })}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Final segments per run</label>
                    <input
                      type="number"
                      min={1}
                      value={autoGenConfig.finalSegmentBatchSize}
                      onChange={(event) => setAutoGenConfig({ ...autoGenConfig, finalSegmentBatchSize: Number(event.target.value) })}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => onSaveAutoGenerationConfig(autoGenConfig)}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                  >
                    Save Diagnostics Settings
                  </button>
                </div>
              </div>
              <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg space-y-3">
                <div className="font-medium text-gray-800 dark:text-gray-200">Diagnostics actions</div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Export a redacted diagnostics bundle or reset local app state for testing.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={onExportDiagnostics}
                    className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900"
                  >
                    Export Diagnostics Bundle
                  </button>
                  <button
                    onClick={async () => {
                      const confirmed = window.confirm('Reset app state? This clears local sessions and cached settings.');
                      if (!confirmed) return;
                      const includeSecureStorage = window.confirm('Also clear secure storage credentials? This removes saved API keys.');
                      await onResetAppState({ includeSecureStorage });
                    }}
                    className="px-4 py-2 text-sm font-medium text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900"
                  >
                    Reset App State
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between flex-wrap gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                await onClearApiConfig();
                setApiKey('');
              }}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Clear Key
            </button>
            <button
              onClick={async () => {
                await onClearSttConfig();
                setSttApiKey('');
              }}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Clear Transcription Key
            </button>
            <button
              onClick={async () => {
                await onClearAllCredentials();
                setApiKey('');
                setSttApiKey('');
              }}
              className="px-4 py-2 text-sm font-medium text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900"
            >
              Clear All Credentials
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
