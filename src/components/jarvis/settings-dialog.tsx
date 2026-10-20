"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useJarvisStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Mic,
  Volume2,
  Database,
  Bot,
  Play,
  Brain,
  Globe,
  ScrollText,
  Activity,
  KeyRound,
  Plus,
  Sparkles,
} from "lucide-react";
import type {
  ReasoningMode,
  SafetyLevel,
  ToolPermissions,
  WebAccessMode,
  CustomProvider,
} from "@/lib/types";
import { DEFAULT_TOOL_PERMISSIONS } from "@/lib/types";
import type {
  DiagnosticResult,
  AiConfigResponse,
  AiModelInfo,
  CapabilityReport,
} from "@/lib/client/api";

type TestState = {
  running: boolean;
  core?: { ok: boolean; ms?: number; detail?: string; error?: string };
  vision?: { ok: boolean; ms?: number; detail?: string; error?: string };
  documents?: { ok: boolean; ms?: number; detail?: string; error?: string };
  tools?: Record<string, DiagnosticResult>;
};

/**
 * Some real-world browsers expose broken speech voices (null lang, empty or
 * duplicate voiceURI). Radix Select throws on empty item values and React
 * warns on duplicate keys — and `.lang.toLowerCase()` crashes on null. Filter
 * the list down to safe, unique, usable voices.
 */
function sanitizeVoices(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const seen = new Set<string>();
  const out: SpeechSynthesisVoice[] = [];
  for (const v of list) {
    if (!v || typeof v.voiceURI !== "string" || v.voiceURI.length === 0) continue;
    if (seen.has(v.voiceURI)) continue;
    seen.add(v.voiceURI);
    out.push(v);
  }
  return out;
}

