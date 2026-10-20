export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  needsKey: boolean;
  /** True when the provider exposes a useful /models listing with metadata. */
  hasModelList: boolean;
  note: string;
}

export const AI_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    hasModelList: true,
    note: "Free tier · very fast LPU inference · gpt-oss / llama / qwen models",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    hasModelList: true,
    note: "400+ models from every major lab behind one key · some free",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    hasModelList: true,
    note: "GPT models · full multimodal + tool calling",
  },
  {
    id: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    hasModelList: true,
    note: "Gemini models · strong multimodal (text/image/audio/video)",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    hasModelList: true,
    note: "V3 / R1 · cheap, strong reasoning",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    needsKey: true,
    hasModelList: true,
    note: "Mistral / Pixtral · EU hosted",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    needsKey: true,
    hasModelList: true,
    note: "Open models hosted fast · llama / qwen / flux image gen",
  },
  {
    id: "xai",
    label: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    needsKey: true,
    hasModelList: true,
    note: "Grok models · vision + function calling",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    needsKey: true,
    hasModelList: true,
    note: "Fast open-model hosting + vision",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    needsKey: true,
    hasModelList: true,
    note: "Wafer-scale speed · llama / qwen / gpt-oss",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    hasModelList: true,
    note: "Locally installed models · zero cost, fully offline",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    hasModelList: true,
    note: "Locally hosted GGUF models · zero cost, fully offline",
  },
];

export function presetById(id: string): ProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id);
}
