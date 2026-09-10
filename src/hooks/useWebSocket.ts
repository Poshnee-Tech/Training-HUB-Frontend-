'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useCallStore, TranscriptMessage, CoachingTipMessage } from '../store/call.store';
import { useAuthStore } from '../store/auth.store';
import { auth as authApi } from '../lib/api';
import { decodeAudioFrame, identityOf, type SegmentIdentity } from '../lib/audio-frame';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';

// Reconnect tuning. Exponential backoff with a cap so flaky networks
// don't hammer the server but legitimate blips heal in <1s.
const RECONNECT_BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000];
const RECONNECT_MAX_ATTEMPTS = RECONNECT_BACKOFF_MS.length;
// Jitter buffer: the first chunk of a reply is held this long so network/
// synthesis jitter (worst right at call start, when the TTS socket just
// opened) can't outrun the playhead — gaps there are audible as breaking
// audio. Chunks mid-reply ride the continuous schedule at the small margin.
// 0.22s start lead (was 0.15): a larger buffered head start so a bursty/late
// chunk — e.g. the gap between the first flushed sentence and the rest of the
// reply — is absorbed instead of surfacing as an audible break. Costs ~70ms
// of first-word latency; cheap insurance against stutter. On an underrun
// (playhead caught up, no scheduled sources) playNextChunk re-applies this
// lead, so it doubles as the re-buffer window.
const PCM_PLAYBACK_START_DELAY_SECONDS = 0.22;
// COLD START: the very first audio of a call (the greeting) hits a cold TTS
// socket AND a just-unlocked AudioContext, so its chunks arrive far more
// jittery than mid-call — this is the "breaks at the start, fine after a
// mid-call reconnect" symptom. Pre-buffer much more for that first playback
// only; every later turn keeps the snappy 0.22s. One-time ~half-second beat
// before the greeting (natural "picking up the phone"), no per-turn latency.
const PCM_PLAYBACK_COLD_START_DELAY_SECONDS = 0.5;

/**
 * ── THE JITTER CUSHION (2026-08-31) ────────────────────────────────────────
 *
 * MEASURED COMPLAINT: intermittent break-up, "like a network break-up".
 * Ringback was ruled out by analysis of two real call recordings (0 windows
 * tonal at 440/480 Hz), so the tone theory was wrong.
 *
 * The scheduler ran with a 5ms cushion once warm:
 *
 *   startAt = Math.max(nextPlayTime, ctx.currentTime + 0.005)
 *
 * `nextPlayTime` is where the previous buffer ends. If a chunk is decoded even
 * 6ms late — WebSocket jitter, a GC pause, or the main-thread jank this file
 * already documents elsewhere as "audible as feed gaps" — then `nextPlayTime`
 * is in the past, `Math.max` picks `currentTime + 0.005`, and the difference
 * becomes SILENCE inserted mid-word. At 5ms of headroom that happens on
 * ordinary jitter, repeatedly and at random points: exactly break-up.
 *
 * 120ms of lead is about three 40ms TTS chunks — enough to absorb normal
 * jitter, small enough not to be heard as delay.
 */
const PCM_PLAYBACK_MIN_LEAD_SECONDS = 0.12;
/**
 * ── THE WARM CUSHION WAS STILL 5ms (owner ruling 2026-08-31) ───────────────
 *
 * The block below diagnosed this correctly and defined
 * `PCM_PLAYBACK_MIN_LEAD_SECONDS = 0.12`, but only the UNDERRUN path was
 * changed to use it. The warm path — every ordinary mid-reply chunk — kept a
 * 5ms floor, so the fix was half-landed and the break-up it describes carried
 * on happening.
 *
 * MEASURED on a live 71s call: customer turns were 24-48% silence, in holes of
 * 150-470ms. Five milliseconds of headroom cannot bridge any of those, so the
 * buffer emptied mid-word, repeatedly and at random points. Web Audio then
 * resumed mid-waveform after silence — a step discontinuity, heard as a tick.
 *
 * It is now the SAME constant, deliberately: two cushions that are meant to be
 * equal and are written down twice are two cushions that drift, which is
 * exactly what happened here.
 */
const PCM_PLAYBACK_CONTINUE_DELAY_SECONDS = PCM_PLAYBACK_MIN_LEAD_SECONDS;
// Once the greeting's first audio arrives under the ringback, keep ringing
// and buffer this long so the customer "answers" with audio already queued —
// the ring window IS the cold-start pre-buffer, so playback starts warm.
const RINGBACK_ANSWER_BUFFER_MS = 600;
/**
 * ── THE CUSHION IS SIZED BY THE PROVIDER, NOT BY OUR GRAPH ─────────────────
 * Owner ruling 2026-09-03.
 *
 * MEASURED, from a real call's per-chunk delivery log (2134 chunks, 16
 * utterances). Every utterance had an IDENTICAL shape:
 *
 *     chunks 0-4 arrive within 73ms  ->  200ms of audio in hand
 *     then a ~200ms STALL            ->  nothing arrives
 *     then continuous delivery       ->  cushion builds to 300-400ms
 *
 * The stall landed 73ms into the utterance, after exactly 200ms of audio, in
 * 16 of 16 utterances. So the buffer is thinnest during her FIRST WORD and
 * comfortable for everything after — which is precisely what the owner heard.
 *
 * THE DEFECT. The cushion was chosen by a flag called `warm`:
 *     const warm = hasScheduledAudio || nextPlayTime > ctx.currentTime;
 * which conflates "the audio graph is already running" with "the incoming
 * stream is already flowing". For a NEW utterance the stream is not flowing —
 * it has that stall, every time. So when her reply began while the previous
 * reply was still draining, playback started on the 120ms warm lead and her
 * first word played with only 85ms of margin. Any hiccup above that emptied
 * it mid-word. That is the intermittency: not network luck, but whether the
 * previous utterance had finished draining.
 *
 * WHY THIS IS LEARNED AND NOT A CONSTANT. The owner asked for the number to be
 * derived if it safely can be. It can: the stall is observable at runtime. We
 * watch the arrival gaps in the opening of each utterance, keep the largest
 * seen this call, and size the NEXT utterance's start cushion from it. A
 * provider that gets faster shrinks the cushion; one that stalls longer widens
 * it. Nothing here assumes 200ms.
 *
 * The bounds are the only fixed numbers, and both are safety rails rather than
 * tuning: never below what shipped before (so this cannot make things worse),
 * never above 600ms (so a pathological stall cannot stall the call itself).
 */
const UTTERANCE_START_STALL_WINDOW_MS = 800;
/** How many recent utterances the cushion is derived from. */
const STALL_SAMPLE_WINDOW = 8;
/** A high percentile, so one outlier cannot set the cushion by itself. */
const STALL_PERCENTILE = 0.75;
const UTTERANCE_START_CUSHION_HEADROOM_MS = 150;
const UTTERANCE_START_CUSHION_MIN_S = 0.22;
const UTTERANCE_START_CUSHION_MAX_S = 0.6;

const PCM_PLAYBACK_RELEASE_GRACE_MS = 320;
/**
 * Safety valve for a `final` frame that never arrives (dropped stream, server
 * fault). Far beyond any stall this provider has been measured at — the worst
 * observed was 680ms — so it cannot fire during ordinary speech, and it exists
 * only so a segment always resolves and the mic guard always releases.
 */
const DRAIN_WITHOUT_FINAL_BACKSTOP_MS = 4000;
// Slack added to the known-remaining playback time before the handover
// backstop gives up waiting for source.onended and releases the floor anyway.
const PLAYBACK_HANDOVER_BACKSTOP_MS = 1500;

// ── Shared AudioContext for playback ────────────────────────────────────────
// Created once, resumed on first user interaction (Chrome autoplay policy).
let sharedAudioCtx: AudioContext | null = null;
let audioUnlocked = false;

/**
 * ── THE CONTEXT RUNS AT THE STREAM'S RATE (owner ruling 2026-09-03) ────────
 *
 * THE DEFECT THIS FIXES. `new AudioContext()` with no rate let the browser
 * pick the device rate — MEASURED 48000 on the owner's machine. The PCM path
 * then built every WebSocket chunk into its own `createBuffer(ch, n, 24000)`.
 * An AudioBuffer whose rate differs from its context is resampled AT PLAYBACK,
 * one buffer at a time, and a resampler started fresh for each buffer carries
 * no filter state across the join. Every chunk seam therefore got a small
 * discontinuity — heard as an intermittent tick, and audible to the owner
 * across four cycles of wrong diagnoses.
 *
 * It hid behind the comment that used to sit here: "decodeAudioData handles
 * resampling". This path NEVER calls `decodeAudioData` — that is the encoded
 * branch. The PCM branch fills buffers by hand, and nothing resampled them
 * continuously.
 *
 * WHY MATCH THE CONTEXT RATHER THAN RESAMPLE OURSELVES. Both were on the
 * table. Matching wins on every axis: it removes the per-buffer resample
 * instead of correcting it, the remaining device-rate conversion is done ONCE,
 * continuously, by the browser's own audio path (which is what "resample once"
 * asks for and is better than anything hand-written here), and it adds no DSP
 * of mine to get wrong. The microphone is unaffected — it has its own context
 * at 16 kHz in `useAudioRecorder`, so nothing about STT capture changes.
 *
 * If a browser refuses the rate, the fallback is the OLD behaviour, so it is
 * logged loudly rather than silently reintroducing the tick.
 */
const PLAYBACK_SAMPLE_RATE = 24000;

function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    try {
      sharedAudioCtx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    } catch {
      sharedAudioCtx = new AudioContext();
    }
    if (sharedAudioCtx.sampleRate !== PLAYBACK_SAMPLE_RATE) {
      console.warn(
        `[Audio] context is ${sharedAudioCtx.sampleRate}Hz but the stream is ${PLAYBACK_SAMPLE_RATE}Hz — `
        + 'every chunk will be resampled independently and seams may tick',
      );
    } else {
      console.log(`[Audio] context sample rate ${sharedAudioCtx.sampleRate}Hz (matches the stream — no per-buffer resample)`);
    }
  }
  return sharedAudioCtx;
}

// Unlock audio on ANY user interaction (click, keydown, touchstart).
// This satisfies Chrome's autoplay policy so AudioContext.resume() works.
function setupAudioUnlock() {
  if (typeof window === 'undefined' || audioUnlocked) return;

  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        console.log('[Audio] AudioContext unlocked');
        audioUnlocked = true;
      });
    } else {
      audioUnlocked = true;
    }
    // Remove listeners after first unlock
    document.removeEventListener('click', unlock);
    document.removeEventListener('keydown', unlock);
    document.removeEventListener('touchstart', unlock);
  };

  document.addEventListener('click', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
}

// Set up unlock listeners immediately when this module loads on the client
if (typeof window !== 'undefined') {
  setupAudioUnlock();
}

// ── Browser TTS (Web Speech API, free & client-side) ───────────────────────
// Replaces Deepgram TTS. The customer voice is spoken by the browser itself.
// Speech is queued so multiple messages never overlap.

