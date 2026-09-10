'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 60;

function wavHeader(dataBytes: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
}

export interface PracticeRecorder {
  isRecording: boolean;
  level: number;
  seconds: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
}

export function usePracticeRecorder(): PracticeRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<(() => Promise<Blob | null>) | null>(null);

  const teardown = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (workletRef.current) {
      try { workletRef.current.port.onmessage = null; } catch {}
      try { workletRef.current.disconnect(); } catch {}
      workletRef.current = null;
    }
    if (gainRef.current) { try { gainRef.current.disconnect(); } catch {} gainRef.current = null; }
    if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch {} sourceRef.current = null; }
    if (contextRef.current) { contextRef.current.close().catch(() => {}); contextRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setLevel(0);
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    setSeconds(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const name = (error as Error)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
          : `Could not open the microphone: ${(error as Error)?.message ?? error}`,
      );
      return;
    }

    streamRef.current = stream;

    try {
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      contextRef.current = context;
      await context.audioWorklet.addModule('/worklets/pcm-processor.js');

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(context, 'pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      workletRef.current = worklet;

      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!(event.data instanceof ArrayBuffer)) return;
        const frame = new Int16Array(event.data);
        chunksRef.current.push(frame);
        let peak = 0;
        for (let index = 0; index < frame.length; index += 1) {
          const value = Math.abs(frame[index]);
          if (value > peak) peak = value;
        }
        const next = peak / 32768;
        setLevel((previous) => (next > previous ? next : previous * 0.82));
      };

      source.connect(worklet);
      const gain = context.createGain();
      gain.gain.value = 0;
      gainRef.current = gain;
      worklet.connect(gain);
      gain.connect(context.destination);
      setIsRecording(true);

      const startedAt = Date.now();
      tickRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) void stopRef.current?.();
      }, 200);
    } catch (error) {
      teardown();
      setError(`Could not start recording: ${(error as Error)?.message ?? error}`);
    }
  }, [teardown]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const frames = chunksRef.current;
    teardown();
    chunksRef.current = [];
    const samples = frames.reduce((total, frame) => total + frame.length, 0);
    if (samples < SAMPLE_RATE / 4) return null;

    const pcm = new Int16Array(samples);
    let offset = 0;
    for (const frame of frames) {
      pcm.set(frame, offset);
      offset += frame.length;
    }
    const dataBytes = pcm.length * 2;
    return new Blob([wavHeader(dataBytes, SAMPLE_RATE), pcm.buffer], { type: 'audio/wav' });
  }, [teardown]);

  stopRef.current = stop;
  return { isRecording, level, seconds, error, start, stop };
}
