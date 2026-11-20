import type { ProviderId } from '../types/ai';

/** Plain-language "how do I get this working" steps for each provider in Settings. */
export interface SetupGuide {
  cost: 'Free' | 'Free tier' | 'Free credit' | 'Paid';
  /** Where to create the key (or download the tool). */
  keyUrl: string;
  keyLinkLabel: string;
  steps: string[];
  access?: string;
  command?: string;
  commandAfterStep?: number;
}

export const AI_SETUP_GUIDES: Record<ProviderId, SetupGuide> = {
  gemini: {
    cost: 'Free tier',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyLinkLabel: 'Get a free Gemini key',
    access: 'Hosted API. A Google account is enough to start on eligible free-tier models. Limits apply, and Google may use free-tier content to improve its products.',
    steps: ['Sign into Google AI Studio and create an API key.', 'Paste the key. Keep the default model or choose a free-tier model.', 'Test the connection, then save.'],
  },
  openrouter: {
    cost: 'Free tier',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyLinkLabel: 'Get an OpenRouter key',
    access: 'Hosted API. Free models have daily and per-minute limits. OpenRouter and the selected model provider process your text.',
    steps: ['Sign in and create an OpenRouter API key.', 'Paste the key. Keep openrouter/free or select a model ending in :free.', 'Test the connection, then save.'],
  },
  ollama: {
    cost: 'Free',
    keyUrl: 'https://ollama.com/download',
    keyLinkLabel: 'Download Ollama',
    access: 'Local. No account or per-request fees. Once the model is downloaded, Ollama can generate study materials offline while it is running.',
    steps: ['Install and open Ollama.', 'Use Find models to select an installed model, or Download starter model to install llama3.2 (about 2 GB).', 'Test the connection, then save.'],
  },
  'llama-cpp': {
    cost: 'Free',
    keyUrl: 'https://github.com/ggml-org/llama.cpp/releases',
    keyLinkLabel: 'Get llama.cpp',
    access: 'Local. No account or per-request fees. Requires llama-server and an instruction-tuned GGUF model that fits on your computer.',
    steps: ['Install llama.cpp and download an instruction-tuned GGUF model.', 'In a terminal, replace the model path in this command and run it.', 'Keep the server running. Choose Find models, test the connection, then save.'],
    commandAfterStep: 2,
    command: 'llama-server -m "/path/to/model.gguf" --alias lecture-ai --host 127.0.0.1 --port 8080',
  },
  mistral: {
    cost: 'Free tier',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyLinkLabel: 'Get a Mistral key',
    access: 'Hosted API. Use an eligible free workspace with lower limits or a paid workspace. Your transcript and handouts are processed by Mistral.',
    steps: ['Create a Mistral API workspace and check its plan.', 'Open API Keys → Create new key.', 'Paste the key below and save.'],
  },
  anthropic: {
    cost: 'Paid',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyLinkLabel: 'Get a Claude API key',
    access: 'Hosted API with separate API billing. A Claude chat subscription does not provide an API key.',
    steps: ['Create an account on the Claude Platform.', 'Add credit under Billing (pay as you go).', 'Create a key under API Keys, paste it below, and save.'],
  },
  openai: {
    cost: 'Paid',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLinkLabel: 'Get an OpenAI key',
    access: 'Hosted API with separate API billing. ChatGPT subscriptions do not cover API usage.',
    steps: ['Sign in to the OpenAI Platform.', 'Add credit under Billing.', 'Create a secret key, paste it below, and save.'],
  },
  deepseek: {
    cost: 'Paid',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyLinkLabel: 'Get a DeepSeek key',
    access: 'Hosted API billed through your DeepSeek Platform balance.',
    steps: ['Create a DeepSeek Platform account.', 'Top up a small balance.', 'Create an API key, paste it below, and save.'],
  },
  xai: {
    cost: 'Paid',
    keyUrl: 'https://console.x.ai',
    keyLinkLabel: 'Get an xAI key',
    access: 'Hosted API with separate xAI console billing.',
    steps: ['Sign in to the xAI console.', 'Add credit, then create an API key.', 'Paste the key below and save.'],
  },
};

export const STT_SETUP_GUIDES: Record<string, SetupGuide> = {
  whisper: {
    cost: 'Free tier',
    keyUrl: 'https://console.groq.com/keys',
    keyLinkLabel: 'Get a free Groq key',
    steps: [
      'Free cloud: create a Groq account, then API Keys → Create API Key. Paste it below with the "Groq" preset. The free tier has hourly and daily limits.',
      'Paid, no daily limit: use the "OpenAI" preset with an OpenAI key (platform.openai.com/api-keys, pay per minute of audio).',
      'Self-host (free, unlimited, no key): run a Whisper server such as speaches and pick the "Local Whisper server" preset.',
    ],
  },
  deepgram: {
    cost: 'Free credit',
    keyUrl: 'https://console.deepgram.com/signup',
    keyLinkLabel: 'Get a Deepgram key',
    steps: ['Sign up (new accounts get free credit).', 'In your project, open API Keys → Create a New API Key.', 'Paste the key below and save.'],
  },
};
