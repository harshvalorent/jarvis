"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Strip markdown so speech sounds natural. */
export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (code block omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/\s+/g, " ")
    .trim();
}

export interface UseSpeechSynthesisOptions {
  enabled: boolean;
  voiceURI?: string;
  rate?: number;
  pitch?: number;
}

/**
 * Streaming-friendly TTS: feed() text as it streams in; complete sentences are
 * spoken as soon as they're available. flush() speaks any remainder.
 */
export function useSpeechSynthesis({
  enabled,
  voiceURI,
  rate = 1,
  pitch = 1,
}: UseSpeechSynthesisOptions) {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const bufferRef = useRef("");
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const queueCountRef = useRef(0);
  const enabledRef = useRef(enabled);
  const optsRef = useRef({ rate, pitch });

  useEffect(() => {
    enabledRef.current = enabled;
    optsRef.current = { rate, pitch };
  }, [enabled, rate, pitch]);

  // Load voices (async in Chrome) — skip broken entries (null objects, empty voiceURI)
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices().filter(
        (v): v is SpeechSynthesisVoice => !!v && typeof v.voiceURI === "string" && v.voiceURI.length > 0
      );
      if (all.length) setVoices(all);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);

  // Resolve the voice to use
  useEffect(() => {
    if (!voices.length) return;
    if (voiceURI) {
      const exact = voices.find((v) => v.voiceURI === voiceURI);
      if (exact) {
        voiceRef.current = exact;
        return;
      }
    }
    // Auto-pick a pleasant British male voice if present
    const preferred = [
      /Daniel/i,
      /Google UK English Male/i,
      /en-GB/i,
      /Google US English/i,
      /en-US/i,
      /^en/i,
    ];
    for (const re of preferred) {
      const v = voices.find((voice) => re.test(voice.name ?? "") || re.test(voice.lang ?? ""));
      if (v) {
        voiceRef.current = v;
        return;
      }
    }
    voiceRef.current = voices[0] ?? null;
  }, [voices, voiceURI]);

  const speakText = useCallback((raw: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const text = markdownToSpeech(raw);
    if (!text) return;
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) {
      utter.voice = voiceRef.current;
      if (voiceRef.current.lang) utter.lang = voiceRef.current.lang;
    }
    const rate = Number.isFinite(optsRef.current.rate) ? optsRef.current.rate : 1;
    const pitch = Number.isFinite(optsRef.current.pitch) ? optsRef.current.pitch : 1;
    utter.rate = rate;
    utter.pitch = pitch;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => {
      queueCountRef.current = Math.max(0, queueCountRef.current - 1);
      if (queueCountRef.current === 0) setSpeaking(false);
    };
    utter.onerror = () => {
      queueCountRef.current = Math.max(0, queueCountRef.current - 1);
      if (queueCountRef.current === 0) setSpeaking(false);
    };
    queueCountRef.current++;
    synth.speak(utter);
    setSpeaking(true);
  }, []);

  /** Feed streaming text; sentences are spoken as they complete. */
  const feed = useCallback(
    (chunk: string) => {
      if (!enabledRef.current) return;
      bufferRef.current += chunk;
      // Complete sentences (keeping the terminator), min length to avoid choppy speech
      const parts = bufferRef.current.split(/(?<=[.!?])\s+/);
      if (parts.length > 1) {
        const complete = parts.slice(0, -1).join(" ");
        bufferRef.current = parts[parts.length - 1];
        if (complete.trim().length > 8) speakText(complete);
        else bufferRef.current = complete + " " + bufferRef.current;
      } else if (bufferRef.current.length > 400) {
        // Very long unbroken text — speak in chunks
        const text = bufferRef.current;
        bufferRef.current = "";
        speakText(text);
      }
    },
    [speakText]
  );

  /** Speak whatever is left in the buffer. */
  const flush = useCallback(() => {
    if (!enabledRef.current) return;
    const rest = bufferRef.current.trim();
    bufferRef.current = "";
    if (rest) speakText(rest);
  }, [speakText]);

  const cancel = useCallback(() => {
    bufferRef.current = "";
    queueCountRef.current = 0;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  /** Immediate one-off utterance (e.g. "Yes, sir?"). */
  const speakNow = useCallback(
    (text: string) => {
      if (!enabledRef.current) return;
      speakText(text);
    },
    [speakText]
  );

  return { speaking, voices, feed, flush, cancel, speakNow };
}
