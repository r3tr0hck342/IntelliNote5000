/** Plain-language "how do I get this working" steps for each provider in Settings. */
export interface SetupGuide {
  cost: 'Free' | 'Free tier' | 'Free credit' | 'Paid';
  /** Where to create the key (or download the tool). */
  keyUrl: string;
  keyLinkLabel: string;
  steps: string[];
}

export const AI_SETUP_GUIDES: Record<string, SetupGuide> = {
  gemini: {
    cost: 'Free tier',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyLinkLabel: 'Get a free Gemini key',
    steps: ['Sign in with a Google account.', 'Click "Create API key".', 'Paste the key below and save.'],
  },
  openrouter: {
    cost: 'Free tier',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyLinkLabel: 'Get an OpenRouter key',
    steps: ['Create a free OpenRouter account.', 'Open Settings → Keys → Create key.', 'Paste the key below and pick a model ending in ":free".'],
  },
  ollama: {
    cost: 'Free',
    keyUrl: 'https://ollama.com/download',
    keyLinkLabel: 'Download Ollama',
    steps: ['Install Ollama (runs AI on this computer, no account).', 'In a terminal run: ollama pull llama3.2', 'Leave the key empty and save. Ollama must be running.'],
  },
  mistral: {
    cost: 'Free tier',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyLinkLabel: 'Get a Mistral key',
    steps: ['Create a Mistral account and choose the free plan.', 'Open API Keys → Create new key.', 'Paste the key below and save.'],
  },
  anthropic: {
    cost: 'Paid',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyLinkLabel: 'Get a Claude API key',
    steps: ['Create an account on the Claude Platform.', 'Add credit under Billing (pay as you go).', 'Create a key under API Keys, paste it below, and save.'],
  },
  openai: {
    cost: 'Paid',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLinkLabel: 'Get an OpenAI key',
    steps: ['Create an OpenAI Platform account (separate from ChatGPT Plus).', 'Add credit under Billing.', 'Create a secret key, paste it below, and save.'],
  },
  deepseek: {
    cost: 'Paid',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyLinkLabel: 'Get a DeepSeek key',
    steps: ['Create a DeepSeek Platform account.', 'Top up a small balance.', 'Create an API key, paste it below, and save.'],
  },
  xai: {
    cost: 'Paid',
    keyUrl: 'https://console.x.ai',
    keyLinkLabel: 'Get an xAI key',
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