type Gender = 'male' | 'female' | 'unknown';
type SpeakJob = { text: string; gender: Gender; onStart?: () => void; onEnd?: () => void };
type ServerAudioOutput = {
  encoding: 'encoded' | 'linear16';
  sampleRate: number;
  channels: number;
};
type AgentAudioMetricLevel = 'low' | 'balanced' | 'high' | 'unknown';
type AgentAudioPaceLevel = 'slow' | 'balanced' | 'fast' | 'unknown';
type AgentAudioMetricsAccumulator = {
  started: boolean;
  totalSamples: number;
  voicedSamples: number;
  silenceSamples: number;
  sumSquares: number;
  peakLevel: number;
  clippedSamples: number;
  longPauseCount: number;
  currentSilenceMs: number;
};
type AgentTurnAudioMetrics = {
  source: 'browser_mic';
  clientTurnIndex: number;
  durationMs: number;
  voicedMs: number;
  silenceMs: number;
  speechRatio: number;
  avgRms: number;
  peakLevel: number;
  clippingPct: number;
  longPauseCount: number;
  words: number;
  wpm: number | null;
  energyLevel: AgentAudioMetricLevel;
  paceLevel: AgentAudioPaceLevel;
  capturedAt: number;
};
type WsTicketCache = {
  sessionId: string;
  ticket: string;
  expiresAt: number;
  issuedAt: number;
};
const speakQueue: SpeakJob[] = [];
let isSpeakingNow = false;

const AGENT_AUDIO_SAMPLE_RATE = 16000;
const AGENT_AUDIO_VOICE_RMS_THRESHOLD = 0.015;
const AGENT_AUDIO_VOICE_PEAK_THRESHOLD = 0.05;
const AGENT_AUDIO_LONG_PAUSE_MS = 700;

function createAgentAudioMetricsAccumulator(): AgentAudioMetricsAccumulator {
  return {
    started: false,
    totalSamples: 0,
    voicedSamples: 0,
    silenceSamples: 0,
    sumSquares: 0,
    peakLevel: 0,
    clippedSamples: 0,
    longPauseCount: 0,
    currentSilenceMs: 0,
  };
}

function resetAgentAudioMetrics(acc: AgentAudioMetricsAccumulator) {
  Object.assign(acc, createAgentAudioMetricsAccumulator());
}

function collectAgentAudioMetrics(acc: AgentAudioMetricsAccumulator, audioData: ArrayBuffer) {
  if (!(audioData instanceof ArrayBuffer) || audioData.byteLength < 2) return;

  const sampleCount = Math.floor(audioData.byteLength / 2);
  if (sampleCount < 1) return;

  const view = new DataView(audioData, 0, sampleCount * 2);
  let frameSquares = 0;
  let framePeak = 0;
  let clipped = 0;

  for (let i = 0; i < sampleCount; i += 1) {
    const value = view.getInt16(i * 2, true) / 32768;
    const abs = Math.abs(value);
    frameSquares += value * value;
    if (abs > framePeak) framePeak = abs;
    if (abs >= 0.985) clipped += 1;
  }

  const frameRms = Math.sqrt(frameSquares / sampleCount);
  const isVoiced = frameRms >= AGENT_AUDIO_VOICE_RMS_THRESHOLD || framePeak >= AGENT_AUDIO_VOICE_PEAK_THRESHOLD;
  if (!acc.started && !isVoiced) return;

  acc.started = true;
  acc.totalSamples += sampleCount;
  acc.sumSquares += frameSquares;
  acc.clippedSamples += clipped;
  if (framePeak > acc.peakLevel) acc.peakLevel = framePeak;

  if (isVoiced) {
    if (acc.currentSilenceMs >= AGENT_AUDIO_LONG_PAUSE_MS) {
      acc.longPauseCount += 1;
    }
    acc.currentSilenceMs = 0;
    acc.voicedSamples += sampleCount;
  } else {
    const frameMs = (sampleCount / AGENT_AUDIO_SAMPLE_RATE) * 1000;
    acc.currentSilenceMs += frameMs;
    acc.silenceSamples += sampleCount;
  }
}

function classifyEnergy(avgRms: number, peakLevel: number, clippingPct: number): AgentAudioMetricLevel {
  if (!Number.isFinite(avgRms) || avgRms <= 0) return 'unknown';
  if (avgRms < 0.025 && peakLevel < 0.18) return 'low';
  if (avgRms > 0.14 || peakLevel > 0.9 || clippingPct > 0.01) return 'high';
  return 'balanced';
}

function classifyPace(wpm: number | null): AgentAudioPaceLevel {
  if (!wpm || !Number.isFinite(wpm)) return 'unknown';
  if (wpm < 110) return 'slow';
  if (wpm > 180) return 'fast';
  return 'balanced';
}

function countWords(text: string): number {
  return (text.trim().match(/\b[\w']+\b/g) || []).length;
}

function finishAgentAudioMetrics(
  acc: AgentAudioMetricsAccumulator,
  text: string,
  clientTurnIndex: number,
): AgentTurnAudioMetrics | null {
  if (!acc.started || acc.totalSamples < AGENT_AUDIO_SAMPLE_RATE * 0.2) {
    resetAgentAudioMetrics(acc);
    return null;
  }

  const durationMs = Math.round((acc.totalSamples / AGENT_AUDIO_SAMPLE_RATE) * 1000);
  const voicedMs = Math.round((acc.voicedSamples / AGENT_AUDIO_SAMPLE_RATE) * 1000);
  const silenceMs = Math.round((acc.silenceSamples / AGENT_AUDIO_SAMPLE_RATE) * 1000);
  const avgRms = Math.sqrt(acc.sumSquares / Math.max(1, acc.totalSamples));
  const clippingPct = acc.clippedSamples / Math.max(1, acc.totalSamples);
  const words = countWords(text);
  const wpm = durationMs > 0 && words > 0 ? Math.round(words / (durationMs / 60000)) : null;

  const metrics: AgentTurnAudioMetrics = {
    source: 'browser_mic',
    clientTurnIndex,
    durationMs,
    voicedMs,
    silenceMs,
    speechRatio: Number((acc.voicedSamples / Math.max(1, acc.totalSamples)).toFixed(3)),
    avgRms: Number(avgRms.toFixed(4)),
    peakLevel: Number(acc.peakLevel.toFixed(4)),
    clippingPct: Number(clippingPct.toFixed(4)),
    longPauseCount: acc.longPauseCount,
    words,
    wpm,
    energyLevel: classifyEnergy(avgRms, acc.peakLevel, clippingPct),
    paceLevel: classifyPace(wpm),
    capturedAt: Date.now(),
  };

  resetAgentAudioMetrics(acc);
  return metrics;
}

// Cached choices per gender — picked once per session per gender.
const cachedVoices: { male: SpeechSynthesisVoice | null; female: SpeechSynthesisVoice | null } = {
  male: null,
  female: null,
};

/**
 * Curated voice preference lists.
 * Order matters — first match wins. Chrome/Windows has only 6 voices; Edge has dozens.
 * Edge neural voices take priority because their quality is noticeably better.
 * Bad/child/regional voices are blocklisted.
 */
const VOICE_BLOCKLIST = [
  /nigeria/i, /kenya/i, /tanzania/i, /south africa/i, /ghana/i,
  /\bana\b.*online/i,         // Microsoft Ana sounds like a child
  /microsoft david/i,          // low-quality legacy voice
  /microsoft mark/i,           // low-quality legacy voice
  /\bzira\b/i,                 // older Desktop voice, lower quality than Edge neurals
  /\bhazel\b/i,
];

// Preferred MALE voice name substrings, best-first.
const MALE_PREFS = [
  // Edge neural (Windows 11 with Edge)
  /microsoft andrew.*online.*english.*united states/i,
  /microsoft andrew.*online/i,
  /microsoft brian.*online/i,
  /microsoft christopher.*online/i,
  /microsoft guy.*online/i,
  /microsoft roger.*online/i,
  /microsoft eric/i,
  // Chrome built-in
  /google uk english male/i,
  // Any other male-sounding voice (but NOT blocklisted)
  /\bmale\b/i,
];

// Preferred FEMALE voice name substrings, best-first.
const FEMALE_PREFS = [
  // Edge neural (Windows 11 with Edge)
  /microsoft eva.*online/i,
  /microsoft ava.*online.*english.*united states/i,
  /microsoft ava.*online/i,
  /microsoft aria.*online/i,
  /microsoft jenny.*online/i,
  /microsoft emma.*online/i,
  /microsoft michelle.*online/i,
  /microsoft clara/i,
  // Chrome built-in (exact ones the user called out)
  /google uk english female/i,
  /google us english/i,
  // Any other female-sounding voice (but NOT blocklisted)
  /\bfemale\b/i,
  /samantha/i, /karen/i, /moira/i, /fiona/i, /victoria/i, /serena/i,
];

function isBlocked(v: SpeechSynthesisVoice): boolean {
  return VOICE_BLOCKLIST.some((re) => re.test(v.name));
}

function pickVoiceForGender(gender: Gender): SpeechSynthesisVoice | null {
  // Treat 'unknown' as female (most AI trainer personas in this app are female-coded customer calls)
  const effective: Exclude<Gender, 'unknown'> = gender === 'male' ? 'male' : 'female';
  if (cachedVoices[effective]) return cachedVoices[effective];
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const allowed = voices.filter((v) => /^en/i.test(v.lang) && !isBlocked(v));
  const pool = allowed.length ? allowed : voices.filter((v) => !isBlocked(v));
  const prefs = effective === 'male' ? MALE_PREFS : FEMALE_PREFS;

  let chosen: SpeechSynthesisVoice | null = null;
  for (const re of prefs) {
    const match = pool.find((v) => re.test(v.name));
    if (match) { chosen = match; break; }
  }
  // Last resort — first allowed English voice
  if (!chosen) chosen = pool[0] || null;

  cachedVoices[effective] = chosen;
  if (chosen) {
    console.log(`[TTS] ${effective} voice:`, chosen.name, chosen.lang);
  }
  return chosen;
}

function processSpeakQueue() {
  if (isSpeakingNow) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const next = speakQueue[0];
  if (!next) return;

  // Wait until voices are loaded before the very first speak.
  const voice = pickVoiceForGender(next.gender);
  if (!voice) {
    const retryTimer = setTimeout(() => {
      window.speechSynthesis.onvoiceschanged = null;
      processSpeakQueue();
    }, 600);
    window.speechSynthesis.onvoiceschanged = () => {
      clearTimeout(retryTimer);
      window.speechSynthesis.onvoiceschanged = null;
      processSpeakQueue();
    };
    if (!window.speechSynthesis.getVoices().length) return;
  }

  const job = speakQueue.shift()!;
  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(job.text);
  if (voice) utter.voice = voice;
  utter.lang = voice?.lang || 'en-US';
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  isSpeakingNow = true;
  job.onStart?.();

  // Safety timeout: if browser TTS silently drops the utterance (Chrome bug),
  // force-reset after 10s so mic recording isn't suppressed forever.
  const safetyTimer = setTimeout(() => {
    if (isSpeakingNow) {
      console.warn('[TTS] Browser speech stuck — force-resetting isSpeaking');
      isSpeakingNow = false;
      job.onEnd?.();
      processSpeakQueue();
    }
  }, 10000);

  const cleanup = () => {
    clearTimeout(safetyTimer);
    isSpeakingNow = false;
    job.onEnd?.();
    processSpeakQueue();
  };

  utter.onend = cleanup;
  utter.onerror = cleanup;
  synth.cancel();
  synth.speak(utter);
}

export function speakWithBrowser(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  gender: Gender = 'unknown',
) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const clean = text.trim();
  if (!clean) return;
  speakQueue.push({ text: clean, gender, onStart, onEnd });
  processSpeakQueue();
}

// Debug helper — open browser console and run  __listVoices()  to see what's available
if (typeof window !== 'undefined') {
  (window as any).__listVoices = () => {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    console.table(voices.map((v) => ({
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
      blocked: VOICE_BLOCKLIST.some((re) => re.test(v.name)),
    })));
    return voices;
  };
}

export function cancelAllSpeech() {
  speakQueue.length = 0;
  isSpeakingNow = false;
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/** Call this after a user gesture (e.g. mic permission) to unlock playback AudioContext */
export function unlockAudioContext() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      console.log('[Audio] AudioContext unlocked via mic permission');
      audioUnlocked = true;
    });
  } else {
    audioUnlocked = true;
  }
}

