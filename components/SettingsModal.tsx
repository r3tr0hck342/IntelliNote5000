import React, { useMemo, useState, useEffect } from 'react';
import SetupGuideCard from './SetupGuideCard';
import { AI_SETUP_GUIDES, STT_SETUP_GUIDES } from '../services/setupGuides';
import { openExternal } from '../utils/openExternal';
import { XIcon, BrainIcon, SunIcon, MoonIcon } from './icons';
import { ApiConfig } from '../utils/apiConfig';
import { ProviderId } from '../types/ai';
import { ProviderMetadata } from '../services/providers/types';
import { SttConfig, SttProviderId } from '../types/stt';
import { SttProviderMetadata, WHISPER_ENDPOINT_PRESETS } from '../services/stt';
import type { AutoGenerationConfig } from '../utils/autoGenerationConfig';
import { getBuildLabel } from '../utils/buildLabel';
import { getPlatformInfo } from '../utils/diagnosticsBundle';

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
  // On-device speed tier (desktop only): undefined = web build, null = not measured yet.
  const [deviceTier, setDeviceTier] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<{ tier: string } | null>('transcription_tier'))
      .then(result => setDeviceTier(result?.tier ?? null))
      .catch(() => setDeviceTier(null));
  }, []);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(apiConfig?.provider ?? defaultProvider);
  const [apiKey, setApiKey] = useState(apiConfig?.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(apiConfig?.baseUrl ?? '');
  const [model, setModel] = useState(apiConfig?.model ?? '');
  const [advancedModel, setAdvancedModel] = useState(apiConfig?.advancedModel ?? '');
  const [selectedSttProvider, setSelectedSttProvider] = useState<SttProviderId>(sttConfig?.provider ?? defaultSttProvider);
  const [sttApiKey, setSttApiKey] = useState(sttConfig?.apiKey ?? '');
  const [sttBaseUrl, setSttBaseUrl] = useState(sttConfig?.baseUrl ?? '');
  const [sttLanguage, setSttLanguage] = useState(sttConfig?.language ?? '');
  const [sttModel, setSttModel] = useState(sttConfig?.model ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingStt, setIsSavingStt] = useState(false);
  const [autoGenConfig, setAutoGenConfig] = useState(autoGenerationConfig);
  const buildLabel = getBuildLabel();
  const platformInfo = getPlatformInfo();

  // Switching provider shows that provider's saved values, never another provider's key or model.
  const selectProvider = (id: ProviderId) => {
    const saved = apiConfig?.provider === id ? apiConfig : null;
    setSelectedProvider(id);
    setApiKey(saved?.apiKey ?? '');
    setBaseUrl(saved?.baseUrl ?? '');
    setModel(saved?.model ?? '');
    setAdvancedModel(saved?.advancedModel ?? '');
  };

  const selectSttProvider = (id: SttProviderId) => {
    const saved = sttConfig?.provider === id ? sttConfig : null;
    setSelectedSttProvider(id);
    setSttApiKey(saved?.apiKey ?? '');
    setSttBaseUrl(saved?.baseUrl ?? '');
    setSttLanguage(saved?.language ?? '');
    setSttModel(saved?.model ?? '');
  };

  useEffect(() => {
    setSelectedProvider(apiConfig?.provider ?? defaultProvider);
    setApiKey(apiConfig?.apiKey ?? '');
    setBaseUrl(apiConfig?.baseUrl ?? '');
    setModel(apiConfig?.model ?? '');
    setAdvancedModel(apiConfig?.advancedModel ?? '');
  }, [apiConfig, defaultProvider]);

  useEffect(() => {
    setSelectedSttProvider(sttConfig?.provider ?? defaultSttProvider);
    setSttApiKey(sttConfig?.apiKey ?? '');
    setSttBaseUrl(sttConfig?.baseUrl ?? '');
    setSttLanguage(sttConfig?.language ?? '');
    setSttModel(sttConfig?.model ?? '');
  }, [sttConfig, defaultSttProvider]);

  useEffect(() => {
    setAutoGenConfig(autoGenerationConfig);
  }, [autoGenerationConfig]);

  if (!isOpen) return null;

  const selectedMetadata = availableProviders.find(p => p.id === selectedProvider) || availableProviders[0];
  const requiresBaseUrl = Boolean(selectedMetadata?.allowsCustomBaseUrl);
  const keyRequired = selectedMetadata?.requiresApiKey ?? true;
  const canSaveApi = !keyRequired || apiKey.trim().length > 0;
  const selectedSttMetadata = availableSttProviders.find(p => p.id === selectedSttProvider) || availableSttProviders[0];
  const sttKeyRequired = selectedSttMetadata?.requiresApiKey ?? true;
  const canSaveStt = !sttKeyRequired || sttApiKey.trim().length > 0;
  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
  const freeBadge = <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">Free</span>;

  const handleSave = async () => {
    if (!canSaveApi) return;
    setIsSaving(true);
    try {
      await onSaveApiConfig({
        provider: selectedProvider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        advancedModel: advancedModel.trim() || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStt = async () => {
    if (!canSaveStt) return;
    setIsSavingStt(true);
    try {
      await onSaveSttConfig({
        provider: selectedSttProvider,
        apiKey: sttApiKey.trim(),
        baseUrl: selectedSttMetadata?.allowsCustomBaseUrl ? sttBaseUrl.trim() || undefined : undefined,
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
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Writes your notes, flashcards and answers. Free options: Gemini, OpenRouter, Mistral, or Ollama (runs on this computer). Your transcript is sent to the provider you pick, except Ollama.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              IntelliNote runs on your own credentials. Pick a provider, paste its key, and optionally choose models. Options marked Free cost nothing. Keys are stored in secure storage on native builds; browser storage is optional and must be enabled below.
            </p>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => selectProvider(e.target.value as ProviderId)}
                  className={inputClass}
                >
                  {availableProviders.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}{provider.isFree ? ' (Free)' : ''}
                    </option>
                  ))}
                </select>
                {selectedMetadata && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <p>{selectedMetadata.description}{selectedMetadata.isFree && freeBadge}</p>
                    <button type="button" onClick={() => void openExternal(selectedMetadata.docsUrl)} className="text-indigo-500 hover:underline">
                      Models & documentation ↗
                    </button>
                    {AI_SETUP_GUIDES[selectedMetadata.id] && <SetupGuideCard guide={AI_SETUP_GUIDES[selectedMetadata.id]} />}
                  </div>
                )}
              </div>
              <div>
                <label className={labelClass}>{selectedMetadata?.keyLabel ?? 'API Key'}{!keyRequired && ' (optional)'}</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={selectedMetadata?.placeholder ?? 'Paste your API key'}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    type="text"
                    list="ai-model-suggestions"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={selectedMetadata?.defaultModel}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Intelligence Mode model</label>
                  <input
                    type="text"
                    list="ai-model-suggestions"
                    value={advancedModel}
                    onChange={(e) => setAdvancedModel(e.target.value)}
                    placeholder={selectedMetadata?.defaultAdvancedModel}
                    className={inputClass}
                  />
                </div>
                <datalist id="ai-model-suggestions">
                  {selectedMetadata?.suggestedModels.map(id => <option key={id} value={id} />)}
                </datalist>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">Pick a suggestion or type any model ID the provider offers. Leave empty to use the default shown.</p>
              {requiresBaseUrl && (
                <div>
                  <label className={labelClass}>Base URL (optional)</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={selectedMetadata?.defaultBaseUrl}
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Your API key is sent to this URL. Only enter endpoints you trust; plain http:// is allowed only for localhost.</p>
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
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              <strong>Desktop app: you don&apos;t need this.</strong> The Live tab transcribes on this computer: free, unlimited, no account, and audio never leaves the device (speech models download once, about 1.2 GB).
              Cloud free tiers all have limits (Groq: hourly/daily caps; Deepgram: one-time credit). If you hit them, switch to on-device, or use a paid option (OpenAI preset or Deepgram, pay per minute). Cloud providers receive your audio.
            </p>
            {deviceTier !== undefined && (
              <p className="text-sm mb-3 text-gray-700 dark:text-gray-300" role="status">
                <span className="font-medium">This computer: </span>
                {deviceTier === null ? 'speed not measured yet (open the Live tab once).'
                  : deviceTier === 'below-floor' ? 'too slow for live text; it records first and transcribes after you stop (still free and unlimited).'
                  : `can transcribe live on its own (${deviceTier === 'high' ? 'fast' : 'standard'}).`}
              </p>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Powers live lecture transcription. Separate from your AI provider. Whisper is free: use Groq&apos;s free tier, or run an open-source Whisper server on your own computer.
            </p>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Provider</label>
                <select
                  value={selectedSttProvider}
                  onChange={(e) => selectSttProvider(e.target.value as SttProviderId)}
                  className={inputClass}
                >
                  {availableSttProviders.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}{provider.isFree ? ' (Free)' : ''}
                    </option>
                  ))}
                </select>
                {selectedSttMetadata && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <p>{selectedSttMetadata.description}{selectedSttMetadata.isFree && freeBadge}</p>
                    <button type="button" onClick={() => void openExternal(selectedSttMetadata.docsUrl)} className="text-indigo-500 hover:underline">
                      Provider documentation ↗
                    </button>
                    {STT_SETUP_GUIDES[selectedSttMetadata.id] && <SetupGuideCard guide={STT_SETUP_GUIDES[selectedSttMetadata.id]} />}
                  </div>
                )}
              </div>
              {selectedSttMetadata?.allowsCustomBaseUrl && (
                <div>
                  <label className={labelClass}>Endpoint</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {WHISPER_ENDPOINT_PRESETS.map(preset => (
                      <button
                        key={preset.baseUrl}
                        type="button"
                        onClick={() => { setSttBaseUrl(preset.baseUrl); setSttModel(preset.model); }}
                        className={`px-3 py-1 text-xs rounded-md border ${(sttBaseUrl || selectedSttMetadata.defaultBaseUrl) === preset.baseUrl ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={sttBaseUrl}
                    onChange={(e) => setSttBaseUrl(e.target.value)}
                    placeholder={selectedSttMetadata.defaultBaseUrl}
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Your API key is sent to this URL. Only enter endpoints you trust; plain http:// is allowed only for localhost.</p>
                </div>
              )}
              <div>
                <label className={labelClass}>{selectedSttMetadata?.keyLabel ?? 'API Key'}{!sttKeyRequired && ' (optional)'}</label>
                <input
                  type="password"
                  value={sttApiKey}
                  onChange={(e) => setSttApiKey(e.target.value)}
                  placeholder={selectedSttMetadata?.placeholder ?? 'Paste your transcription API key'}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Language (optional)</label>
                  <input
                    type="text"
                    value={sttLanguage}
                    onChange={(e) => setSttLanguage(e.target.value)}
                    placeholder="en-US"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Model (optional)</label>
                  <input
                    type="text"
                    list="stt-model-suggestions"
                    value={sttModel}
                    onChange={(e) => setSttModel(e.target.value)}
                    placeholder={selectedSttMetadata?.defaultModel}
                    className={inputClass}
                  />
                  <datalist id="stt-model-suggestions">
                    {selectedSttMetadata?.suggestedModels.map(id => <option key={id} value={id} />)}
                  </datalist>
                </div>
              </div>
              {selectedSttMetadata?.notes && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{selectedSttMetadata.notes}</p>
              )}
              <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between">
                <span className="font-medium text-gray-800 dark:text-gray-200">Transcription Status:</span>
                {canSaveStt ? (
                  <span className="text-green-600 dark:text-green-400 font-semibold px-2 py-1 bg-green-100 dark:bg-green-900 rounded-md">Ready to save</span>
                ) : (
                  <span className="text-yellow-600 dark:text-yellow-400 font-semibold px-2 py-1 bg-yellow-100 dark:bg-yellow-900 rounded-md">Missing key</span>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveStt}
                  disabled={!canSaveStt || isSavingStt}
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

          <section>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">About</h3>
            <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg space-y-2">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Build Label</div>
              <div className="text-sm font-mono text-gray-800 dark:text-gray-200 break-all">{buildLabel}</div>
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 pt-2">Platform</div>
              <div className="text-sm text-gray-800 dark:text-gray-200">{platformInfo.target}</div>
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
              disabled={!canSaveApi || isSaving}
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
