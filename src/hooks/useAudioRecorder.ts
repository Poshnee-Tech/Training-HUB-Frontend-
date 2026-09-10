'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useCallStore } from '../store/call.store';

/**
 * Captures mic audio as 16kHz PCM Int16 via an AudioWorklet and sends it
 * to the backend via callback. AudioWorkletNode (vs the deprecated
 * ScriptProcessorNode) runs on the audio thread, so the main thread stays
 * smooth even during long calls. Legacy mode skips emitting audio frames
 * while TTS is playing; Deepgram Agent mode keeps the mic hot for barge-in.
 */
export function useAudioRecorder(onAudioData: (data: ArrayBuffer) => void) {
  const { setRecording } = useCallStore();
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const onAudioDataRef = useRef(onAudioData);
  onAudioDataRef.current = onAudioData;

  // Subscribe to call-store state so we can push mute/speaking transitions
  // to the worklet via port message instead of polling.
  useEffect(() => {
    const unsub = useCallStore.subscribe((state) => {
      const w = workletRef.current;
      if (!w) return;
      w.port.postMessage({
        type: 'state',
        muted: state.isMuted,
        speaking: state.isSpeaking,
        // Both server-side realtime pipelines keep the mic hot for barge-in;
        // only legacy gates the mic while TTS plays.
        bargeInMode: state.voicePipeline !== 'legacy',
      });
    });
    return () => { unsub(); };
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      contextRef.current = audioContext;

      // Load the worklet module from /public/worklets/. Module URL is
      // version-agnostic — Next serves it as a static asset.
      await audioContext.audioWorklet.addModule('/worklets/pcm-processor.js');

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const worklet = new AudioWorkletNode(audioContext, 'pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      workletRef.current = worklet;

      // Push the current mute/speaking state once so the worklet starts in
      // the right gate even if nothing changes immediately after.
      const s = useCallStore.getState();
      worklet.port.postMessage({
        type: 'state',
        muted: s.isMuted,
        speaking: s.isSpeaking,
        bargeInMode: s.voicePipeline !== 'legacy',
      });

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (e.data instanceof ArrayBuffer) onAudioDataRef.current(e.data);
      };

      source.connect(worklet);
      // Keep the worklet graph alive without monitoring mic audio to speakers.
      // This avoids a feedback path that can leak customer playback back into
      // Deepgram on weak echo-cancellation setups.
      const monitorGain = audioContext.createGain();
      monitorGain.gain.value = 0;
      monitorGainRef.current = monitorGain;
      worklet.connect(monitorGain);
      monitorGain.connect(audioContext.destination);

      setRecording(true);
    } catch (error) {
      console.error('[AudioRecorder] Failed to start:', error);
      throw error;
    }
  }, [setRecording]);

  const stop = useCallback(() => {
    if (workletRef.current) {
      try { workletRef.current.port.close(); } catch {}
      try { workletRef.current.disconnect(); } catch {}
      workletRef.current = null;
    }
    if (monitorGainRef.current) {
      try { monitorGainRef.current.disconnect(); } catch {}
      monitorGainRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }
    if (contextRef.current) {
      // close() returns a promise; we don't need to await.
      contextRef.current.close().catch(() => {});
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setRecording(false);
  }, [setRecording]);

  return { start, stop };
}