function pcmSegmentKey(identity: SegmentIdentity): string {
  return JSON.stringify([identity.connectionId, identity.turnId, identity.segmentId, identity.audioSourceId, identity.sequence]);
}

export function useWebSocket() {
  const { token } = useAuthStore();
  const {
    sessionId,
    status,
    setStatus,
    setWs,
    addMessage,
    clearTranscript,
    addCoachingTip,
    setInterimTranscript,
    setInterimCustomerText,
    setSpeaking,
    setCustomerTurnActive,
    setAudioModes,
    ws,
  } = useCallStore();

  const lastCustomerTextRef = useRef<string | null>(null);
  // True once this socket's history replay (if any) has begun — the first
  // replay frame replaces the transcript instead of appending to it.
  const historyReplaySeenRef = useRef(false);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  /** Wall-clock ms of the last playhead report, so the loop stays throttled. */
  const lastPlayheadReportAtRef = useRef<number>(0);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextPlayTimeRef = useRef(0);
  const pcmCarryRef = useRef<Uint8Array | null>(null);
  /**
   * Has this session already rung? The ringback masks the COLD START of a
   * fresh dial; a mid-call reconnect has nothing to mask and must stay silent.
   */
  const hasRungThisSessionRef = useRef(false);
  /** How many times playback ran dry this call — each one is an audible gap. */
  const pcmUnderrunsRef = useRef(0);
  /** Segment awaiting its first genuinely-audible moment (source.start). */
  const pendingAudibleIdentityRef = useRef<SegmentIdentity | null>(null);
  const pcmPlaybackReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Retry timer for chunks queued while the AudioContext is still unlocking.
  const suspendedRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // performance.now() of the last binary audio frame — used to tell apart
  // "feed stalled upstream" from "buffer just ran thin" when diagnosing
  // underruns.
  // True once the server has finished streaming this turn's audio
  // (tts_complete / tts_failed). The mic guard only releases when the stream
  // is done AND local playback has drained — never during a mid-turn gap.
  const customerAudioStreamDoneRef = useRef(true);
  // Backstop for the "stream done, playback still running" window: if the
  // scheduled sources never report ended (suspended AudioContext, dropped
  // frames), hand the floor over anyway rather than wedging the turn.
  const playbackHandoverFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverAudioOutputRef = useRef<ServerAudioOutput>({
    encoding: 'encoded',
    sampleRate: 24000,
    channels: 1,
  });
  const isPlayingRef = useRef(false);
  const sttFinalCallbackRef = useRef<((text: string) => void) | null>(null);
  const sttInterimCallbackRef = useRef<((text: string) => void) | null>(null);
  const agentTurnReceivedCallbackRef = useRef<((text: string) => void) | null>(null);
  const customerResponseStartedCallbackRef = useRef<(() => void) | null>(null);
  const customerResponseCompleteCallbackRef = useRef<(() => void) | null>(null);
  const personaGenderRef = useRef<'male' | 'female' | 'unknown'>('unknown');
  const useBrowserTtsRef = useRef(true);
  const customerTokenBufferRef = useRef('');
  const spokeStreamingCustomerRef = useRef(false);
  const firstAudioPlaybackLoggedRef = useRef(false);
  /**
   * The segment whose final chunk has arrived but has not finished playing.
   *
   * Completion is acknowledged when the queue actually drains, not when the
   * last chunk lands — the server uses the acknowledgement to know the trainee
   * heard the line, and the two are seconds apart.
   */
  const pendingFinalAckRef = useRef<SegmentIdentity | null>(null);
  // A final marker is not audio. Completion needs a successfully scheduled
  // PCM buffer from the same segment, followed by the existing drain check.
  const pcmIdentitiesRef = useRef(new WeakMap<ArrayBuffer, SegmentIdentity>());
  const scheduledPcmSegmentsRef = useRef(new Set<string>());
  /**
   * The live socket, for callers that fire outside a render.
   *
   * The playback-completion ack happens on a drain timer, which closes over
   * whatever `ws` was when the callback was built — a stale socket by then, or
   * null. A ref always has the current one.
   */
  const liveSocketRef = useRef<WebSocket | null>(null);
  // False until the first playback of the call has been scheduled — gates the
  // larger cold-start pre-buffer (greeting) so only it pays the extra wait.
  const coldStartDoneRef = useRef(false);
  /**
   * Per-utterance delivery state, and the stall learned from this call.
   *
   * `utteranceStartedRef` is the question the old `warm` flag could not
   * answer: has THIS utterance already begun playing? It is cleared by
   * `customer_response_started` — the server's own per-turn boundary — so it
   * cannot drift from what the pipeline thinks a turn is.
   */
  const utteranceStartedRef = useRef(false);
  const utteranceFirstChunkAtRef = useRef(0);
  const lastChunkArrivalRef = useRef(0);
  /**
   * ── RECENT STALLS, NOT AN ALL-TIME MAXIMUM (fix, 2026-09-03) ─────────────
   *
   * This was a running max, and a running max RATCHETS: one 534ms spike pinned
   * the cushion at its 600ms ceiling for the rest of the call, taxing every
   * later utterance for a worst case that had happened once.
   *
   * A bounded ring of the most recent openings gives decay for free — an old
   * spike falls out after `STALL_SAMPLE_WINDOW` utterances — and a high
   * percentile rather than the max means one outlier cannot set the cushion on
   * its own while a genuinely slower provider still moves it.
   */
  const startStallSamplesRef = useRef<number[]>([]);
  /** The largest opening gap seen so far in the CURRENT utterance. */
  const currentUtteranceStallRef = useRef(0);
  // Ringback ("phone ringing") state. We ring from connect until the
  // customer's greeting audio has buffered, then "answer" — so the greeting
  // plays on a warm, pre-buffered pipeline instead of a cold one (no break),
  // and the wait reads as a natural ring.
  const ringingRef = useRef(false);
  const ringNodesRef = useRef<{ osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode; cadence: ReturnType<typeof setInterval> } | null>(null);
  const answerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstMicFrameLoggedRef = useRef(false);
  const awaitingCustomerAudioCompleteRef = useRef(false);
  const agentAudioMetricsRef = useRef<AgentAudioMetricsAccumulator>(createAgentAudioMetricsAccumulator());
  const agentAudioMetricTurnIndexRef = useRef(0);
  const wsTicketRef = useRef<WsTicketCache | null>(null);
  const wsTicketRequestRef = useRef<{ sessionId: string; promise: Promise<WsTicketCache> } | null>(null);

  const speakCustomerChunk = useCallback((text: string) => {
    if (!useBrowserTtsRef.current) return;
    // Sanitize before speaking — strip stage directions, brackets, etc.
    const clean = text
      .replace(/<state>[\s\S]*?<\/state>/g, '')
      .replace(/<state>[\s\S]*$/g, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')          // any HTML/XML tags
      .replace(/\{[\s\S]*?"stage"[\s\S]*?\}/g, '') // bare JSON state leak
      .replace(/\*[^*]*\*/g, '')
      .replace(/_[^_]+_/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[?!]{2,}/g, (m) => m[0])
      .replace(/\.{2,}/g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!clean) return;
    // Safety: auto-reset isSpeaking after 2s in case browser TTS onend never fires
    let speakTimeout: ReturnType<typeof setTimeout> | null = null;
    speakWithBrowser(
      clean,
      () => {
        setSpeaking(true);
        speakTimeout = setTimeout(() => { setSpeaking(false); }, 2000);
      },
      () => {
        if (speakTimeout) clearTimeout(speakTimeout);
        setSpeaking(false);
      },
      personaGenderRef.current,
    );
  }, [setSpeaking]);

  // ── Mic guard (echo gate window) ─────────────────────────────────────────
  const activateMicGuard = useCallback(() => {
    customerAudioStreamDoneRef.current = false;
    if (!useCallStore.getState().customerTurnActive) {
      setCustomerTurnActive(true);
    }
  }, [setCustomerTurnActive]);

  /**
   * Hand the floor back to the trainee. Runs only once the server has finished
   * streaming the turn's audio AND local playback has drained.
   *
   * Both halves matter. Synthesis outruns playback by seconds — a 22-word
   * reply arrived in one ~0.5s burst and took 10.2s to play — so releasing on
   * tts_complete alone told the trainee it was their turn while the customer
   * was still audibly mid-sentence. They spoke, the backend confirmed a
   * barge-in, and stopAudioPlayback() discarded the ~9s that had not played
   * yet: the line cut off mid-word while the transcript stored it in full.
   */
  const scheduleMicGuardRelease = useCallback(() => {
    if (!customerAudioStreamDoneRef.current) return;
    if (playbackHandoverFallbackRef.current) {
      clearTimeout(playbackHandoverFallbackRef.current);
      playbackHandoverFallbackRef.current = null;
    }
    setCustomerTurnActive(false);
    // Server TTS: the turn is over when the audio has been HEARD. (Browser TTS
    // has no server audio to wait on and completes in customer_text_complete.)
    if (!useBrowserTtsRef.current && awaitingCustomerAudioCompleteRef.current) {
      awaitingCustomerAudioCompleteRef.current = false;
      customerResponseCompleteCallbackRef.current?.();
    }
  }, [setCustomerTurnActive]);

  /** True while server PCM for this turn is still queued or scheduled locally. */
  const pcmPlaybackPending = useCallback(() => (
    serverAudioOutputRef.current.encoding === 'linear16'
    && (scheduledSourcesRef.current.size > 0 || audioQueueRef.current.length > 0)
  ), []);

  const releaseMicGuardNow = useCallback(() => {
    if (playbackHandoverFallbackRef.current) {
      clearTimeout(playbackHandoverFallbackRef.current);
      playbackHandoverFallbackRef.current = null;
    }
    customerAudioStreamDoneRef.current = true;
    setCustomerTurnActive(false);
  }, [setCustomerTurnActive]);

/**
 * Tell the server what happened to a segment it sent.
 *
 * The roleplay engine treats an unacknowledged segment as never heard: the
 * opening line stays unpersisted and the turn waits on a confirmation that
 * never arrives. This is the other half of the identity-tagged audio contract.
 */
function sendPlaybackAck(
  socket: WebSocket | null,
  segment: SegmentIdentity,
  kind: 'started' | 'completed' | 'interrupted' | 'cancelled' | 'disconnected',
  bufferedAheadMs?: number,
): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    /**
     * `bufferedAheadMs` is how much audio is scheduled ahead of the playhead
     * at this instant — the one quantity only the browser can know, and the
     * one the server was previously guessing at. Deepgram's own guidance is
     * explicit that end-of-playback can only be observed here: "To detect
     * end-of-playback in the user's ears, watch your audio output queue, not
     * this event." Reporting it closes the loop.
     */
    socket.send(JSON.stringify({ type: 'playback_ack', kind, segment, bufferedAheadMs }));
  } catch {
    // A failed ack must never take the call down with it; the server's own
    // timeout is the backstop.
  }
}

  /**
   * One owner for a successfully drained PCM schedule. Both the normal
   * source.onended path and the clock-verified backstop use this, so playback
   * completion, the server ACK, UI speaking state and mic handover cannot
   * diverge.
   */
  /**
   * The provider's recent start-of-utterance stall, p75 of a bounded ring.
   *
   * Defined ONCE and used by both the start cushion and the drain grace
   * below. They are two answers to the same question — "how long does this
   * provider go quiet?" — and two copies of that number are two numbers that
   * drift.
   */
  /** When the current drain-wait began; 0 when not waiting. See the release timer. */
  const drainWaitStartedRef = useRef(0);
  /** Lets the release timer reschedule itself without a circular useCallback dep. */
  const schedulePcmPlaybackReleaseRef = useRef<(() => void) | null>(null);

  const learnedStallMsNow = useCallback((): number => {
    const samples = startStallSamplesRef.current;
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * STALL_PERCENTILE))]!;
  }, []);

  /**
   * How much real audio is sitting in the queue, in seconds. This is the
   * budget for scheduling lead: lead paid out of audio we already hold is
   * free, lead beyond it is silence we are inserting ourselves.
   */
  const queuedAudioSeconds = useCallback((): number => {
    const channels = Math.max(1, serverAudioOutputRef.current.channels || 1);
    const sampleRate = serverAudioOutputRef.current.sampleRate || 24000;
    let bytes = pcmCarryRef.current ? pcmCarryRef.current.length : 0;
    for (const chunk of audioQueueRef.current) bytes += chunk.byteLength;
    return bytes / 2 / channels / sampleRate;
  }, []);

  const completePcmPlaybackDrain = useCallback(() => {
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
    /**
     * THE UTTERANCE IS OVER because its audio drained — the only signal that
     * cannot be sent twice for one utterance, and the reason the start cushion
     * can no longer be applied mid-speech.
     */
    utteranceStartedRef.current = false;
    utteranceFirstChunkAtRef.current = 0;
    lastChunkArrivalRef.current = 0;
    drainWaitStartedRef.current = 0;

    const finished = pendingFinalAckRef.current;
    if (finished) {
      pendingFinalAckRef.current = null;
      if (scheduledPcmSegmentsRef.current.has(pcmSegmentKey(finished))) {
        sendPlaybackAck(liveSocketRef.current, finished, 'completed');
      }
    }
    scheduledPcmSegmentsRef.current.clear();
    setSpeaking(false);
    scheduleMicGuardRelease();
  }, [setSpeaking, scheduleMicGuardRelease]);

  const schedulePcmPlaybackRelease = useCallback(() => {
    if (pcmPlaybackReleaseTimerRef.current) return;
    /**
     * ── A SLOW PROVIDER IS NOT THE END OF A SENTENCE ─────────────────────
     *
     * This grace decides that "the utterance is over because its audio
     * drained". At a fixed 320ms it was deciding that DURING speech: the
     * provider's own measured stalls are 281-299ms at utterance start and
     * reach 400-680ms mid-utterance. Once the utterance is declared over,
     * the audio that arrives a moment later counts as a NEW utterance and
     * takes the full start cushion — a 435ms hole punched mid-word. The
     * owner's console showed that cushion applied six times inside one
     * sentence.
     *
     * The grace is now derived from what this provider actually does, using
     * the same learned stall the cushion uses, so an ordinary stall can no
     * longer be mistaken for the end of speech. It can only ever be LONGER
     * than the fixed value it replaces, never shorter — a genuinely finished
     * utterance is resolved at worst slightly later, which costs a little
     * latency on the ack and never cuts anything.
     */
    const graceMs = Math.max(
      PCM_PLAYBACK_RELEASE_GRACE_MS,
      learnedStallMsNow() + UTTERANCE_START_CUSHION_HEADROOM_MS,
    );
    if (drainWaitStartedRef.current === 0) drainWaitStartedRef.current = Date.now();
    pcmPlaybackReleaseTimerRef.current = setTimeout(() => {
      pcmPlaybackReleaseTimerRef.current = null;
      if (
        scheduledSourcesRef.current.size === 0 &&
        audioQueueRef.current.length === 0
      ) {
        /**
         * ── THE UTTERANCE ENDS WHEN THE SERVER SAYS SO ────────────────────
         *
         * An empty buffer is not the end of a sentence; it is the absence of
         * audio, which is equally what a stalled provider looks like. The
         * stream carries the actual answer: `final` on the last frame of the
         * segment, which is what `pendingFinalAckRef` holds. Until that has
         * been seen, more audio is expected and this utterance is NOT over —
         * no matter how quiet it has gone.
         *
         * Without this, a stall longer than the grace ended the utterance
         * mid-word and the audio that followed was charged the full
         * start-of-utterance cushion, which is the hole the owner heard.
         *
         * The backstop is a safety valve, not a tuning knob: if a final frame
         * never arrives at all (dropped stream, server fault) the segment must
         * still resolve, or the mic guard would stay armed for the rest of the
         * call. It is set far beyond any stall this provider has ever shown
         * (max measured 680ms) so it cannot fire during ordinary speech.
         */
        const sawFinalFrame = pendingFinalAckRef.current !== null;
        const waitedMs = Date.now() - drainWaitStartedRef.current;
        if (!sawFinalFrame && waitedMs < DRAIN_WITHOUT_FINAL_BACKSTOP_MS) {
          schedulePcmPlaybackReleaseRef.current?.();
          return;
        }
        drainWaitStartedRef.current = 0;
        // The queue has drained and nothing is still scheduled: the trainee has
        // now actually heard the segment, which is the moment the server is
        // waiting for — not the moment its last chunk arrived.
        completePcmPlaybackDrain();
      }
    }, graceMs);
  }, [completePcmPlaybackDrain, learnedStallMsNow]);
  schedulePcmPlaybackReleaseRef.current = schedulePcmPlaybackRelease;

  /**
   * Arm the handover backstop used while the server is done but local audio is
   * still playing. If Web Audio's onended notification is merely late, the
   * AudioContext clock proves that every scheduled sample has elapsed and we
   * perform the same successful drain/ACK as the normal path. A suspended or
   * genuinely pending context is never reported to the server as completed.
   */
  const armPlaybackHandoverFallback = useCallback(() => {
    if (playbackHandoverFallbackRef.current) return;
    let remainingMs = 0;
    try {
      const ctx = getAudioContext();
      remainingMs = Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000);
    } catch {
      remainingMs = 0;
    }
    playbackHandoverFallbackRef.current = setTimeout(() => {
      playbackHandoverFallbackRef.current = null;

      let scheduleDefinitelyElapsed = false;
      try {
        const ctx = getAudioContext();
        scheduleDefinitelyElapsed = ctx.state === 'running'
          && audioQueueRef.current.length === 0
          && ctx.currentTime >= nextPlayTimeRef.current;
      } catch {
        scheduleDefinitelyElapsed = false;
      }

      if (scheduleDefinitelyElapsed) {
        // onended delivery can be delayed under a busy main thread. At this
        // point the audio clock is beyond the final scheduled sample plus the
        // backstop slack, so these are stale bookkeeping entries, not audible
        // sources. Reconcile them and send the completion ACK exactly once.
        for (const source of scheduledSourcesRef.current) {
          try { source.disconnect(); } catch {}
        }
        scheduledSourcesRef.current.clear();
        currentSourceRef.current = null;
        completePcmPlaybackDrain();
        return;
      }

      // Preserve the existing anti-wedge behavior, but do not forge a
      // playback-completed ACK when the AudioContext is suspended or audio is
      // still pending. The server will correctly resolve it as unconfirmed.
      console.warn('[Audio] playback handover timed out before playback could be confirmed — releasing the floor');
      scheduleMicGuardRelease();
    }, remainingMs + PLAYBACK_HANDOVER_BACKSTOP_MS);
  }, [completePcmPlaybackDrain, scheduleMicGuardRelease]);

  // ── Ringback ("phone ringing" before the customer answers) ────────────────
  // Synthesized (no audio asset): US ringback is 440 Hz + 480 Hz, 2s on / 4s
  // off. We ring from connect until the greeting audio has buffered, masking
  // the cold-socket warm-up so the customer "answers" on a warm pipeline.
  const stopRingback = useCallback(() => {
    ringingRef.current = false;
    if (answerTimerRef.current) { clearTimeout(answerTimerRef.current); answerTimerRef.current = null; }
    if (maxRingTimerRef.current) { clearTimeout(maxRingTimerRef.current); maxRingTimerRef.current = null; }
    const nodes = ringNodesRef.current;
    ringNodesRef.current = null;
    if (nodes) {
      clearInterval(nodes.cadence);
      try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.linearRampToValueAtTime(0, now + 0.05);
      } catch {}
      setTimeout(() => {
        try { nodes.osc1.stop(); nodes.osc2.stop(); } catch {}
        try { nodes.osc1.disconnect(); nodes.osc2.disconnect(); nodes.gain.disconnect(); } catch {}
      }, 80);
    }
  }, []);

  const startRingback = useCallback(() => {
    if (ringingRef.current || ringNodesRef.current) return;
    let ctx: AudioContext;
    try { ctx = getAudioContext(); } catch { return; }
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    try {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      osc1.connect(gain);
      osc2.connect(gain);
      osc1.start();
      osc2.start();
      const RING_LEVEL = 0.05; // gentle — it's a UI cue, not full volume
      const ringOnce = () => {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(RING_LEVEL, t + 0.04);
        gain.gain.setValueAtTime(RING_LEVEL, t + 1.9);
        gain.gain.linearRampToValueAtTime(0, t + 2.0); // 2s on
      };
      ringOnce();
      const cadence = setInterval(ringOnce, 6000); // 2s on + 4s off
      ringNodesRef.current = { osc1, osc2, gain, cadence };
      ringingRef.current = true;
      // Safety: never ring forever if the greeting audio never arrives.
      maxRingTimerRef.current = setTimeout(() => { stopRingback(); }, 15000);
    } catch {
      ringingRef.current = false;
    }
  }, [stopRingback]);

  const stopAudioPlayback = useCallback(() => {
    if (pcmPlaybackReleaseTimerRef.current) {
      clearTimeout(pcmPlaybackReleaseTimerRef.current);
      pcmPlaybackReleaseTimerRef.current = null;
    }
    // Barge-in and hangup both discard queued audio. A segment abandoned this
    // way was NOT heard, and saying so is what lets the engine distinguish an
    // interruption from a line that played out — the playback ledger poisons
    // the segment rather than recording it as delivered.
    const abandoned = pendingFinalAckRef.current;
    scheduledPcmSegmentsRef.current.clear();
    if (abandoned) {
      pendingFinalAckRef.current = null;
      sendPlaybackAck(liveSocketRef.current, abandoned, 'interrupted');
    }
    audioQueueRef.current.length = 0;
    pcmCarryRef.current = null;
    nextPlayTimeRef.current = 0;
    // Discarded audio (barge-in, hangup) ends the utterance as surely as a drain.
    utteranceStartedRef.current = false;
    drainWaitStartedRef.current = 0;
    utteranceFirstChunkAtRef.current = 0;
    lastChunkArrivalRef.current = 0;
    for (const source of scheduledSourcesRef.current) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    scheduledSourcesRef.current.clear();
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
      try { currentSourceRef.current.disconnect(); } catch {}
      currentSourceRef.current = null;
    }
    isPlayingRef.current = false;
    setSpeaking(false);
    releaseMicGuardNow();
  }, [setSpeaking, releaseMicGuardNow]);


  /**
   * How much audio is sitting in the queue, in milliseconds.
   *
   * Derived from the SAME format fields the decoder uses two hundred lines
   * below (16-bit samples, server-advertised rate and channel count), so a
   * format change cannot leave this measuring one thing and playback another.
   * A partial trailing byte is ignored exactly as the decoder ignores it.
   */
  const queuedAudioMs = useCallback((): number => {
    const channels = Math.max(1, serverAudioOutputRef.current.channels || 1);
    const sampleRate = serverAudioOutputRef.current.sampleRate || 24000;
    let frames = 0;
    for (const chunk of audioQueueRef.current) {
      frames += Math.floor(chunk.byteLength / 2 / channels);
    }
    return (frames / sampleRate) * 1000;
  }, []);

  // ── Deepgram Audio Playback ──────────────────────────────────────────────
  const playNextChunk = useCallback(async () => {
    const isPcmStream = serverAudioOutputRef.current.encoding === 'linear16';
    if (audioQueueRef.current.length === 0) return;
    if (!isPcmStream && isPlayingRef.current) return;

    const ctx = getAudioContext();

    // If AudioContext is suspended (unlock from the start-call gesture is an
    // async resume() that can lose the race against the first TTS chunks),
    // KEEP the queued audio and retry shortly — dropping it here silently
    // eats the customer's opening greeting. Don't set isSpeaking — otherwise
    // audio recording gets blocked forever.
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
      if (ctx.state === 'suspended') {
        console.warn('[Audio] AudioContext still suspended — holding audio chunks until unlock');
        isPlayingRef.current = false;
        if (!suspendedRetryTimerRef.current) {
          suspendedRetryTimerRef.current = setTimeout(() => {
            suspendedRetryTimerRef.current = null;
            void playNextChunk();
          }, 150);
        }
        return;
      }
    }
    if (suspendedRetryTimerRef.current) {
      clearTimeout(suspendedRetryTimerRef.current);
      suspendedRetryTimerRef.current = null;
    }

    // AudioContext is running — safe to play and suppress STT.
    // Only write the store on a transition — a per-chunk set() makes every
    // bare useCallStore() consumer re-render 20-50×/s during playback, which
    // janks the main thread and delays WS frame processing (audible as feed
    // gaps).
    if (!useCallStore.getState().isSpeaking) setSpeaking(true);
    isPlayingRef.current = true;

    if (isPcmStream) {
      if (pcmPlaybackReleaseTimerRef.current) {
        clearTimeout(pcmPlaybackReleaseTimerRef.current);
        pcmPlaybackReleaseTimerRef.current = null;
      }
      // Audio resumed, so the silence that was being timed is over. Without
      // this the backstop measures cumulative quiet across a whole utterance
      // and would eventually fire DURING speech — the very thing it exists to
      // avoid. It times the CURRENT gap, not the sum of every gap.
      drainWaitStartedRef.current = 0;

      /**
       * ── LEARN THE PROVIDER'S START-OF-UTTERANCE STALL ────────────────────
       *
       * Arrival gaps in the OPENING of an utterance are the stall we must
       * bridge. Only the opening window counts: a gap later in an utterance is
       * absorbed by the cushion the burst delivery has already built, and
       * widening the lead for those would cost latency for nothing (owner
       * ruling: chunks continuing an utterance keep the small lead).
       */
      const nowMs = Date.now();
      /**
       * The window opens at THIS utterance's first audio chunk — never at a
       * control frame, which is what timed the whole first-audio path and
       * produced a 534ms "stall" against a 200ms real one.
       */
      if (utteranceFirstChunkAtRef.current > 0 && lastChunkArrivalRef.current > 0) {
        const sinceUtteranceStart = nowMs - utteranceFirstChunkAtRef.current;
        if (sinceUtteranceStart <= UTTERANCE_START_STALL_WINDOW_MS) {
          const gap = nowMs - lastChunkArrivalRef.current;
          if (gap > currentUtteranceStallRef.current) currentUtteranceStallRef.current = gap;
        }
      }
      lastChunkArrivalRef.current = nowMs;

      const hasScheduledAudio = scheduledSourcesRef.current.size > 0;
      /**
       * ── THE QUESTION IS "IS THIS THE START OF AN UTTERANCE?" ─────────────
       *
       * NOT "is the graph warm". The provider's stall belongs to the provider;
       * a warm graph does nothing to bridge it. `continuing` is the only case
       * that may take the small lead, and it is exactly the case where audio
       * for THIS utterance is already flowing.
       */
      const continuing = utteranceStartedRef.current;
      const buffered = hasScheduledAudio || nextPlayTimeRef.current > ctx.currentTime;
      const warm = continuing && buffered;
      /**
       * ── A DRAIN MID-UTTERANCE IS AN UNDERRUN, NOT AN UTTERANCE START ─────
       *
       * THE DEFECT. `warm` required the buffer to be non-empty. So when
       * playback drained in the MIDDLE of a sentence, `warm` went false and
       * this block fell through to the utterance-START cushion and executed
       * `nextPlayTime = currentTime + cushion` — pushing playback 435ms into
       * the future mid-word. That is not a lead. It is a hole punched into her
       * speech, and it is the breaking up.
       *
       * MEASURED, from the owner's own console on a call that broke
       * throughout: `utterance start cushion 435ms` logged SIX times inside a
       * single utterance, then four times inside the next — roughly 2.6
       * seconds of inserted silence in one sentence, in 435ms pieces.
       *
       * WHY IT GOT WORSE WHEN THE CUSHION WAS LEARNED. The size of every hole
       * IS the learned cushion, so the better the learner tracked the
       * provider's stall, the bigger the holes it punched. That is exactly the
       * regression reported at the time ("much worse after your fix — 600ms,
       * learned stall 534ms"), and it was never a tuning problem: the value
       * was being applied somewhere it was never meant to apply.
       *
       * THE RULE. The utterance-start cushion bridges the provider's stall
       * BEFORE the first audio of an utterance. Once audio for this utterance
       * is flowing, a drain is an underrun, and there is already a designed
       * recovery for that: `PCM_PLAYBACK_MIN_LEAD_SECONDS`, rebuilt exactly as
       * the per-chunk underrun path below rebuilds it. The SAME constant is
       * used deliberately, so the two recoveries cannot drift apart.
       *
       * The cushion is not needed to survive the next stall — the audio that
       * just arrived is what does that. A burst delivers hundreds of
       * milliseconds at once; adding 435ms in front of it buys nothing and
       * costs a hole.
       */
      const midUtteranceDrain = continuing && !buffered;
      if (!utteranceStartedRef.current) {
        // Bank the PREVIOUS utterance's opening stall, then start this one.
        if (currentUtteranceStallRef.current > 0) {
          const ring = startStallSamplesRef.current;
          ring.push(currentUtteranceStallRef.current);
          if (ring.length > STALL_SAMPLE_WINDOW) ring.shift();
          console.log(`[Audio] start-of-utterance stall ${currentUtteranceStallRef.current}ms (recent: ${ring.join(',')})`);
        }
        currentUtteranceStallRef.current = 0;
        utteranceStartedRef.current = true;
        utteranceFirstChunkAtRef.current = nowMs;
      }
      /**
       * Sized from what the provider actually did, with headroom, and bounded
       * so it can never be worse than what shipped before nor stall the call.
       */
      const learnedStallMs = learnedStallMsNow();
      const learnedStartCushionS = Math.min(
        UTTERANCE_START_CUSHION_MAX_S,
        Math.max(
          UTTERANCE_START_CUSHION_MIN_S,
          (learnedStallMs + UTTERANCE_START_CUSHION_HEADROOM_MS) / 1000,
        ),
      );
      // The call's FIRST playback (greeting) gets the big cold-start buffer —
      // cold socket + just-unlocked AudioContext. Every later cold start
      // (between-turn) is on a warm socket, so the normal lead is enough.
      // A mid-utterance drain never consumes the cold start: the call's first
      // playback has plainly already happened if an utterance is in progress.
      const coldStart = !warm && !midUtteranceDrain && !coldStartDoneRef.current;
      const startDelay = warm
        // Continuing an utterance: unchanged small lead. Widening this would
        // cost latency for nothing.
        ? PCM_PLAYBACK_CONTINUE_DELAY_SECONDS
        : midUtteranceDrain
          // Underrun inside a sentence — rebuild the small lead and resume.
          // NEVER the utterance-start cushion: see the block above.
          ? PCM_PLAYBACK_MIN_LEAD_SECONDS
          : coldStart
            // The call's very first playback keeps the big cold-start buffer
            // (cold socket + just-unlocked AudioContext), and it is already
            // larger than any learned cushion.
            ? PCM_PLAYBACK_COLD_START_DELAY_SECONDS
            // The start of an utterance: bridge the provider's own stall.
            : learnedStartCushionS;
      if (midUtteranceDrain) {
        // Distinct from an utterance start, and counted: this is the event
        // that used to be mislabelled as one. If these are frequent the
        // provider is stalling badly, but they no longer punch 435ms holes.
        console.warn(
          `[Audio] mid-utterance underrun — resuming with `
          + `${Math.round(PCM_PLAYBACK_MIN_LEAD_SECONDS * 1000)}ms lead (was inserting ${Math.round(learnedStartCushionS * 1000)}ms)`,
        );
      } else if (!warm && !coldStart) {
        console.log(
          `[Audio] utterance start cushion ${Math.round(startDelay * 1000)}ms `
          + `(p${Math.round(STALL_PERCENTILE * 100)} of last ${startStallSamplesRef.current.length} stalls = ${learnedStallMs}ms)`,
        );
      }
      if (!warm && !midUtteranceDrain) coldStartDoneRef.current = true;
      /**
       * ── LEAD IS NEVER LARGER THAN THE AUDIO WE HOLD (2026-09-10) ──────────
       *
       * The clamp below is where silence is actually inserted; the `underran`
       * test further down could never fire, because this line has already
       * pushed `nextPlayTime` at least `startDelay` into the future before the
       * loop reads it. So every "0 client underruns" measurement taken from
       * `pcmUnderrunsRef` was reading a dead instrument. Both are fixed here.
       *
       * THE DEFECT. On a mid-utterance drain the lead was an unconditional
       * 120ms. Scheduling 120ms out only helps if we hold at least 120ms of
       * audio to play into it; if we hold one 40ms chunk, the other 80ms is
       * silence we manufactured on top of the gap the provider already left.
       * Under sustained below-realtime delivery that repeats per chunk, which
       * is the cascade heard as mid-word break-up.
       *
       * THE RULE. Lead is capped by the audio actually queued. Holding three
       * chunks, the full lead is free — they schedule back to back. Holding
       * one, we resume at the playhead and the only gap is the real one.
       * Deepgram's own reference player re-baselines with zero added lead
       * (@deepgram/agents: `Math.max(ctx.currentTime, nextStartTime)`); this
       * keeps that floor while still banking lead whenever it costs nothing.
       *
       * Utterance STARTS are untouched: a start cushion is pre-roll chosen
       * before playback begins, not silence spliced into speech.
       */
      const ranDryBy = nextPlayTimeRef.current > 0
        ? Math.max(0, ctx.currentTime - nextPlayTimeRef.current)
        : 0;
      if (ranDryBy > 0 && (warm || midUtteranceDrain)) {
        pcmUnderrunsRef.current += 1;
        console.warn(
          `[Audio] playback underrun #${pcmUnderrunsRef.current} — buffer ran dry by `
          + `${Math.round(ranDryBy * 1000)}ms`,
        );
      }
      const effectiveStartDelay = (warm || midUtteranceDrain)
        ? Math.min(startDelay, queuedAudioSeconds())
        : startDelay;
      if (nextPlayTimeRef.current < ctx.currentTime + effectiveStartDelay) {
        nextPlayTimeRef.current = ctx.currentTime + effectiveStartDelay;
      }

      while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift()!;
        try {
          if (chunk.byteLength < 2) continue;

          const channels = Math.max(1, serverAudioOutputRef.current.channels || 1);
          const sampleRate = serverAudioOutputRef.current.sampleRate || 24000;
          let bytes = new Uint8Array(chunk);
          if (pcmCarryRef.current) {
            const merged = new Uint8Array(pcmCarryRef.current.length + bytes.length);
            merged.set(pcmCarryRef.current, 0);
            merged.set(bytes, pcmCarryRef.current.length);
            bytes = merged;
            pcmCarryRef.current = null;
          }
          if (bytes.length % 2 === 1) {
            pcmCarryRef.current = bytes.slice(bytes.length - 1);
            bytes = bytes.slice(0, -1);
          }
          if (bytes.length < 2) continue;

          const frameCount = Math.floor(bytes.length / 2 / channels);
          if (frameCount < 1) continue;

          const audioBuffer = ctx.createBuffer(
            channels,
            frameCount,
            sampleRate,
          );
          const view = new DataView(bytes.buffer, bytes.byteOffset, frameCount * channels * 2);
          for (let frame = 0; frame < frameCount; frame += 1) {
            for (let channel = 0; channel < channels; channel += 1) {
              const sample = view.getInt16((frame * channels + channel) * 2, true);
              audioBuffer.getChannelData(channel)[frame] = Math.max(-1, Math.min(1, sample / 32768));
            }
          }

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          scheduledSourcesRef.current.add(source);
          currentSourceRef.current = source;

          // Underrun accounting happens once per pass, above, where the queue
          // depth is known. Here we only need a legal start time: the running
          // schedule, or the playhead plus Web Audio's scheduling margin if
          // the schedule has fallen behind. Pushing further out would add
          // silence to a gap that has already been heard.
          const startAt = Math.max(nextPlayTimeRef.current, ctx.currentTime + 0.005);
          source.onended = () => {
            scheduledSourcesRef.current.delete(source);
            try { source.disconnect(); } catch {}
            if (currentSourceRef.current === source) {
              currentSourceRef.current = null;
            }
            if (scheduledSourcesRef.current.size === 0) {
              schedulePcmPlaybackRelease();
            }
          };
          try {
            source.start(startAt);
            const identity = pcmIdentitiesRef.current.get(chunk);
            if (identity) scheduledPcmSegmentsRef.current.add(pcmSegmentKey(identity));
          } catch (err) {
            // Never leave a source that failed to start in the scheduled set:
            // it has no onended event, so one stale entry would force every
            // later turn through the handover backstop.
            scheduledSourcesRef.current.delete(source);
            if (currentSourceRef.current === source) currentSourceRef.current = null;
            try { source.disconnect(); } catch {}
            throw err;
          }
          // THE TRUE START OF AUDIBLE AUDIO. `startAt` is an AudioContext
          // timestamp, so the wall-clock moment is now plus however far ahead
          // it was scheduled — that offset IS the client buffer, and it is
          // reported rather than hidden.
          const pendingAudible = pendingAudibleIdentityRef.current;
          if (pendingAudible) {
            pendingAudibleIdentityRef.current = null;
            const leadMs = Math.max(0, Math.round((startAt - ctx.currentTime) * 1000));
            try {
              liveSocketRef.current?.send(JSON.stringify({
                type: 'latency_client',
                stage: 'audible_playback_started',
                identity: pendingAudible,
                scheduledLeadMs: leadMs,
                underruns: pcmUnderrunsRef.current,
              }));
            } catch {}
          }
          nextPlayTimeRef.current = startAt + audioBuffer.duration;
          /**
           * ── THE PLAYHEAD, REPORTED (2026-09-10) ──────────────────────────
           *
           * The server used to model this by advancing a clock as chunks
           * arrived FROM DEEPGRAM, which assumes the browser plays instantly
           * and holds nothing. It holds the start cushion, the cold start and
           * everything still queued, so the two clocks drift apart by exactly
           * the amount that matters — and the server reads its own clock to
           * decide when the customer has stopped speaking, when to arm
           * barge-in and when to open the trainee's microphone.
           *
           * This is the only number that answers it, and only the browser has
           * it. Throttled, because the schedule moves per 40ms chunk and the
           * server needs the truth, not the resolution.
           */
          const nowForReport = Date.now();
          if (nowForReport - lastPlayheadReportAtRef.current >= 250) {
            lastPlayheadReportAtRef.current = nowForReport;
            const bufferedAheadMs = Math.max(
              0,
              Math.round((nextPlayTimeRef.current - ctx.currentTime) * 1000),
            );
            try {
              liveSocketRef.current?.send(JSON.stringify({
                type: 'playback_progress',
                bufferedAheadMs,
                underruns: pcmUnderrunsRef.current,
              }));
            } catch {}
          }
        } catch (err) {
          console.error('[Audio] PCM playback error:', err);
        }
      }
      if (scheduledSourcesRef.current.size === 0) {
        schedulePcmPlaybackRelease();
      }
      return;
    }

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift()!;
      try {
        if (chunk.byteLength < 4) continue;

        // Decode MP3/WAV/AAC natively. slice() avoids decodeAudioData detaching the original buffer.
        const audioBuffer = await ctx.decodeAudioData(chunk.slice(0));

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentSourceRef.current = source;

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 30000);
          source.onended = () => {
            clearTimeout(timeout);
            try { source.disconnect(); } catch {}
            if (currentSourceRef.current === source) {
              currentSourceRef.current = null;
            }
            resolve();
          };
          source.start();
        });
      } catch (err) {
        console.error('[Audio] Playback error:', err);
      }
    }

    isPlayingRef.current = false;
    setSpeaking(false);
  }, [schedulePcmPlaybackRelease, setSpeaking, learnedStallMsNow]);

  // ── Reconnect state (refs, not state, to avoid effect churn) ───────────
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);

  const cancelPendingReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    wsTicketRef.current = null;
    wsTicketRequestRef.current = null;
  }, [sessionId]);

  const requestWsTicket = useCallback((reason: 'prefetch' | 'connect'): Promise<WsTicketCache> => {
    if (!sessionId) return Promise.reject(new Error('No sessionId for WebSocket ticket'));

    const now = Date.now();
    const cached = wsTicketRef.current;
    if (cached?.sessionId === sessionId && cached.expiresAt > now + 1000) {
      return Promise.resolve(cached);
    }

    const pending = wsTicketRequestRef.current;
    if (pending?.sessionId === sessionId) {
      return pending.promise;
    }

    const startedAt = Date.now();
    console.log(`[Latency] WS ticket ${reason} started`);
    const promise = authApi.wsTicket(sessionId, token || undefined)
      .then(({ data }) => {
        const issuedAt = Date.now();
        const ticket = {
          sessionId,
          ticket: data.ticket,
          expiresAt: issuedAt + Math.max(1, data.expiresIn - 5) * 1000,
          issuedAt,
        };
        wsTicketRef.current = ticket;
        console.log(`[Latency] WS ticket ${reason} ready in ${Date.now() - startedAt}ms`);
        return ticket;
      })
      .finally(() => {
        if (wsTicketRequestRef.current?.promise === promise) {
          wsTicketRequestRef.current = null;
        }
      });

    wsTicketRequestRef.current = { sessionId, promise };
    return promise;
  }, [sessionId, token]);

  useEffect(() => {
    if (!sessionId || !token || status !== 'idle') return;
    requestWsTicket('prefetch').catch((err) => {
      console.warn('[WS] Ticket prefetch failed; will retry on Start Call', err);
    });
  }, [sessionId, token, status, requestWsTicket]);

  const connect = useCallback(() => {
    if (!sessionId) return;

    stopAudioPlayback();
    cancelAllSpeech();
    awaitingCustomerAudioCompleteRef.current = false;

    // Ensure AudioContext exists before connection
    getAudioContext();

    intentionalCloseRef.current = false;

    // Use a pre-minted one-shot ticket when available; otherwise mint one now.
    // The JWT never appears in the URL, and every ticket is consumed once.
    // If the ticket call fails we surface 'failed' status; auth.ts handles 401.
    const connectStartedAt = Date.now();
    requestWsTicket('connect')
      .then(({ ticket, issuedAt }) => {
        wsTicketRef.current = null;
        console.log(`[Latency] WS ticket available after ${Date.now() - connectStartedAt}ms (age ${Date.now() - issuedAt}ms)`);
        console.log('[WS] Got ticket, connecting');
        // The ticket travels as the Sec-WebSocket-Protocol value.
        const socket = new WebSocket(`${WS_URL}?sessionId=${sessionId}`, ticket);
        socket.binaryType = 'arraybuffer';
        attachSocketHandlers(socket);
      })
      .catch((err) => {
        console.error('[WS] Ticket mint failed', err);
        // No reconnect when auth fails — let the user re-login flow trigger.
        setStatus('completed');
      });

    function attachSocketHandlers(socket: WebSocket) {
    socket.onopen = () => {
      console.log(`[Latency] WS open in ${Date.now() - connectStartedAt}ms`);
      console.log('[WS] Connected');
      // First successful connect after a reconnect cycle clears the counter.
      reconnectAttemptRef.current = 0;
      historyReplaySeenRef.current = false;
      setStatus('connecting');
      liveSocketRef.current = socket;
      setWs(socket);
    };

    socket.onmessage = (event) => {
      // Binary audio data from Deepgram TTS — queue for playback
      if (event.data instanceof ArrayBuffer) {
        if (event.data.byteLength > 0) {
          if (!firstAudioPlaybackLoggedRef.current) {
            firstAudioPlaybackLoggedRef.current = true;
            console.log('[Latency] first audio received by browser');
          }

          /**
           * Roleplay audio arrives identity-tagged: a header naming the
           * connection, session, turn and segment, then the samples. Only the
           * samples are audio — playing the header is what made the customer
           * sound like noise. An untagged frame (the other pipelines) decodes
           * to null and is played whole, exactly as before.
           */
          const decoded = decodeAudioFrame(event.data);
          const pcm = decoded ? decoded.pcm : event.data;

          if (decoded) {
            const identity = identityOf(decoded.header);
            if (pcm.byteLength >= 2) pcmIdentitiesRef.current.set(pcm, identity);
            // First chunk of a segment: tell the server it has started, so the
            // turn engine knows the line reached the trainee rather than
            // timing out waiting for a confirmation that never comes.
            //
            // ── RECEIPT IS NOT PLAYBACK (Codex review, 2026-08-31) ─────────
            // This fired on FRAME RECEIPT, so the server's "playback started"
            // excluded the entire client-side buffer — 220ms cold, 120ms warm
            // — and the end-to-end figure could never reconcile. The ack still
            // goes now (the turn engine needs to know the line is alive), but
            // the moment audio is genuinely AUDIBLE is reported separately
            // from source.start(), below, as `audible_playback_started`.
            if (decoded.header.chunkSequence === 0) {
              sendPlaybackAck(socket, identity, 'started');
              pendingAudibleIdentityRef.current = identity;
            }
            // The final chunk completes the segment. The server treats an
            // unacknowledged segment as never heard, which is what left the
            // opening line unpersisted.
            if (decoded.header.final) {
              pendingFinalAckRef.current = identity;
            }
          }

          // Audio without a preceding customer_response_started (e.g. the
          // greeting) must still arm the mic guard.
          activateMicGuard();
          audioQueueRef.current.push(pcm);
          // Ringback gate: while ringing (warming up), DON'T play yet — buffer
          // the greeting and "answer" after a short window. The ring window
          // doubles as the cold-start pre-buffer, so the greeting starts warm.
          if (ringingRef.current) {
            if (!answerTimerRef.current) {
              answerTimerRef.current = setTimeout(() => {
                answerTimerRef.current = null;
                /**
                 * ── THE RING WINDOW MUST PROVE IT PRE-BUFFERED ──────────────
                 *
                 * This line used to read `coldStartDoneRef.current = true` with
                 * the comment "the ring window WAS the pre-buffer". It ASSUMED
                 * the greeting had arrived during the window and never checked.
                 *
                 * MEASURED, 10 consecutive real calls: the first utterance was
                 * scheduled with a lead of EXACTLY 220ms every single time —
                 * the learned-path floor with an empty stall ring, never the
                 * 500ms cold-start buffer three lines below claims it gets
                 * ("already larger than any learned cushion"). Declaring the
                 * cold start done here is what routed the greeting away from
                 * it. The code did not do what its own comment said.
                 *
                 * The claim is now CHECKED rather than asserted. The window
                 * genuinely replaced the pre-buffer only if it left at least as
                 * much audio in hand as the cold-start buffer would have. If it
                 * did, the greeting starts from a full queue and the small lead
                 * is right. If it did not — the greeting is still streaming, or
                 * stalled inside the window — the cold start is left UNSPENT
                 * and the greeting gets its full buffer.
                 *
                 * Derived, not tuned: the threshold is the cold-start constant
                 * itself, so the two can never drift apart. This can only ADD
                 * cushion when the queue is short; it can never take any away.
                 */
                const queuedMs = queuedAudioMs();
                const preBuffered = queuedMs >= PCM_PLAYBACK_COLD_START_DELAY_SECONDS * 1000;
                coldStartDoneRef.current = preBuffered;
                stopRingback();
                console.log(
                  `[Audio] ringback answered — ${Math.round(queuedMs)}ms of greeting queued; `
                  + `${preBuffered ? 'genuinely pre-buffered, small lead' : 'NOT pre-buffered, keeping the cold-start buffer'}`,
                );
                playNextChunk();
              }, RINGBACK_ANSWER_BUFFER_MS);
            }
            return;
          }
          playNextChunk();
        }
        return;
      }

      // Defensive parse — a malformed frame must not crash the handler.
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.warn('[WS] Dropped malformed frame');
        return;
      }
      console.log('[WS] Message:', msg.type, msg.text?.substring(0, 50) || '');

      switch (msg.type) {
        case 'ready':
          console.log(`[Latency] WS ready in ${Date.now() - connectStartedAt}ms`);
          resetAgentAudioMetrics(agentAudioMetricsRef.current);
          agentAudioMetricTurnIndexRef.current = 0;
          firstMicFrameLoggedRef.current = false;
          setAudioModes({
            sttMode: msg.sttMode === 'deepgram' ? 'deepgram' : 'browser',
            ttsEnabled: Boolean(msg.ttsEnabled),
            voicePipeline: msg.pipeline === 'deepgram_agent' || msg.pipeline === 'custom_realtime' || msg.pipeline === 'custom_flux'
              ? msg.pipeline
              : 'legacy',
          });
          useBrowserTtsRef.current = !msg.ttsEnabled;
          if (msg.audioOutput?.encoding === 'linear16') {
            const advertised = Number(msg.audioOutput.sampleRate) || 24000;
            /**
             * The buffers are built at the SERVER's rate and played in our
             * context. Those two agreeing is the whole of the fix above — if
             * the server is ever reconfigured away from `PLAYBACK_SAMPLE_RATE`
             * the per-buffer resample comes back, silently. Say so instead.
             */
            if (advertised !== PLAYBACK_SAMPLE_RATE) {
              console.warn(
                `[Audio] server streams ${advertised}Hz but the playback context is `
                + `${PLAYBACK_SAMPLE_RATE}Hz — per-buffer resampling is back and seams may tick`,
              );
            }
            serverAudioOutputRef.current = {
              encoding: 'linear16',
              sampleRate: advertised,
              channels: Number(msg.audioOutput.channels) || 1,
            };
          } else {
            serverAudioOutputRef.current = {
              encoding: 'encoded',
              sampleRate: 24000,
              channels: 1,
            };
          }
          const readyGender = msg.customerVoiceGender || msg.personaGender;
          if (readyGender === 'male' || readyGender === 'female') {
            personaGenderRef.current = readyGender;
          }
          if (msg.customerVoiceModel || msg.customerVoiceGender) {
            console.log('[Audio] Customer voice locked', {
              gender: msg.customerVoiceGender || personaGenderRef.current,
              model: msg.customerVoiceModel || 'browser',
            });
          }
          customerTokenBufferRef.current = '';
          spokeStreamingCustomerRef.current = false;
          firstAudioPlaybackLoggedRef.current = false;
          // New call/connection → the socket is cold again; let the next
          // playback (greeting, or first reply after a reconnect) pre-buffer.
          coldStartDoneRef.current = false;
          setStatus('active');
          // ── RING ONLY ON A FRESH CALL ────────────────────────────────────
          //
          // MEASURED: intermittent beeps during live calls. The ringback is a
          // 440 Hz + 480 Hz oscillator pair — US ringback tone, i.e. literally
          // a beep — on `setInterval(ringOnce, 6000)`: 2s on, 4s off, for up
          // to 15s. `ready` is sent on EVERY socket open, including a mid-call
          // reconnect, and on a reconnect there is no greeting audio to
          // "answer" it. It then rang over the live conversation until a
          // history_message arrived or the 15s timer expired — two to three
          // audible bursts, at the 6s cadence the trainee reported.
          //
          // A reconnect is not a fresh dial, so it does not ring. The first
          // `ready` of a session does.
          if (!hasRungThisSessionRef.current) {
            hasRungThisSessionRef.current = true;
            startRingback();
          } else {
            // Belt and braces: a stale ring from before the drop must not
            // survive into the reconnected call.
            stopRingback();
          }
          console.log('[WS] TTS:', msg.ttsEnabled ? 'Deepgram' : 'Off', '| STT:', msg.sttMode);
          break;

        case 'latency_mark':
          if (msg.stage === 'agent_received') {
            firstAudioPlaybackLoggedRef.current = false;
          }
          console.log('[Latency]', msg.stage, `${msg.elapsedMs}ms`, msg);
          break;

        /**
         * ── ANY SIGN THE CALL IS LIVE STOPS THE RING (2026-08-31) ──────────
         *
         * MEASURED (owner, live call): occasional beeps "in between", after
         * the break-up was fixed. The ringback is a 440+480 Hz oscillator pair
         * on a 6-second cadence for up to 15 SECONDS, and it was stopped by
         * exactly one thing — the first greeting AUDIO chunk reaching the PCM
         * branch. Every other route into a live conversation left it ringing:
         * a slow greeting, TTS disabled, or the trainee simply speaking first.
         * It then rang at 0s, 6s and 12s over the start of the call.
         *
         * Client-reported underruns were ZERO across both calls, so this is
         * not a playback artefact, and the browser has exactly one tone
         * generator — this one.
         *
         * The ring means "waiting for the customer to pick up". Once anyone
         * has said anything, they have picked up. Stopping is idempotent and
         * cheap, so it is done on every such signal rather than trusting one.
         */
        case 'agent_turn_received':
          stopRingback();
          if (msg.text?.trim()) {
            agentTurnReceivedCallbackRef.current?.(msg.text.trim());
          }
          break;

        case 'agent_turn_buffered':
          if (msg.text?.trim()) {
            agentTurnReceivedCallbackRef.current?.(msg.text.trim());
          }
          break;

        case 'user_started_speaking':
          console.log('[Latency] Deepgram detected user speech / barge-in');
          stopAudioPlayback();
          cancelAllSpeech();
          // Barge-in: the backend will follow with a customer_text_complete
          // containing only what was actually spoken — drop the interim.
          setInterimCustomerText('');
          awaitingCustomerAudioCompleteRef.current = false;
          customerResponseCompleteCallbackRef.current?.();
          break;

        case 'customer_response_started':
          stopRingback();
          /**
           * ── THIS FRAME MUST NOT ANCHOR THE UTTERANCE (fix, 2026-09-03) ────
           *
           * It used to reset the per-utterance state here, and that was wrong
           * twice over. MEASURED: the learner reported a 534ms "stall" against
           * a 200ms stall measured from the provider's own send timestamps.
           *
           *   1. WRONG INTERVAL. This frame is sent at `llm-orchestrator.ts`
           *      BEFORE generation — `sendResponseStarted()` runs, then
           *      `let generated = ...`. So the window opened before the LLM had
           *      produced a word and the learner timed the whole first-audio
           *      path, not the provider's chunk stall. That is the 534ms.
           *   2. FIRED TWICE. `sendResponseStarted()` has three call sites and
           *      under eager-EOT speculation a provisional turn can send it,
           *      be voided, and the confirmed turn send it again — MID
           *      UTTERANCE. The reset then made the next chunk look like an
           *      utterance start and applied the full cushion as a 600ms HOLE
           *      inside her speech. That was the regression, not the cushion.
           *
           * The utterance is now anchored on its own FIRST AUDIO CHUNK and
           * released only when playback drains, so no control frame can
           * re-trigger a start cushion mid-stream.
           */
          console.log('[Latency] customer response started');
          activateMicGuard();
          awaitingCustomerAudioCompleteRef.current = true;
          customerResponseStartedCallbackRef.current?.();
          break;

        case 'customer_text': {
          lastCustomerTextRef.current = msg.text;
          addMessage({ id: crypto.randomUUID(), role: 'customer', content: msg.text, timestamp: new Date(), isFinal: true });
          // Speak via browser TTS (free, client-side) — pause STT while speaking
          speakCustomerChunk(msg.text);
          break;
        }

        case 'customer_ack': {
          // Micro-acknowledgment filler — don't add to transcript.
          // Only speak via browser TTS if server TTS is off (server already enqueued its own audio).
          if (useBrowserTtsRef.current) {
            speakCustomerChunk(msg.text);
          }
          break;
        }

        case 'history_message': {
          // Reconnect replay — no fresh greeting is coming, so stop ringing.
          stopRingback();
          // The server resends the persisted transcript. The UI usually still
          // has those rows (only the socket died), so the first replay frame
          // REPLACES the transcript instead of appending — appending
          // duplicated the entire call history on every reconnect.
          if (!historyReplaySeenRef.current) {
            historyReplaySeenRef.current = true;
            clearTranscript();
          }
          addMessage({
            id: crypto.randomUUID(),
            role: msg.role === 'agent' ? 'agent' : 'customer',
            content: msg.text,
            timestamp: new Date(),
            isFinal: true,
          });
          break;
        }

        case 'agent_transcript': {
          // In the custom pipelines the BACKEND owns endpointing and turn
          // finalization — feeding finals into the client-side turn pipeline
          // (queueAgentSpeech → endpoint timer → text_input) would echo the
          // same utterance back and process every turn twice. In those modes
          // transcripts are captions only; legacy keeps the full pipeline.
          const clientOwnsTurns = !useCallStore.getState().voicePipeline.startsWith('custom_');
          if (msg.isFinal) {
            // Final STT result — append to text input for user to review & send
            setInterimTranscript('');
            if (clientOwnsTurns && sttFinalCallbackRef.current && msg.text?.trim()) {
              sttFinalCallbackRef.current(msg.text.trim());
            }
          } else {
            setInterimTranscript(msg.text);
            if (clientOwnsTurns && sttInterimCallbackRef.current && msg.text?.trim()) {
              sttInterimCallbackRef.current(msg.text.trim());
            }
          }
          break;
        }

        case 'agent_text_final':
          {
            const metrics = finishAgentAudioMetrics(
              agentAudioMetricsRef.current,
              msg.text || '',
              ++agentAudioMetricTurnIndexRef.current,
            );
            if (metrics && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'agent_turn_metrics', metrics }));
            }
          }
          addMessage({
            id: crypto.randomUUID(),
            role: 'agent',
            content: msg.text,
            timestamp: new Date(),
            isFinal: true,
          });
          setInterimTranscript('');
          break;

        case 'customer_token': {
          if (!msg.token) break;
          // The custom pipelines stream per-sentence tokens while SERVER
          // audio plays — build the interim "Customer (speaking…)" bubble;
          // never speak them locally. Finalized on customer_text_complete.
          if (useCallStore.getState().voicePipeline.startsWith('custom_')) {
            setInterimCustomerText(useCallStore.getState().interimCustomerText + msg.token);
            break;
          }
          if (!useBrowserTtsRef.current) break;

          customerTokenBufferRef.current += msg.token;

          // Strip state blocks, any XML tags, and bare JSON state leaks
          customerTokenBufferRef.current = customerTokenBufferRef.current
            .replace(/<state>[\s\S]*?<\/state>/g, '')
            .replace(/<state>[\s\S]*$/, '')
            .replace(/<\/?[a-z][^>]*>/gi, '')
            .replace(/\{[\s\S]*?"stage"[\s\S]*?\}/g, '');

          const boundary = customerTokenBufferRef.current.match(/^([\s\S]*?[.!?])(\s+|$)([\s\S]*)$/);
          if (boundary && boundary[1].trim().length >= 24) {
            const chunk = boundary[1].trim();
            customerTokenBufferRef.current = boundary[3] || '';
            spokeStreamingCustomerRef.current = true;
            speakCustomerChunk(chunk);
          }
          break;
        }

        case 'customer_text_complete':
          stopRingback();
          setInterimCustomerText('');
          if (lastCustomerTextRef.current === msg.text) {
            lastCustomerTextRef.current = null;
          } else {
            lastCustomerTextRef.current = null;
            addMessage({ id: crypto.randomUUID(), role: 'customer', content: msg.text, timestamp: new Date(), isFinal: true });
            // Only speak if we haven't already spoken it via 'customer_text'
            if (useBrowserTtsRef.current) {
              const remainder = customerTokenBufferRef.current.trim();
              if (spokeStreamingCustomerRef.current) {
                if (remainder) speakCustomerChunk(remainder);
              } else {
                speakCustomerChunk(msg.text);
              }
            }
          }
          customerTokenBufferRef.current = '';
          spokeStreamingCustomerRef.current = false;
          if (useBrowserTtsRef.current && awaitingCustomerAudioCompleteRef.current) {
            awaitingCustomerAudioCompleteRef.current = false;
            customerResponseCompleteCallbackRef.current?.();
          }
          break;

        case 'tts_complete':
          // The SERVER has finished streaming this turn's audio. That is not
          // the same as the trainee having heard it: the browser is holding
          // whatever has not played yet. Releasing the floor here is what let
          // the trainee talk over a still-playing reply and get it cut off, so
          // when audio is still pending we defer to schedulePcmPlaybackRelease
          // (source.onended), with a backstop in case that never lands.
          customerAudioStreamDoneRef.current = true;
          if (pcmPlaybackPending()) {
            armPlaybackHandoverFallback();
            break;
          }
          scheduleMicGuardRelease();
          break;

        case 'tts_failed':
          // ElevenLabs failed for this sentence.
          // Do NOT fall back to browser TTS when server TTS is enabled —
          // mixing two audio systems causes overlapping/conflicting audio.
          // The sentence is simply skipped; the text is already displayed.
          if (useBrowserTtsRef.current && msg.text) {
            // Only speak via browser if server TTS is fully disabled
            speakCustomerChunk(msg.text);
          }
          if (!useBrowserTtsRef.current) {
            // Same rule as tts_complete: earlier sentences of this reply may
            // still be playing even though this one failed to synthesize.
            customerAudioStreamDoneRef.current = true;
            if (pcmPlaybackPending()) {
              armPlaybackHandoverFallback();
              break;
            }
            scheduleMicGuardRelease();
          }
          break;

        case 'session_ended':
          // ── THE TRAINEE MUST SEE THE CALL END ────────────────────────────
          // This set `status: 'completed'` and stopped the audio, and that was
          // all: a customer hanging up looked identical to the audio failing,
          // and nothing stopped the trainee talking into a dead line. The
          // server now names the ending, so record it and close the surface.
          useCallStore.getState().endCall(
            msg.message || 'The call has ended.',
            msg.outcome ?? null,
          );
          stopRingback();
          stopAudioPlayback();
          setInterimCustomerText('');
          resetAgentAudioMetrics(agentAudioMetricsRef.current);
          firstMicFrameLoggedRef.current = false;
          break;

        case 'coaching_tip':
          addCoachingTip({
            id: crypto.randomUUID(),
            tip: msg.tip,
            tipType: msg.tipType,
            priority: msg.priority,
            positive: msg.positive,
            timestamp: new Date(),
          });
          break;

        case 'error':
          console.error('[WS] Server error:', msg.message);
          break;
      }
    };

    socket.onclose = (e) => {
      console.log('[WS] Closed:', e.code, e.reason);
      liveSocketRef.current = null;
      setWs(null);
      stopRingback();
      stopAudioPlayback();
      cancelAllSpeech();
      awaitingCustomerAudioCompleteRef.current = false;

      // Don't reconnect on user-initiated close or normal session-ended.
      // Code 1000 = normal closure; 4xxx = our auth/session rejection codes.
      const isAuthFailure = e.code >= 4000 && e.code < 5000 && e.code !== 4099;
      const isNormalClose = e.code === 1000;
      if (intentionalCloseRef.current || isNormalClose || isAuthFailure) {
        return;
      }

      // Server restart (1012) and abnormal closures (1006) → reconnect.
      const attempt = reconnectAttemptRef.current;
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        console.error('[WS] Max reconnect attempts reached');
        setStatus('completed');
        return;
      }
      const delay = RECONNECT_BACKOFF_MS[attempt];
      reconnectAttemptRef.current = attempt + 1;
      console.log(`[WS] Scheduling reconnect attempt ${attempt + 1} in ${delay}ms`);
      setStatus('connecting'); // surface "reconnecting" UI state
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    socket.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
    } // end attachSocketHandlers
  }, [sessionId, requestWsTicket, setStatus, setWs, addMessage, clearTranscript, addCoachingTip, setInterimTranscript, setInterimCustomerText, setAudioModes, playNextChunk, speakCustomerChunk, stopAudioPlayback, activateMicGuard, scheduleMicGuardRelease, pcmPlaybackPending, armPlaybackHandoverFallback, startRingback, stopRingback]);

  const disconnect = useCallback(() => {
    // User-initiated close: suppress reconnect and cancel any pending retry.
    intentionalCloseRef.current = true;
    cancelPendingReconnect();
    if (ws) {
      try { ws.send(JSON.stringify({ type: 'end_call' })); } catch {}
      ws.close(1000, 'client disconnect');
      liveSocketRef.current = null;
      setWs(null);
    }
    stopRingback();
    stopAudioPlayback();
    resetAgentAudioMetrics(agentAudioMetricsRef.current);
    firstMicFrameLoggedRef.current = false;
    customerTokenBufferRef.current = '';
    spokeStreamingCustomerRef.current = false;
    cancelAllSpeech();
  }, [ws, setWs, cancelPendingReconnect, stopAudioPlayback, stopRingback]);

  // Clean up pending reconnect on unmount.
  useEffect(() => {
    return () => {
      cancelPendingReconnect();
      stopAudioPlayback();
      cancelAllSpeech();
    };
  }, [cancelPendingReconnect, stopAudioPlayback]);

  const sendText = useCallback(
    (text: string) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text_input', text }));
      }
    },
    [ws]
  );

  const updateText = useCallback(
    (text: string) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text_input_update', text }));
      }
    },
    [ws]
  );

  const sendAudio = useCallback(
    (audioData: ArrayBuffer) => {
      if (ws?.readyState === WebSocket.OPEN) {
        if (!firstMicFrameLoggedRef.current) {
          firstMicFrameLoggedRef.current = true;
          console.log(`[Latency] first mic frame sent (${audioData.byteLength} bytes)`);
        }
        collectAgentAudioMetrics(agentAudioMetricsRef.current, audioData);
        ws.send(audioData);
      }
    },
    [ws]
  );

  const onSttFinal = useCallback((cb: (text: string) => void) => {
    sttFinalCallbackRef.current = cb;
  }, []);

  const onSttInterim = useCallback((cb: (text: string) => void) => {
    sttInterimCallbackRef.current = cb;
  }, []);

  const onAgentTurnReceived = useCallback((cb: (text: string) => void) => {
    agentTurnReceivedCallbackRef.current = cb;
  }, []);

  const onCustomerResponseStarted = useCallback((cb: () => void) => {
    customerResponseStartedCallbackRef.current = cb;
  }, []);

  const onCustomerResponseComplete = useCallback((cb: () => void) => {
    customerResponseCompleteCallbackRef.current = cb;
  }, []);

  const setPersonaGender = useCallback((g: 'male' | 'female' | 'unknown') => {
    personaGenderRef.current = g;
  }, []);

  return {
    connect,
    disconnect,
    sendText,
    updateText,
    sendAudio,
    onSttFinal,
    onSttInterim,
    onAgentTurnReceived,
    onCustomerResponseStarted,
    onCustomerResponseComplete,
    setPersonaGender,
  };
}
