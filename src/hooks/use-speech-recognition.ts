"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in standard lib DOM for all targets)
interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  0: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number } & Record<number, SRResult>;
}
interface SRErrorEvent {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  /** Called with a finalized utterance */
  onFinal: (text: string) => void;
  /** Continuous always-on mode with "jarvis" wake word gating */
  wakeWord?: boolean;
  /** Called when the wake word alone is heard (assistant should ack) */
  onWake?: () => void;
  lang?: string;
  /** Preferred input device ( microphone ). We acquire a getUserMedia stream on this
   *  device before starting recognition — in Chrome this pins the active input device. */
  micDeviceId?: string;
}

export function useSpeechRecognition({
  onFinal,
  wakeWord = false,
  onWake,
  lang = "en-US",
  micDeviceId = "",
}: UseSpeechRecognitionOptions) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const manualStopRef = useRef(false);
  const wantRunningRef = useRef(false);
  const armedRef = useRef(false); // wake word heard, next utterance is the command
  const wakeWordRef = useRef(wakeWord);
  const onFinalRef = useRef(onFinal);
  const onWakeRef = useRef(onWake);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorCountRef = useRef(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micDeviceIdRef = useRef(micDeviceId);

  useEffect(() => {
    micDeviceIdRef.current = micDeviceId;
  }, [micDeviceId]);

  useEffect(() => {
    wakeWordRef.current = wakeWord;
  }, [wakeWord]);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    // Deferred so we never call setState synchronously inside the effect body
    // (also keeps SSR hydration consistent).
    const supportTimer = setTimeout(() => setSupported(!!Ctor), 0);
    if (!Ctor) {
      return () => clearTimeout(supportTimer);
    }

    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onstart = () => {
      setListening(true);
      errorCountRef.current = 0;
    };

    rec.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      setInterim(interimText);
      if (!finalText.trim()) return;
      const text = finalText.trim();
      setInterim("");

      if (wakeWordRef.current) {
        // Wake-word gating: "jarvis <command>" or bare "jarvis"
        const m = text.match(/^(?:hey\s+|ok\s+|okay\s+)?jarvis[\s,.:!-]*(.*)$/i);
        if (armedRef.current) {
          armedRef.current = false;
          onFinalRef.current(text);
        } else if (m) {
          const command = (m[1] ?? "").trim();
          if (command.length > 2) {
            onFinalRef.current(command);
          } else {
            armedRef.current = true;
            onWakeRef.current?.();
          }
        }
        // utterance without wake word → ignored
      } else {
        onFinalRef.current(text);
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRunningRef.current = false;
        setListening(false);
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        errorCountRef.current++;
      }
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
      if (wantRunningRef.current && errorCountRef.current < 6) {
        // keep the always-on loop alive
        restartTimerRef.current = setTimeout(() => {
          if (wantRunningRef.current) {
            try {
              rec.start();
            } catch {
              // already started
            }
          }
        }, 350);
      }
    };

    recognitionRef.current = rec;
    return () => {
      wantRunningRef.current = false;
      manualStopRef.current = true;
      clearTimeout(supportTimer);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      try {
        rec.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, [lang]);

  /** Acquire a getUserMedia stream on the preferred device so Chrome's
   *  SpeechRecognition uses it as the active input. Released on stop. */
  const pinMicDevice = useCallback(async () => {
    if (micStreamRef.current) return; // already pinned
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceIdRef.current
          ? { deviceId: { exact: micDeviceIdRef.current } }
          : true,
      });
      micStreamRef.current = stream;
      setMicError(null);
    } catch {
      // fall back to default device — recognition still works
      setMicError("Preferred microphone unavailable — using the default device.");
    }
  }, []);

  const releaseMicDevice = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    manualStopRef.current = false;
    wantRunningRef.current = true;
    void pinMicDevice().finally(() => {
      try {
        rec.start();
      } catch {
        // already running
      }
    });
  }, [pinMicDevice]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    manualStopRef.current = true;
    wantRunningRef.current = false;
    try {
      rec?.stop();
    } catch {
      // ignore
    }
    setListening(false);
    setInterim("");
    releaseMicDevice();
  }, [releaseMicDevice]);

  /** One-shot listen (push to talk). Auto-restarts in wake-word mode are not used. */
  const startOnce = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    wantRunningRef.current = false;
    manualStopRef.current = false;
    void pinMicDevice().finally(() => {
      try {
        rec.start();
      } catch {
        // already running
      }
    });
  }, [pinMicDevice]);

  return { supported, listening, interim, micError, start, stop, startOnce };
}
