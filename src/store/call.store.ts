import { create } from 'zustand';

export interface TranscriptMessage {
  id: string;
  role: 'agent' | 'customer' | 'system';
  content: string;
  timestamp: Date;
  isFinal: boolean;
}

export interface CoachingTipMessage {
  id: string;
  tip: string;
  tipType: string;
  priority: string;
  positive: boolean;
  timestamp: Date;
}

interface CallState {
  // Session
  sessionId: string | null;
  status: 'idle' | 'connecting' | 'active' | 'ending' | 'completed';
  /**
   * WHY the call ended, in plain language, straight from the server.
   *
   * The trainee used to see a call stop with no explanation — a customer
   * hanging up looked exactly like the audio failing. Null while the call is
   * live; set once and never cleared until the next call resets the store.
   */
  endReason: string | null;
  /** The engine's outcome code, for the disposition badge. */
  endOutcome: string | null;
  startTime: Date | null;
  duration: number;

  // Transcript
  transcript: TranscriptMessage[];
  interimTranscript: string;
  // Customer reply building up sentence-by-sentence while server TTS plays
  // (custom_realtime pipeline only; finalized into a transcript message on
  // customer_text_complete).
  interimCustomerText: string;

  // Coaching
  coachingTips: CoachingTipMessage[];

  // WebSocket
  ws: WebSocket | null;

  // Audio
  isRecording: boolean;
  isMuted: boolean;
  isSpeaking: boolean; // true while browser TTS is playing (suppresses STT)
  // True for the whole server-declared customer turn (customer_response_started
  // → tts_complete + playback drain). Drives the mic echo gate in the worklet —
  // unlike isSpeaking it never drops out during mid-sentence buffer gaps.
  customerTurnActive: boolean;
  sttMode: 'browser' | 'deepgram';
  ttsEnabled: boolean;
  voicePipeline: 'legacy' | 'deepgram_agent' | 'custom_realtime' | 'custom_flux';

  // Actions
  setSession: (sessionId: string) => void;
  setStatus: (status: CallState['status']) => void;
  endCall: (reason: string, outcome: string | null) => void;
  setWs: (ws: WebSocket | null) => void;
  addMessage: (msg: TranscriptMessage) => void;
  clearTranscript: () => void;
  addCoachingTip: (tip: CoachingTipMessage) => void;
  setInterimTranscript: (text: string) => void;
  setInterimCustomerText: (text: string) => void;
  setRecording: (val: boolean) => void;
  setMuted: (val: boolean) => void;
  setSpeaking: (val: boolean) => void;
  setCustomerTurnActive: (val: boolean) => void;
  setAudioModes: (modes: { sttMode: 'browser' | 'deepgram'; ttsEnabled: boolean; voicePipeline?: 'legacy' | 'deepgram_agent' | 'custom_realtime' | 'custom_flux' }) => void;
  incrementDuration: () => void;
  reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  sessionId: null,
  status: 'idle',
  endReason: null,
  endOutcome: null,
  startTime: null,
  duration: 0,
  transcript: [],
  interimTranscript: '',
  interimCustomerText: '',
  coachingTips: [],
  ws: null,
  isRecording: false,
  isMuted: false,
  isSpeaking: false,
  customerTurnActive: false,
  sttMode: 'browser',
  ttsEnabled: false,
  voicePipeline: 'legacy',

  setSession: (sessionId) => set({ sessionId }),
  endCall: (reason, outcome) =>
    set(() => ({ status: 'completed' as const, endReason: reason, endOutcome: outcome })),
  setStatus: (status) =>
    set((s) => ({
      status,
      startTime: status === 'active' ? new Date() : s.startTime,
    })),
  setWs: (ws) => set({ ws }),
  addMessage: (msg) => set((s) => ({ transcript: [...s.transcript, msg] })),
  clearTranscript: () => set({ transcript: [] }),
  addCoachingTip: (tip) => set((s) => ({ coachingTips: [...s.coachingTips, tip] })),
  setInterimTranscript: (text) => set({ interimTranscript: text }),
  setInterimCustomerText: (text) => set({ interimCustomerText: text }),
  setRecording: (val) => set({ isRecording: val }),
  setMuted: (val) => set({ isMuted: val }),
  setSpeaking: (val) => set({ isSpeaking: val }),
  setCustomerTurnActive: (val) => set({ customerTurnActive: val }),
  setAudioModes: (modes) => set(modes),
  incrementDuration: () => set((s) => ({ duration: s.duration + 1 })),
  reset: () =>
    set({
      sessionId: null,
      status: 'idle',
      endReason: null,
      endOutcome: null,
      startTime: null,
      duration: 0,
      transcript: [],
      interimTranscript: '',
      interimCustomerText: '',
      coachingTips: [],
      ws: null,
      isRecording: false,
      isMuted: false,
      isSpeaking: false,
      customerTurnActive: false,
      sttMode: 'browser',
      ttsEnabled: false,
      voicePipeline: 'legacy',
    }),
}));
