'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useCallStore } from '../store/call.store';

/**
 * Browser STT using Web Speech API.
 * - Suppresses results while TTS is speaking (prevents feedback loop)
 * - Waits 500ms after TTS ends before accepting input (mic ringdown)
 * - No aggressive filtering — sends what Chrome gives us
 */
export function useBrowserSTT(
  onFinalTranscript: (text: string) => void,
  onInterimTranscript?: (text: string) => void
) {
  const { setRecording } = useCallStore();
  const recognitionRef = useRef<any>(null);
  const isRunningRef = useRef(false);
  const suppressUntilRef = useRef(0); // timestamp — ignore results until this time

  const callbackRef = useRef(onFinalTranscript);
  const interimCallbackRef = useRef(onInterimTranscript);
  callbackRef.current = onFinalTranscript;
  interimCallbackRef.current = onInterimTranscript;

  // When TTS starts, suppress. When TTS ends, suppress for 500ms more (mic ringdown).
  useEffect(() => {
    let prev = false;
    const unsub = useCallStore.subscribe((state) => {
      const now = state.isSpeaking;
      if (now && !prev) {
        // TTS started — suppress immediately
        suppressUntilRef.current = Infinity;
      } else if (!now && prev) {
        // TTS ended — keep suppressing for 500ms to let mic settle
        suppressUntilRef.current = Date.now() + 500;
      }
      prev = now;
    });
    return () => unsub();
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('Web Speech API not supported - use Chrome or Edge');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      // Check mute
      if (useCallStore.getState().isMuted) return;

      // Check suppression (TTS playing or mic ringdown)
      if (Date.now() < suppressUntilRef.current) return;

      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        useCallStore.getState().setInterimTranscript(interim);
        interimCallbackRef.current?.(interim);
      }

      if (final.trim()) {
        useCallStore.getState().setInterimTranscript('');
        callbackRef.current(final.trim());
      }
    };

    recognition.onend = () => {
      // Auto-restart (Chrome stops after ~60s)
      if (isRunningRef.current) {
        setTimeout(() => {
          if (isRunningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {}
          }
        }, 200);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('[Browser STT] Error:', event.error);
      if (event.error === 'network' && isRunningRef.current) {
        setTimeout(() => {
          if (isRunningRef.current) {
            try { recognitionRef.current?.start(); } catch {}
          }
        }, 1000);
      }
    };

    recognitionRef.current = recognition;
    isRunningRef.current = true;

    try {
      recognition.start();
      setRecording(true);
    } catch (err) {
      console.error('[Browser STT] Failed to start:', err);
    }
  }, [setRecording]);

  const stop = useCallback(() => {
    isRunningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setRecording(false);
  }, [setRecording]);

  return { start, stop };
}
