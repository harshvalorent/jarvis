"use client";

import { create } from "zustand";
import type {
  ActivityEntry,
  ApprovalRequest,
  ChatMsg,
  EngineKind,
  SessionSummary,
  SystemStats,
  ToolCard,
} from "@/lib/types";
import { api, type AiConfigResponse, type SettingsResponse } from "@/lib/client/api";

export type VoiceState = "idle" | "listening" | "speaking" | "thinking";

interface JarvisStore {
  // Boot
  booted: boolean;
  setBooted: (v: boolean) => void;

  // Settings
  settings: SettingsResponse | null;
  loadSettings: () => Promise<void>;

  aiConfig: AiConfigResponse | null;
  aiConfigFetchedAt: number;
  loadAiConfig: (force?: boolean) => Promise<void>;

  // Sessions
  sessions: SessionSummary[];
  loadSessions: () => Promise<void>;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  loadSessionMessages: (id: string) => Promise<void>;
  newChat: () => void;
  deleteSession: (id: string) => Promise<void>;

  // Messages
  messages: ChatMsg[];
  setMessages: (msgs: ChatMsg[]) => void;
  appendMessage: (msg: ChatMsg) => void;
  patchMessage: (id: string, patch: Partial<ChatMsg>) => void;
  appendDelta: (id: string, text: string) => void;
  upsertToolCard: (msgId: string, card: ToolCard) => void;
  /** Remove the given message and everything after it (local mirror of server truncate) */
  truncateMessages: (messageId: string) => void;

  // Streaming state
  streaming: boolean;
  setStreaming: (v: boolean) => void;
  statusLabel: string;
  setStatusLabel: (v: string) => void;
  engineInfo: { engine: EngineKind; model: string; note?: string } | null;
  setEngineInfo: (v: { engine: EngineKind; model: string; note?: string } | null) => void;
  lastLatencyMs: number | null;
  setLastLatencyMs: (v: number | null) => void;

  // Approvals
  approvals: Record<string, ApprovalRequest>; // keyed by toolId
  setApproval: (a: ApprovalRequest) => void;
  clearApproval: (toolId: string) => void;

  // Activity log
  activity: ActivityEntry[];
  pushActivity: (entry: Omit<ActivityEntry, "id" | "time">) => void;
  clearActivity: () => void;

  // System stats
  stats: SystemStats | null;
  loadStats: () => Promise<void>;

  // Voice state (drives waveform)
  voiceState: VoiceState;
  setVoiceState: (v: VoiceState) => void;

  // Cross-component message sender (registered by ChatPanel)
  sender: ((text: string) => void) | null;
  registerSender: (fn: ((text: string) => void) | null) => void;

  // UI
  sidebarOpen: boolean; // mobile drawer
  setSidebarOpen: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
}

let activityCounter = 0;

export const useJarvisStore = create<JarvisStore>((set, get) => ({
  booted: false,
  setBooted: (v) => set({ booted: v }),

  settings: null,
  loadSettings: async () => {
    try {
      const settings = await api.getSettings();
      set({ settings });
    } catch {
      // leave previous settings
    }
  },

  aiConfig: null,
  aiConfigFetchedAt: 0,
  loadAiConfig: async (force = false) => {
    if (!force && Date.now() - get().aiConfigFetchedAt < 45_000) return;
    try {
      const aiConfig = await api.getAiConfig();
      set({ aiConfig, aiConfigFetchedAt: Date.now() });
    } catch {
      // keep previous config
    }
  },

  sessions: [],
  loadSessions: async () => {
    try {
      const sessions = await api.getSessions();
      set({ sessions });
    } catch {
      // ignore
    }
  },
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  loadSessionMessages: async (id) => {
    const detail = await api.getSession(id);
    const messages: ChatMsg[] = detail.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tools: m.meta?.tools ?? [],
      engine: m.meta?.engine,
      images: m.meta?.images?.length
        ? m.meta.images.map((imgId) => `/api/uploads?id=${imgId}`)
        : undefined,
      documents: m.meta?.documents?.length
        ? m.meta.documents.map((d) => ({
            id: d.id,
            name: d.name,
            kind: d.kind,
            ext: d.ext,
            label: d.label,
            url: `/api/uploads?id=${d.id}`,
          }))
        : undefined,
      createdAt: new Date(m.createdAt).getTime(),
    }));
    set({ activeSessionId: id, messages });
  },
  newChat: () => set({ activeSessionId: null, messages: [] }),
  deleteSession: async (id) => {
    await api.deleteSession(id);
    const { activeSessionId, sessions } = get();
    const remaining = sessions.filter((s) => s.id !== id);
    set({ sessions: remaining });
    if (activeSessionId === id) {
      set({ activeSessionId: null, messages: [] });
    }
  },

  messages: [],
  setMessages: (msgs) => set({ messages: msgs }),
  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  patchMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  appendDelta: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + text } : m
      ),
    })),
  upsertToolCard: (msgId, card) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m;
        const idx = m.tools.findIndex((t) => t.id === card.id);
        const tools = [...m.tools];
        if (idx >= 0) tools[idx] = { ...tools[idx], ...card };
        else tools.push(card);
        return { ...m, tools };
      }),
    })),
  truncateMessages: (messageId) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return {};
      return { messages: s.messages.slice(0, idx) };
    }),

  streaming: false,
  setStreaming: (v) => set({ streaming: v }),
  statusLabel: "",
  setStatusLabel: (v) => set({ statusLabel: v }),
  engineInfo: null,
  setEngineInfo: (v) => set({ engineInfo: v }),
  lastLatencyMs: null,
  setLastLatencyMs: (v) => set({ lastLatencyMs: v }),

  approvals: {},
  setApproval: (a) => set((s) => ({ approvals: { ...s.approvals, [a.toolId]: a } })),
  clearApproval: (toolId) =>
    set((s) => {
      const next = { ...s.approvals };
      delete next[toolId];
      return { approvals: next };
    }),

  activity: [],
  pushActivity: (entry) =>
    set((s) => ({
      activity: [
        { ...entry, id: `act_${Date.now()}_${++activityCounter}`, time: Date.now() },
        ...s.activity,
      ].slice(0, 200),
    })),
  clearActivity: () => set({ activity: [] }),

  stats: null,
  loadStats: async () => {
    try {
      const stats = await api.getSystemStats();
      set({ stats });
    } catch {
      // ignore
    }
  },

  voiceState: "idle",
  setVoiceState: (v) => set({ voiceState: v }),

  sender: null,
  registerSender: (fn) => set({ sender: fn }),

  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
}));