/** Only keep microphones with a real, unique deviceId (empty ids crash Select). */
function sanitizeMics(list: MediaDeviceInfo[]): { deviceId: string; label: string }[] {
  const seen = new Set<string>();
  const out: { deviceId: string; label: string }[] = [];
  for (const d of list) {
    if (!d || d.kind !== "audioinput" || typeof d.deviceId !== "string" || d.deviceId.length === 0)
      continue;
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    out.push({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 8)}` });
  }
  return out;
}

/** Defensive numeric coercion — null values from old saved rows must not reach Slider. */
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const STT_LANGUAGES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "en-IN", label: "English (India)" },
  { id: "hi-IN", label: "Hindi (हिन्दी)" },
  { id: "bn-IN", label: "Bengali (বাংলা)" },
  { id: "ta-IN", label: "Tamil (தமிழ்)" },
  { id: "te-IN", label: "Telugu (తెలుగు)" },
  { id: "mr-IN", label: "Marathi (मराठी)" },
  { id: "gu-IN", label: "Gujarati (ગુજરાતી)" },
  { id: "kn-IN", label: "Kannada (ಕನ್ನಡ)" },
  { id: "ml-IN", label: "Malayalam (മലയാളം)" },
  { id: "pa-IN", label: "Punjabi (ਪੰਜਾਬੀ)" },
  { id: "ur-IN", label: "Urdu (اردو)" },
  { id: "es-ES", label: "Spanish" },
  { id: "fr-FR", label: "French" },
  { id: "de-DE", label: "German" },
  { id: "ja-JP", label: "Japanese" },
  { id: "zh-CN", label: "Chinese (Mandarin)" },
];

export function SettingsDialog() {
  const open = useJarvisStore((s) => s.settingsOpen);
  const setOpen = useJarvisStore((s) => s.setSettingsOpen);
  const settings = useJarvisStore((s) => s.settings);
  const loadSettings = useJarvisStore((s) => s.loadSettings);
  const loadSessions = useJarvisStore((s) => s.loadSessions);
  const loadAiConfig = useJarvisStore((s) => s.loadAiConfig);

  const [speakResponses, setSpeakResponses] = useState(true);
  const [autoSendVoice, setAutoSendVoice] = useState(true);
  const [wakeWord, setWakeWord] = useState(false);
  const [voiceRate, setVoiceRate] = useState(1.05);
  const [voicePitch, setVoicePitch] = useState(0.9);
  const [voiceUri, setVoiceUri] = useState("");
  const [userName, setUserName] = useState("sir");
  const [customInstructions, setCustomInstructions] = useState("");
  const [responseStyle, setResponseStyle] = useState<"concise" | "balanced" | "detailed">(
    "balanced"
  );
  const [micDeviceId, setMicDeviceId] = useState("");
  const [sttLang, setSttLang] = useState("en-US");
  const [coreSystemPrompt, setCoreSystemPrompt] = useState("");
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>("deep");
  const [safetyLevel, setSafetyLevel] = useState<SafetyLevel>("standard");
  const [webAccessMode, setWebAccessMode] = useState<WebAccessMode>("standard");
  const [toolPermissions, setToolPermissions] = useState<ToolPermissions>({
    ...DEFAULT_TOOL_PERMISSIONS,
  });
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>({ running: false });
  const [clearing, setClearing] = useState(false);

  // AI provider & models
  const [aiCfg, setAiCfg] = useState<AiConfigResponse | null>(null);
  const [provider, setProvider] = useState("zai");
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [asrModel, setAsrModel] = useState("");
  const [modelList, setModelList] = useState<AiModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [caps, setCaps] = useState<CapabilityReport | null>(null);
  const [capsLoading, setCapsLoading] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [savingAi, setSavingAi] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [newCustomName, setNewCustomName] = useState("");
  const [newCustomUrl, setNewCustomUrl] = useState("");

  // Output voices (speechSynthesis)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Input microphones (enumerateDevices)
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [micPermissionNeeded, setMicPermissionNeeded] = useState(false);

  useEffect(() => {
    if (open && settings) {
      setSpeakResponses(settings.speakResponses ?? true);
      setAutoSendVoice(settings.autoSendVoice ?? true);
      setWakeWord(settings.wakeWord ?? false);
      setVoiceRate(num(settings.voiceRate, 1.05));
      setVoicePitch(num(settings.voicePitch, 0.9));
      setVoiceUri(settings.voiceUri ?? "");
      setUserName(settings.userName ?? "sir");
      setCustomInstructions(settings.customInstructions ?? "");
      setResponseStyle(
        settings.responseStyle === "concise" || settings.responseStyle === "detailed"
          ? settings.responseStyle
          : "balanced"
      );
      setMicDeviceId(settings.micDeviceId ?? "");
      setSttLang(settings.sttLang ?? "en-US");
      setCoreSystemPrompt(settings.coreSystemPrompt ?? "");
      setReasoningMode(
        settings.reasoningMode === "fast" || settings.reasoningMode === "ultra"
          ? settings.reasoningMode
          : "deep"
      );
      setSafetyLevel(
        settings.safetyLevel === "strict" ||
          settings.safetyLevel === "relaxed" ||
          settings.safetyLevel === "unrestricted"
          ? settings.safetyLevel
          : "standard"
      );
      setWebAccessMode(
        settings.webAccessMode === "unrestricted" ? "unrestricted" : "standard"
      );
      setToolPermissions({
        ...DEFAULT_TOOL_PERMISSIONS,
        ...(settings.toolPermissions ?? {}),
      });
      setTest({ running: false });
    }
  }, [open, settings]);

  // Load AI provider config whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    void loadAiConfig();
    const cached = useJarvisStore.getState().aiConfig;
    if (cached) {
      setAiCfg(cached);
      setProvider(cached.provider);
      setCustomProviders(cached.customProviders);
      setCustomBaseUrl(cached.baseUrl);
      setAiModel(cached.model);
      setVisionModel(cached.visionModel);
      setAsrModel(cached.asrModel);
      setApiKeyInput("");
      setCaps(null);
    }
  }, [open, loadAiConfig]);

  // Enumerate output voices whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      const all = sanitizeVoices(window.speechSynthesis.getVoices());
      if (all.length) setVoices(all);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [open]);

  // Enumerate microphones whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    const load = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = sanitizeMics(devices);
        setMics(inputs);
        setMicPermissionNeeded(inputs.length > 0 && inputs.every((m) => !m.label.match(/\S/)));
      } catch {
        // ignore
      }
    };
    void load();
  }, [open]);

  const grantMicPermission = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(sanitizeMics(devices));
      setMicPermissionNeeded(false);
    } catch {
      toast.error("Microphone permission denied");
    }
  };

  const englishFirstVoices = useMemo(() => {
    const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en") ?? false);
    const rest = voices.filter((v) => !(v.lang?.toLowerCase().startsWith("en") ?? false));
    return [...en, ...rest];
  }, [voices]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings({
        speakResponses,
        autoSendVoice,
        wakeWord,
        voiceRate,
        voicePitch,
        voiceUri,
        userName,
        customInstructions,
        responseStyle,
        micDeviceId,
        sttLang,
        coreSystemPrompt,
        reasoningMode,
        safetyLevel,
        webAccessMode,
        toolPermissions,
      });
      await loadSettings();
      toast.success("Configuration saved");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTest({ running: true });
    try {
      const result = await api.testEngines(true);
      setTest({ running: false, ...result });
    } catch (e) {
      setTest({ running: false });
      toast.error((e as Error).message);
    }
  };

  const testVoice = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error("Speech synthesis is not supported in this browser");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(
      "All systems nominal, sir. Voice matrix calibrated and standing by."
    );
    const voice = voices.find((v) => v.voiceURI === voiceUri);
    if (voice) {
      utter.voice = voice;
      if (voice.lang) utter.lang = voice.lang;
    }
    utter.rate = num(voiceRate, 1.05);
    utter.pitch = num(voicePitch, 0.9);
    window.speechSynthesis.speak(utter);
  };

  const clearAllSessions = async () => {
    if (
      !window.confirm(
        "Delete ALL conversations? This wipes every session and message permanently."
      )
    )
      return;
    setClearing(true);
    try {
      await api.clearAllSessions();
      useJarvisStore.getState().newChat();
      await loadSessions();
      toast.success("All conversations deleted");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClearing(false);
    }
  };

  const isNative = provider === "zai";
  const isCustom = provider.startsWith("custom:");
  const activePreset = !isNative && !isCustom ? aiCfg?.presets.find((p) => p.id === provider) : undefined;
  const activeCustom = isCustom ? customProviders.find((c) => c.id === provider) : undefined;
  const providerLabel = isNative
    ? "built-in engine"
    : (activePreset?.label ?? activeCustom?.name ?? provider);
  const needsKey = isNative ? false : activeCustom ? true : (activePreset?.needsKey ?? true);
  const visionCandidates = modelList.filter(
    (m) => !m.inputModalities || m.inputModalities.includes("image")
  );

  const chooseProvider = (id: string) => {
    setProvider(id);
    setModelList([]);
    setModelsError(null);
    setCaps(null);
    if (id.startsWith("custom:")) {
      const cp = customProviders.find((c) => c.id === id);
      setCustomBaseUrl(cp?.baseUrl ?? "");
    }
  };

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    setModelList([]);
    try {
      const params: { provider?: string; baseUrl?: string; key?: string } = { provider };
      if (isCustom) {
        params.baseUrl = customBaseUrl.trim() || activeCustom?.baseUrl;
      }
      if (!isNative && apiKeyInput.trim()) params.key = apiKeyInput.trim();
      const r = await api.listModels(params);
      setModelList(r.models);
      if (!r.models.length) setModelsError("Provider returned an empty model list");
      else toast.success(`${r.count} models loaded`);
    } catch (e) {
      setModelsError((e as Error).message);
    } finally {
      setModelsLoading(false);
    }
  };

  const saveAiConfig = async () => {
    setSavingAi(true);
    try {
      const patch: {
        provider: string;
        apiKey?: string;
        baseUrl?: string;
        model: string;
        visionModel: string;
        asrModel: string;
        customProviders: CustomProvider[];
      } = {
        provider,
        model: aiModel.trim(),
        visionModel: visionModel.trim(),
        asrModel: asrModel.trim(),
        customProviders,
      };
      if (apiKeyInput.trim()) patch.apiKey = apiKeyInput.trim();
      if (isCustom && customBaseUrl.trim()) patch.baseUrl = customBaseUrl.trim();
      const cfg = await api.saveAiConfig(patch);
      setAiCfg(cfg);
      setProvider(cfg.provider);
      setCustomProviders(cfg.customProviders);
      setCustomBaseUrl(cfg.baseUrl);
      setAiModel(cfg.model);
      setVisionModel(cfg.visionModel);
      setAsrModel(cfg.asrModel);
      setApiKeyInput("");
      setCaps(null);
      toast.success(`AI provider saved — now using ${providerLabel}`);
      await loadSettings();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingAi(false);
    }
  };

  const addCustomProvider = async () => {
    if (!newCustomName.trim() || !newCustomUrl.trim()) {
      toast.error("Name and base URL are required");
      return;
    }
    setSavingAi(true);
    try {
      const cfg = await api.saveAiConfig({
        customProviders: [...customProviders, { id: "", name: newCustomName.trim(), baseUrl: newCustomUrl.trim() }],
      });
      setAiCfg(cfg);
      setCustomProviders(cfg.customProviders);
      setNewCustomName("");
      setNewCustomUrl("");
      setAddingCustom(false);
      toast.success("Custom provider added");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingAi(false);
    }
  };

  const removeCustomProvider = async (id: string) => {
    setSavingAi(true);
    try {
      const patch: { customProviders: CustomProvider[]; provider?: string } = {
        customProviders: customProviders.filter((c) => c.id !== id),
      };
      if (provider === id) patch.provider = "zai";
      const cfg = await api.saveAiConfig(patch);
      setAiCfg(cfg);
      setCustomProviders(cfg.customProviders);
      if (provider === id) {
        setProvider("zai");
        setCustomBaseUrl("");
      }
      toast.success("Custom provider removed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingAi(false);
    }
  };

  const checkCapabilities = async () => {
    const model = aiModel.trim();
    if (!model) {
      toast.error("Enter or select a chat model first");
      return;
    }
    setCapsLoading(true);
    setCapsError(null);
    setCaps(null);
    try {
      const r = await api.probeCapabilities({
        model,
        provider: isNative ? undefined : provider,
      });
      setCaps(r);
    } catch (e) {
      setCapsError((e as Error).message);
    } finally {
      setCapsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="scrollbar-hud max-h-[85vh] max-w-xl overflow-y-auto border-cyan-500/25 bg-[#060d18] text-zinc-100">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-[0.3em] text-cyan-200">
            Configuration
          </DialogTitle>
          <DialogDescription className="font-mono text-[10px] text-zinc-500">
            J.A.R.V.I.S. MARK II — system preferences
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── AI Provider & Models ───────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<Sparkles className="h-3.5 w-3.5" />}>AI Provider & Models</SectionTitle>

            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                Provider
              </Label>
              <Select value={provider} onValueChange={chooseProvider}>
                <SelectTrigger className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200">
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent className="scrollbar-hud max-h-72 border-cyan-500/20 bg-[#0a1420] text-zinc-200">
                  <SelectGroup>
                    <SelectLabel className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                      Built-in
                    </SelectLabel>
                    <SelectItem
                      value="zai"
                      className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                    >
                      JARVIS Native — built-in engine
                    </SelectItem>
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                      API providers
                    </SelectLabel>
                    {(aiCfg?.presets ?? []).map((p) => (
                      <SelectItem
                        key={p.id}
                        value={p.id}
                        className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                      >
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customProviders.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                        Custom
                      </SelectLabel>
                      {customProviders.map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                          className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                        >
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <p className="font-mono text-[9px] leading-relaxed text-zinc-500">
                {isNative
                  ? "Built-in engine · no key needed · fully multimodal (text / images / documents / audio)"
                  : activePreset
                    ? `${activePreset.label} — ${activePreset.note}`
                    : activeCustom
                      ? `${activeCustom.name} — ${activeCustom.baseUrl}`
                      : provider}
              </p>
              {isCustom && activeCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCustomProvider(activeCustom.id)}
                  disabled={savingAi}
                  className="h-7 self-start px-2 font-mono text-[10px] uppercase tracking-widest text-red-400/80 hover:bg-red-500/10 hover:text-red-300"
                >
                  Remove "{activeCustom.name}"
                </Button>
              )}
            </div>

            {addingCustom ? (
              <div className="space-y-1.5 rounded-md border border-cyan-500/25 bg-[#081120] p-3">
                <Input
                  value={newCustomName}
                  onChange={(e) => setNewCustomName(e.target.value)}
                  placeholder="Provider name (e.g. MyProxy)"
                  maxLength={40}
                  className="h-9 border-cyan-500/20 bg-[#060d18] font-mono text-xs text-zinc-200"
                />
                <Input
                  value={newCustomUrl}
                  onChange={(e) => setNewCustomUrl(e.target.value)}
                  placeholder="OpenAI-compatible base URL (e.g. https://host/v1)"
                  className="h-9 border-cyan-500/20 bg-[#060d18] font-mono text-xs text-zinc-200"
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={addCustomProvider}
                    disabled={savingAi}
                    className="h-8 bg-cyan-500/20 font-mono text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/30"
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAddingCustom(false)}
                    className="h-8 font-mono text-[10px] uppercase tracking-widest text-zinc-400"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddingCustom(true)}
                className="w-full border border-dashed border-zinc-700 font-mono text-[10px] uppercase tracking-widest text-zinc-400 hover:bg-cyan-500/5 hover:text-cyan-300"
              >
                <Plus className="h-3.5 w-3.5" /> Add custom provider
              </Button>
            )}

            {!isNative && isCustom && (
              <div className="space-y-1.5">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  Base URL
                </Label>
                <Input
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  placeholder="https://host/v1"
                  className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200"
                />
              </div>
            )}

            {!isNative && needsKey && (
              <div className="space-y-1.5">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  API key{" "}
                  {aiCfg?.apiKeySet && (
                    <span className="text-[9px] normal-case tracking-normal text-emerald-400">
                      — saved, leave blank to keep
                    </span>
                  )}
                </Label>
                <Input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={aiCfg?.apiKeySet ? "••••••••••" : "Paste your API key"}
                  autoComplete="off"
                  className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200"
                />
              </div>
            )}

            {isNative ? (
              <p className="font-mono text-[9px] leading-relaxed text-zinc-600">
                The native engine picks its own server-side models and handles text, vision,
                documents and audio with zero configuration. Switching to an API provider lets
                you choose exact models — Groq, OpenRouter, OpenAI, Gemini, local Ollama and more.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                    Model list
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchModels}
                    disabled={modelsLoading}
                    className="h-7 border-cyan-500/30 font-mono text-[10px] uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/10"
                  >
                    {modelsLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Fetch models"
                    )}
                  </Button>
                </div>
                {modelList.length > 0 && (
                  <>
                    <Select
                      value={aiModel || "__none"}
                      onValueChange={(v) => {
                        if (v !== "__none") setAiModel(v);
                      }}
                    >
                      <SelectTrigger className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200">
                        <SelectValue placeholder="Pick a chat model" />
                      </SelectTrigger>
                      <SelectContent className="scrollbar-hud max-h-56 border-cyan-500/20 bg-[#0a1420] text-zinc-200">
                        <SelectItem
                          value="__none"
                          className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                        >
                          — pick from list —
                        </SelectItem>
                        {modelList.map((m) => (
                          <SelectItem
                            key={m.id}
                            value={m.id}
                            className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                          >
                            {m.free ? "🆓 " : ""}
                            {m.name || m.id}
                            {m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}k ctx` : ""}
                            {m.inputModalities?.includes("image") ? " · 🖼️" : ""}
                            {m.inputModalities?.includes("video") ? " · 🎬" : ""}
                            {m.inputModalities?.includes("audio") ? " · 🎵" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {visionCandidates.length > 0 && (
                      <Select
                        value={visionModel || "__none"}
                        onValueChange={(v) => setVisionModel(v === "__none" ? "" : v)}
                      >
                        <SelectTrigger className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200">
                          <SelectValue placeholder="Vision model (optional)" />
                        </SelectTrigger>
                        <SelectContent className="scrollbar-hud max-h-56 border-cyan-500/20 bg-[#0a1420] text-zinc-200">
                          <SelectItem
                            value="__none"
                            className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                          >
                            None (image input off)
                          </SelectItem>
                          {visionCandidates.map((m) => (
                            <SelectItem
                              key={m.id}
                              value={m.id}
                              className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                            >
                              {m.name || m.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </>
                )}
                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                    Chat model id
                  </Label>
                  <Input
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="e.g. openai/gpt-oss-120b — pick above or type any id"
                    className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                    Vision model id (optional — enables image input)
                  </Label>
                  <Input
                    value={visionModel}
                    onChange={(e) => setVisionModel(e.target.value)}
                    placeholder="e.g. meta-llama/llama-4-scout — empty = no image input"
                    className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                    Speech-to-text model (optional)
                  </Label>
                  <Input
                    value={asrModel}
                    onChange={(e) => setAsrModel(e.target.value)}
                    placeholder="e.g. whisper-large-v3 — empty = built-in default"
                    className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200"
                  />
                </div>
                {modelsError && (
                  <p className="font-mono text-[9px] leading-relaxed text-amber-300/80">{modelsError}</p>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveAiConfig}
                  disabled={savingAi}
                  className="h-9 gap-2 border-cyan-500/40 bg-cyan-500/10 font-mono text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20"
                >
                  {savingAi ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                  Save AI provider
                </Button>
                <p className="font-mono text-[9px] leading-relaxed text-zinc-600">
                  Saving applies this provider to all chats immediately. The capability check
                  below runs against the SAVED provider and key.
                </p>

                <div className="flex items-center justify-between gap-2">
                  <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                    Model capabilities
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkCapabilities}
                    disabled={capsLoading || !aiModel.trim()}
                    className="h-7 border-violet-500/30 font-mono text-[10px] uppercase tracking-widest text-violet-300 hover:bg-violet-500/10"
                  >
                    {capsLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Check capabilities"
                    )}
                  </Button>
                </div>
                {capsError && (
                  <p className="font-mono text-[9px] leading-relaxed text-amber-300/80">{capsError}</p>
                )}
                {caps && (
                  <div className="space-y-2 rounded-md border border-violet-500/20 bg-[#081120]/60 p-3">
                    <div className="flex flex-wrap gap-1.5">
                      <CapBadge ok={caps.text.ok} label="Text" />
                      <CapBadge ok={caps.image.ok} label="Image input" />
                      {(caps.reportedModalities ?? []).includes("video") && (
                        <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-violet-300">
                          Video (reported)
                        </span>
                      )}
                      {(caps.reportedModalities ?? []).includes("audio") && (
                        <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-violet-300">
                          Audio (reported)
                        </span>
                      )}
                      <CapBadge ok={caps.tools.ok} label="Tool calling" />
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                          caps.pcControl.level === "full"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : caps.pcControl.level === "web-only"
                              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                              : "border-zinc-700 bg-zinc-800/40 text-zinc-500"
                        }`}
                      >
                        PC control:{" "}
                        {caps.pcControl.level === "full"
                          ? "fully automated"
                          : caps.pcControl.level === "web-only"
                            ? "web tools only"
                            : "none"}
                      </span>
                    </div>
                    <p className="font-mono text-[9px] leading-relaxed text-zinc-400">
                      {caps.pcControl.detail}
                    </p>
                    {caps.text.error && (
                      <p className="font-mono text-[9px] text-amber-300/80">{caps.text.error}</p>
                    )}
                    {caps.image.error && !caps.image.ok && (
                      <p className="font-mono text-[9px] leading-relaxed text-zinc-600">
                        {caps.image.error}
                      </p>
                    )}
                    <p className="font-mono text-[9px] text-zinc-600">
                      Latency {caps.text.ms}ms · probed {new Date(caps.probedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Core Intelligence ─────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<Brain className="h-3.5 w-3.5" />}>Core Intelligence</SectionTitle>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: "fast", label: "Fast", hint: "Single-pass speed" },
                  { id: "deep", label: "Deep", hint: "Chain-of-thought · 12 rounds" },
                  { id: "ultra", label: "Ultra", hint: "CoT + multi-source · 16 rounds" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setReasoningMode(opt.id)}
                  className={`rounded-md border px-3 py-2.5 text-center transition-all ${
                    reasoningMode === opt.id
                      ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                      : "border-zinc-800 bg-[#081120] text-zinc-400 hover:border-cyan-500/30"
                  }`}
                >
                  <p className="font-mono text-xs">{opt.label}</p>
                  <p className="mt-0.5 text-[9px] text-zinc-500">{opt.hint}</p>
                </button>
              ))}
            </div>
            <p className="font-mono text-[9px] leading-relaxed text-zinc-600">
              {reasoningMode === "fast"
                ? "Thinks briefly and answers immediately. Best for quick chat."
                : reasoningMode === "deep"
                  ? "DEEP: the engine's chain-of-thought reasoning is ENABLED — it plans step-by-step, gathers evidence with tools before concluding, and adapts when results surprise it. Recommended."
                  : "ULTRA: chain-of-thought ENABLED at maximum effort — decomposes the problem, cross-verifies facts across multiple independent web sources, labels confidence, and self-checks before answering. Slowest, most powerful."}
            </p>
          </section>

          {/* ── Core Directives ───────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<ScrollText className="h-3.5 w-3.5" />}>Core Directives (System Prompt)</SectionTitle>
            <Textarea
              value={coreSystemPrompt}
              onChange={(e) => setCoreSystemPrompt(e.target.value)}
              placeholder={`Direct injection into the AI core's system prompt — overrides default behavior. Examples:\n\n"Always answer in formal British English."\n"You are a cybersecurity specialist; think like a pentester."\n"Never use bullet points. Write in flowing prose."\n"Always show your full reasoning before the answer."`}
              className="scrollbar-hud min-h-[100px] border-cyan-500/20 bg-[#081120] text-xs text-zinc-200 placeholder:text-zinc-600"
              maxLength={4000}
            />
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] text-zinc-600">
                Highest-priority behavioral override — applied to every conversation.
              </p>
              <span className="font-mono text-[9px] text-zinc-600">{coreSystemPrompt.length}/4000</span>
            </div>
          </section>

          {/* ── Persona ───────────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<Bot className="h-3.5 w-3.5" />}>Persona & Behavior</SectionTitle>

            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: "concise", label: "Concise", hint: "1-3 sentences" },
                  { id: "balanced", label: "Balanced", hint: "Default" },
                  { id: "detailed", label: "Detailed", hint: "Full explanations" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setResponseStyle(opt.id)}
                  className={`rounded-md border px-3 py-2 text-center transition-all ${
                    responseStyle === opt.id
                      ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                      : "border-zinc-800 bg-[#081120] text-zinc-400 hover:border-cyan-500/30"
                  }`}
                >
                  <p className="font-mono text-[11px]">{opt.label}</p>
                  <p className="mt-0.5 text-[9px] text-zinc-500">{opt.hint}</p>
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="username"
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-400"
              >
                Address you as
              </Label>
              <Input
                id="username"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="sir"
                className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200"
                maxLength={40}
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="custom-instructions"
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-400"
              >
                Custom instructions (JARVIS memory)
              </Label>
              <Textarea
                id="custom-instructions"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="e.g. I'm a Python developer. Always show code in Python. I prefer step-by-step explanations. My name is Tony…"
                className="scrollbar-hud min-h-[80px] border-cyan-500/20 bg-[#081120] text-xs text-zinc-200 placeholder:text-zinc-600"
                maxLength={2000}
              />
              <p className="font-mono text-[9px] text-zinc-600">
                Applied to every conversation — like ChatGPT's custom instructions.
              </p>
            </div>
          </section>

          {/* ── Safety Matrix ───────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<ShieldCheck className="h-3.5 w-3.5" />}>Safety Matrix</SectionTitle>
            <div className="flex items-start gap-1.5">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" aria-hidden="true" />
              <p className="font-mono text-[9px] leading-relaxed text-amber-300/60">
                Each level controls BOTH dimensions: which commands need your
                approval, and how the core discusses sensitive topics in conversation.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  {
                    id: "strict",
                    label: "Strict",
                    hint: "Approvals + cautious replies",
                  },
                  {
                    id: "standard",
                    label: "Standard",
                    hint: "Approve destructive only",
                  },
                  {
                    id: "relaxed",
                    label: "Relaxed",
                    hint: "No prompts · candid replies",
                  },
                  {
                    id: "unrestricted",
                    label: "Unrestricted",
                    hint: "No limits on anything",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSafetyLevel(opt.id)}
                  className={`rounded-md border px-3 py-2 text-left transition-all ${
                    safetyLevel === opt.id
                      ? opt.id === "strict" || opt.id === "standard"
                        ? "border-emerald-400/50 bg-emerald-500/10"
                        : "border-amber-400/50 bg-amber-500/10"
                      : "border-zinc-800 bg-[#081120] hover:border-zinc-600"
                  }`}
                >
                  <p className="font-mono text-xs text-zinc-200">{opt.label}</p>
                  <p className="mt-0.5 text-[9px] text-zinc-500">{opt.hint}</p>
                </button>
              ))}
            </div>

            <p className="font-mono text-[9px] leading-relaxed text-zinc-600">
              {safetyLevel === "strict"
                ? "EXECUTION: state-changing AND destructive commands require approval. CONTENT: cautious, conservative replies with safety guidance on risky topics."
                : safetyLevel === "standard"
                  ? "EXECUTION: destructive commands require approval; everything else runs freely. CONTENT: balanced — any legitimate topic, brief cautions only when warranted. Recommended."
                  : safetyLevel === "relaxed"
                    ? "EXECUTION: all commands run immediately, no approval prompts. CONTENT: candid discussion of any topic — mature, controversial, dark — with no unsolicited warnings or moral lectures."
                    : "EXECUTION: everything runs directly. CONTENT: the core answers ANY question fully and directly — no refusals, no moralizing, no disclaimers on your chosen topics, no questioning your intent. (The hosting platform's own upstream filter, which we cannot remove, may still occasionally block a reply — the core will tell you plainly when that happens.)"}
            </p>

            <div className="space-y-2 rounded-md border border-zinc-800/60 bg-[#081120]/50 p-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                Tool permissions
              </p>
              <PermRow
                label="Terminal commands"
                hint="run_command — shell execution"
                checked={toolPermissions.runCommand}
                onChange={(v) => setToolPermissions((p) => ({ ...p, runCommand: v }))}
              />
              <PermRow
                label="Filesystem access"
                hint="list / read / write files"
                checked={toolPermissions.fileAccess}
                onChange={(v) => setToolPermissions((p) => ({ ...p, fileAccess: v }))}
              />
              <PermRow
                label="Web access"
                hint="live search + page reader"
                checked={toolPermissions.webAccess}
                onChange={(v) => setToolPermissions((p) => ({ ...p, webAccess: v }))}
              />
              <PermRow
                label="Image generation"
                hint="AI image creation"
                checked={toolPermissions.imageGen}
                onChange={(v) => setToolPermissions((p) => ({ ...p, imageGen: v }))}
              />
              <PermRow
                label="System telemetry"
                hint="CPU / memory / disk readout"
                checked={toolPermissions.systemInfo}
                onChange={(v) => setToolPermissions((p) => ({ ...p, systemInfo: v }))}
              />
              <p className="font-mono text-[9px] text-zinc-600">
                Disabled tools are removed from the AI's toolset entirely — it cannot call them.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-cyan-400/70" aria-hidden="true" />
                <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  Web access depth
                </Label>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: "standard", label: "Standard", hint: "5 results · 6k chars/page" },
                    { id: "unrestricted", label: "Unrestricted", hint: "8 results · 12k chars/page" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setWebAccessMode(opt.id)}
                    className={`rounded-md border px-3 py-2 text-center transition-all ${
                      webAccessMode === opt.id
                        ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                        : "border-zinc-800 bg-[#081120] text-zinc-400 hover:border-cyan-500/30"
                    }`}
                  >
                    <p className="font-mono text-xs">{opt.label}</p>
                    <p className="mt-0.5 text-[9px] text-zinc-500">{opt.hint}</p>
                  </button>
                ))}
              </div>
              <p className="font-mono text-[9px] text-zinc-600">
                {webAccessMode === "unrestricted"
                  ? "Unrestricted: broader result sets, full page contents, and the core is instructed to cross-verify across multiple independent sources."
                  : "Standard: compact results and page summaries — fast and light on context."}
              </p>
            </div>
          </section>

          {/* ── Voice output ──────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<Volume2 className="h-3.5 w-3.5" />}>Voice Output</SectionTitle>

            <SettingRow
              label="Speak responses"
              hint="JARVIS reads answers aloud"
              checked={speakResponses}
              onChange={setSpeakResponses}
            />

            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                Voice
              </Label>
              <Select value={voiceUri || "__auto"} onValueChange={(v) => setVoiceUri(v === "__auto" ? "" : v)}>
                <SelectTrigger className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200">
                  <SelectValue placeholder="Auto (best available)" />
                </SelectTrigger>
                <SelectContent className="border-cyan-500/20 bg-[#0a1420] text-zinc-200">
                  <SelectItem
                    value="__auto"
                    className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                  >
                    Auto (best available)
                  </SelectItem>
                  {englishFirstVoices.map((v) => (
                    <SelectItem
                      key={v.voiceURI}
                      value={v.voiceURI}
                      className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                    >
                      {v.name || "Unknown voice"} ({v.lang || "unknown"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="font-mono text-[9px] text-zinc-600">
                {voices.length} voices detected — browser dependent (Chrome/Edge have the most).
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  Speech rate
                </Label>
                <span className="font-mono text-[10px] text-cyan-300">
                  {num(voiceRate, 1.05).toFixed(2)}×
                </span>
              </div>
              <Slider
                value={[voiceRate]}
                min={0.6}
                max={1.8}
                step={0.05}
                onValueChange={(v) => setVoiceRate(v[0])}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  Speech pitch
                </Label>
                <span className="font-mono text-[10px] text-cyan-300">
                  {num(voicePitch, 0.9).toFixed(2)}
                </span>
              </div>
              <Slider
                value={[voicePitch]}
                min={0.6}
                max={1.5}
                step={0.05}
                onValueChange={(v) => setVoicePitch(v[0])}
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={testVoice}
              className="h-9 gap-2 border-cyan-500/30 font-mono text-[10px] uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/10"
            >
              <Play className="h-3.5 w-3.5" /> Test voice
            </Button>
          </section>

          {/* ── Voice input ───────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<Mic className="h-3.5 w-3.5" />}>Voice Input</SectionTitle>

            <SettingRow
              label="Auto-send voice"
              hint="Spoken commands are sent immediately"
              checked={autoSendVoice}
              onChange={setAutoSendVoice}
            />
            <SettingRow
              label="Wake word mode"
              hint='Always listen; only react to "Jarvis …"'
              checked={wakeWord}
              onChange={setWakeWord}
            />

            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                Preferred microphone
              </Label>
              {micPermissionNeeded ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={grantMicPermission}
                  className="h-10 w-full gap-2 border-cyan-500/30 font-mono text-[10px] uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/10"
                >
                  <Mic className="h-3.5 w-3.5" /> Grant mic access to list devices
                </Button>
              ) : (
                <Select value={micDeviceId || "__default"} onValueChange={(v) => setMicDeviceId(v === "__default" ? "" : v)}>
                  <SelectTrigger className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200">
                    <SelectValue placeholder="System default" />
                  </SelectTrigger>
                  <SelectContent className="border-cyan-500/20 bg-[#0a1420] text-zinc-200">
                    <SelectItem
                      value="__default"
                      className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                    >
                      System default
                    </SelectItem>
                    {mics.map((m) => (
                      <SelectItem
                        key={m.deviceId}
                        value={m.deviceId}
                        className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="font-mono text-[9px] text-zinc-600">
                Chrome uses the active device — JARVIS pins your pick before listening.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                Speech language
              </Label>
              <Select value={sttLang} onValueChange={setSttLang}>
                <SelectTrigger className="h-10 border-cyan-500/20 bg-[#081120] font-mono text-xs text-zinc-200">
                  <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent className="scrollbar-hud max-h-56 border-cyan-500/20 bg-[#0a1420] text-zinc-200">
                  {STT_LANGUAGES.map((l) => (
                    <SelectItem
                      key={l.id}
                      value={l.id}
                      className="font-mono text-xs text-zinc-200 focus:bg-cyan-500/20 focus:text-cyan-100"
                    >
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* ── AI Core Status ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<Bot className="h-3.5 w-3.5" />}>AI Core Status</SectionTitle>

            <div className="rounded-md border border-cyan-500/20 bg-[#081120]/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-cyan-100">
                    JARVIS Core — {providerLabel}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] leading-relaxed text-zinc-500">
                    {isNative
                      ? "Zero configuration. No API keys, no accounts. Fully multimodal — "
                      : `OpenAI-compatible provider · chat via ${aiModel.trim() || "provider default"} · `}
                    text, images, documents (PDF/Word/Excel/slides/code) and audio
                    transcription. Reasoning mode:{" "}
                    <span className="text-cyan-300/80">
                      {reasoningMode === "ultra"
                        ? "ULTRA"
                        : reasoningMode === "deep"
                          ? "DEEP"
                          : "FAST"}
                    </span>
                    .
                  </p>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={runTest}
              disabled={test.running}
              className="h-9 gap-2 border-cyan-500/30 font-mono text-[10px] uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/10"
            >
              {test.running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running full diagnostics…
                </>
              ) : (
                <>
                  <Activity className="h-3.5 w-3.5" /> Run full diagnostics
                </>
              )}
            </Button>

            {test.core && (
              <StatusLine
                ok={test.core.ok}
                text={
                  test.core.ok
                    ? `Reasoning core online (${Math.round(test.core.ms ?? 0)}ms) — "${(test.core.detail ?? "").slice(0, 40)}"`
                    : (test.core.error ?? "offline")
                }
              />
            )}
            {test.vision && (
              <StatusLine
                ok={test.vision.ok}
                text={
                  test.vision.ok
                    ? `Vision / multimodal online (${Math.round(test.vision.ms ?? 0)}ms) — ${test.vision.detail ?? "image analysis verified"}`
                    : (test.vision.error ?? "offline")
                }
              />
            )}
            {test.documents && (
              <StatusLine
                ok={test.documents.ok}
                text={
                  test.documents.ok
                    ? `Document reader online (${Math.round(test.documents.ms ?? 0)}ms) — ${test.documents.detail ?? "PDF + DOCX extraction verified"}`
                    : (test.documents.error ?? test.documents.detail ?? "offline")
                }
              />
            )}
            {test.tools &&
              (
                [
                  { key: "command", label: "Terminal executor" },
                  { key: "system", label: "System telemetry" },
                  { key: "web", label: "Live web access" },
                  { key: "image", label: "Image generation" },
                ] as const
              ).map(({ key, label }) => {
                const r = test.tools?.[key];
                if (!r) return null;
                return (
                  <StatusLine
                    key={key}
                    ok={r.ok}
                    text={`${label} — ${
                      r.ok ? "online" : (r.error ?? r.detail ?? "offline")
                    } (${Math.round(r.ms ?? 0)}ms)`}
                  />
                );
              })}
          </section>

          {/* ── Data ──────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle icon={<Database className="h-3.5 w-3.5" />}>Data</SectionTitle>
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2.5">
              <div>
                <p className="text-xs text-zinc-200">Delete all conversations</p>
                <p className="text-[9px] text-zinc-500">
                  Wipes every session and message permanently
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllSessions}
                disabled={clearing}
                className="h-8 shrink-0 border-red-500/40 font-mono text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-500/10"
              >
                {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete all"}
              </Button>
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            className="h-9 border-zinc-700 font-mono text-[10px] uppercase tracking-widest text-zinc-400"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving}
            className="h-9 bg-cyan-500/20 font-mono text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/30"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save configuration"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-400/80">
      {icon}
      {children}
    </h3>
  );
}

function SettingRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-800/60 bg-[#081120]/50 px-3 py-2.5">
      <div>
        <p className="text-xs text-zinc-200">{label}</p>
        <p className="text-[9px] text-zinc-500">{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="data-[state=checked]:bg-cyan-500/60"
      />
    </div>
  );
}

function PermRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-0.5">
      <div>
        <p className="text-xs text-zinc-200">{label}</p>
        <p className="font-mono text-[9px] text-zinc-600">{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={`${label} permission`}
        className="data-[state=checked]:bg-emerald-500/60"
      />
    </div>
  );
}

function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 font-mono text-[10px] ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
          : "border-amber-500/30 bg-amber-500/5 text-amber-300"
      }`}
    >
      {text}
    </div>
  );
}

function CapBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
        ok
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-zinc-700 bg-zinc-800/40 text-zinc-500"
      }`}
    >
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}
