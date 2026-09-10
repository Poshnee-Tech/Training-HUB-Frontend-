'use client';

import { Suspense, useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useCallStore } from '@/store/call.store';
import { useWebSocket, unlockAudioContext } from '@/hooks/useWebSocket';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useBrowserSTT } from '@/hooks/useBrowserSTT';
import { sessions, calls } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

/* =========================================================================
 * VICIDIAL-styled agent call screen.
 * Functionality (WebSocket / STT / transcript / coaching / end-call) is
 * unchanged from the prior version — only the visual shell is a replica of
 * the VICIdial 2.0.5 agent web-client so trainees learn the real UI.
 * ========================================================================= */

// ── Vicidial palette ────────────────────────────────────────────
const VD = {
  canvas: '#C3C3C3',
  panel: '#D4D0C8',
  panelLight: '#E8E6E0',
  border: '#808080',
  borderLight: '#B0B0B0',
  black: '#000000',
  text: '#000000',
  link: '#0000FF',
  linkVisited: '#551A8B',
  btnGrey: '#D4D0C8',
  btnPink: '#F7CAD7',
  btnPinkHover: '#F0B0C3',
  btnGreen: '#80E080',
  btnGreenHover: '#60D060',
  logoBlue: '#1F4E8C',
  inputBg: '#FFFFFF',
  statusRed: '#B00000',
} as const;

const FONT = 'Arial, Helvetica, sans-serif';

const EMPTY_CUSTOMER = {
  title: '', first: '', mi: '', last: '',
  address1: '', address2: '', address3: '',
  city: '', state: '', postCode: '',
  province: '', vendorId: '', gender: 'U',
  phone: '', dialCode: '', altPhone: '',
  show: '', email: '',
  comments: '',
};

export default function CallPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, background: VD.canvas, minHeight: '100vh', fontFamily: FONT }}>Loading...</div>}>
      <CallPageInner />
    </Suspense>
  );
}

function CallPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');
  const callIdParam = searchParams.get('callId');

  const { token, user, loadFromStorage, logout } = useAuthStore();
  const {
    sessionId,
    status,
    duration,
    transcript,
    interimTranscript,
    interimCustomerText,
    coachingTips,
    isRecording,
    isMuted,
    sttMode,
    endReason,
    endOutcome,
    customerTurnActive,
    setSession,
    setStatus,
    setMuted,
    incrementDuration,
    reset,
  } = useCallStore();

  const {
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
  } = useWebSocket();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechBufferRef = useRef('');
  const bufferVersionRef = useRef(0);
  const lastSpeechChangeAtRef = useRef(0);
  const interimActiveRef = useRef(false);
  const responseStartedRef = useRef(false);
  const sentTurnTextRef = useRef('');
  const sendTextRef = useRef(sendText);
  const updateTextRef = useRef(updateText);
  const [textInput, setTextInput] = useState('');
  // Gates the call connection behind an explicit user gesture (Start Call):
  // (1) unlocks the playback AudioContext so the customer greeting is audible
  //     immediately — browsers suspend audio until a user interaction, which
  //     is what made the greeting silently drop and feel like a long wait; and
  // (2) defers opening the Deepgram session until the trainee is actually
  //     ready, so no metered connection runs while they read the brief.
  const [hasStarted, setHasStarted] = useState(false);
  const coachingEndRef = useRef<HTMLDivElement>(null);

  // Dual-agent call state
  const [callChecklist, setCallChecklist] = useState<Record<string, boolean> | null>(null);
  const [checklistTemplate, setChecklistTemplate] = useState<Array<{ key: string; label: string; description: string }>>([]);
  const [agentRole, setAgentRole] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Vicidial-specific UI state
  const [sessionData, setSessionData] = useState<any>(null);
  const [clock, setClock] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);

  // Send mic audio to backend for Deepgram STT
  const sendAudioRef = useRef(sendAudio);
  sendAudioRef.current = sendAudio;
  const handleAudioData = useCallback((data: ArrayBuffer) => { sendAudioRef.current(data); }, []);
  const { start: startRecording, stop: stopRecording } = useAudioRecorder(handleAudioData);
  sendTextRef.current = sendText;
  updateTextRef.current = updateText;

  const clearEndpointTimer = useCallback(() => {
    if (endpointTimerRef.current) {
      clearTimeout(endpointTimerRef.current);
      endpointTimerRef.current = null;
    }
  }, []);

  const resetSpeechTurn = useCallback(() => {
    clearEndpointTimer();
    speechBufferRef.current = '';
    sentTurnTextRef.current = '';
    interimActiveRef.current = false;
    responseStartedRef.current = false;
    bufferVersionRef.current += 1;
    setTextInput('');
  }, [clearEndpointTimer]);

  const flushAgentSpeech = useCallback(() => {
    const text = speechBufferRef.current.trim();
    if (!text) return;

    clearEndpointTimer();
    speechBufferRef.current = '';
    sentTurnTextRef.current = text;
    responseStartedRef.current = false;
    bufferVersionRef.current += 1;
    setTextInput('');
    sendTextRef.current(text);
  }, [clearEndpointTimer]);

  const getEndpointDelay = useCallback((text: string) => {
    const normalized = text.trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const lower = normalized.toLowerCase();

    if (/^(yes|no|yeah|nope|sure|correct|right|okay|ok|thanks|thank you)$/i.test(normalized)) {
      return 550;
    }

    const lastWord = words[wordCount - 1]?.toLowerCase().replace(/[^a-z']/g, '') || '';
    const looksIncomplete =
      /\b(and|or|but|because|so|if|when|while|that|then|to|for|with|about|like|from|as|than)$/i.test(lastWord) ||
      /\b(i'?m|i am|i was|i have|i need|i want|i already|because|the thing is|what i mean|let me|hold on)$/i.test(lower);

    if (looksIncomplete) return 2600;

    if (/[.!?]$/.test(normalized) && wordCount >= 3) return 900;

    if (
      wordCount >= 4 &&
      /\b(that'?s all|go ahead|please continue|does that make sense|can you help me|what do you think|is that right)$/i.test(lower)
    ) {
      return 900;
    }

    if (wordCount <= 2) return 1600;
    if (wordCount >= 18) return 1500;
    if (wordCount >= 8) return 1700;
    return 1900;
  }, []);

  const scheduleEndpointCheck = useCallback(() => {
    clearEndpointTimer();
    const text = speechBufferRef.current.trim();
    if (!text) return;

    const version = bufferVersionRef.current;
    const delayMs = getEndpointDelay(text);

    const runCheck = () => {
      endpointTimerRef.current = null;

      if (version !== bufferVersionRef.current) return;
      if (responseStartedRef.current) return;
      if (interimActiveRef.current) {
        endpointTimerRef.current = setTimeout(runCheck, 350);
        return;
      }

      const stableForMs = Date.now() - lastSpeechChangeAtRef.current;
      if (stableForMs < delayMs) {
        endpointTimerRef.current = setTimeout(runCheck, delayMs - stableForMs);
        return;
      }

      flushAgentSpeech();
    };

    endpointTimerRef.current = setTimeout(runCheck, delayMs);
  }, [clearEndpointTimer, flushAgentSpeech, getEndpointDelay]);

  const queueAgentSpeech = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;

    if (sentTurnTextRef.current && !responseStartedRef.current) {
      const merged = `${sentTurnTextRef.current} ${clean}`.replace(/\s+/g, ' ').trim();
      sentTurnTextRef.current = merged;
      lastSpeechChangeAtRef.current = Date.now();
      setTextInput('');
      updateTextRef.current(merged);
      return;
    }

    interimActiveRef.current = false;
    lastSpeechChangeAtRef.current = Date.now();
    bufferVersionRef.current += 1;
    speechBufferRef.current = speechBufferRef.current
      ? `${speechBufferRef.current} ${clean}`
      : clean;
    setTextInput(speechBufferRef.current);

    scheduleEndpointCheck();
  }, [scheduleEndpointCheck]);

  const handleInterimSpeech = useCallback(() => {
    interimActiveRef.current = true;
    lastSpeechChangeAtRef.current = Date.now();
    clearEndpointTimer();
  }, [clearEndpointTimer]);

  const { start: startBrowserStt, stop: stopBrowserStt } = useBrowserSTT(queueAgentSpeech, handleInterimSpeech);

  useEffect(() => {
    onSttFinal(queueAgentSpeech);
    onSttInterim(handleInterimSpeech);
    onAgentTurnReceived((text) => {
      sentTurnTextRef.current = text;
    });
    onCustomerResponseStarted(() => {
      responseStartedRef.current = true;
      clearEndpointTimer();
    });
    onCustomerResponseComplete(() => {
      responseStartedRef.current = false;
      sentTurnTextRef.current = '';
      if (speechBufferRef.current.trim()) {
        scheduleEndpointCheck();
      }
    });
  }, [
    onSttFinal,
    onSttInterim,
    onAgentTurnReceived,
    onCustomerResponseStarted,
    onCustomerResponseComplete,
    queueAgentSpeech,
    handleInterimSpeech,
    clearEndpointTimer,
    scheduleEndpointCheck,
  ]);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    return () => {
      if (endpointTimerRef.current) clearTimeout(endpointTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!sessionIdParam) return;
    if (sessionIdParam === sessionId) return;

    resetSpeechTurn();
    setMicError(null);
    setHasStarted(false);
    setSessionData(null);
    setCustomer(EMPTY_CUSTOMER);

    stopRecording();
    stopBrowserStt();
    disconnect();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    reset();
    setSession(sessionIdParam);
  }, [
    sessionIdParam,
    sessionId,
    resetSpeechTurn,
    stopRecording,
    stopBrowserStt,
    disconnect,
    reset,
    setSession,
  ]);

  useEffect(() => {
    // Only connect once the trainee has explicitly started the call (the Start
    // gesture). Reconnects after a drop are driven inside useWebSocket and are
    // unaffected by this gate.
    if (sessionId && token && status === 'idle' && hasStarted) connect();
  }, [sessionId, token, status, connect, hasStarted]);

  // Load checklist for dual-agent calls
  useEffect(() => {
    if (!callIdParam || !token) return;
    calls.getChecklist(token, callIdParam).then(res => {
      setCallChecklist(res.data.checklist);
      setChecklistTemplate(res.data.template);
      setAgentRole(res.data.role);
    }).catch(() => {});
  }, [callIdParam, token]);

  useEffect(() => {
    if (status === 'active' && !isRecording) {
      const startMic = sttMode === 'deepgram'
        ? startRecording()
        : Promise.resolve(startBrowserStt());

      startMic.catch((err: any) => {
        const msg = err?.name === 'NotFoundError'
          ? 'No microphone detected. Plug in / connect a mic, or use the text box below to type your responses.'
          : err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Click the lock icon in your browser address bar to enable it, or type responses below.'
          : `Microphone unavailable (${err?.name || 'error'}). You can still type responses in the Agent Input box below.`;
        setMicError(msg);
      });
    }
  }, [status, isRecording, sttMode, startRecording, startBrowserStt]);

  // ── THE CALL IS OVER: STOP LISTENING ──────────────────────────────────────
  // The recorder was started on `status === 'active'` and never stopped when
  // the customer ended the call, so the mic stayed hot and the trainee could
  // carry on talking to a dead line — audio going nowhere, with nothing on
  // screen to say so.
  useEffect(() => {
    if (status === 'completed' && isRecording) {
      stopRecording();
      stopBrowserStt();
    }
  }, [status, isRecording, stopRecording, stopBrowserStt]);

  useEffect(() => {
    if (status !== 'active') return;

    timerRef.current = setInterval(incrementDuration, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [status, incrementDuration]);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interimTranscript, interimCustomerText]);

  useEffect(() => {
    coachingEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [coachingTips]);

  // Fetch session (for scenario / persona / campaign info)
  useEffect(() => {
    // ── REFETCH WHEN THE SESSION CHANGES ──────────────────────────────────
    //
    // MEASURED DEFECT (2026-08-31): the guard was `|| sessionData`, i.e. "we
    // already have some session data, stop". `sessionId` is in the deps, so a
    // second call on the same route re-ran this effect — and returned
    // immediately, because the PREVIOUS call's data was still there.
    //
    // Live consequence: Patricia Nolan (ACA) was run straight after Raymond
    // Ellison (MEDICARE) and the header read "to campaign: MEDICARE" for the
    // whole call. The engine was correct throughout — scenario, session
    // context and roleplay state all recorded ACA, and the ACA DNQ rule fired
    // — but the trainee was shown the wrong campaign, the wrong customer name
    // pre-fill, and the previous persona's gender was handed to TTS.
    //
    // The condition is now "we have data FOR THIS SESSION", so a new call
    // always refetches.
    if (!token || !sessionId) return;
    if (sessionData?.id === sessionId) return;
    sessions.get(token, sessionId).then(res => {
      setSessionData(res.data);
      // Pre-fill name fields from persona so agent sees who they're calling
      const personaName: string = res.data?.scenario?.personaName || '';
      const [first, ...rest] = personaName.split(' ');
      setCustomer(c => ({
        ...c,
        first: first || '',
        last: rest.join(' ') || '',
        phone: generateFakePhone(res.data?.id || ''),
      }));
      // Tell the WebSocket layer which gender voice to use for TTS
      setPersonaGender(inferPersonaGender(res.data?.scenario));
    }).catch(console.error);
  }, [token, sessionId, sessionData, setPersonaGender]);

  // Live clock (Vicidial header timestamp)
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setClock(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * ── THE DISPOSITION THE FRONTER RECORDS ──────────────────────────────────
   *
   * A real fronter dispositions every call, so the trainee does too. It is a
   * TRAINING ANSWER: the engine's terminal record is authoritative and is not
   * affected by this; the server stores the pick beside it so the scorecard
   * can mark it right or wrong.
   *
   * ASKED EVEN WHEN THE CUSTOMER ALREADY ENDED THE CALL, and asked BEFORE the
   * engine's own answer is shown. Showing it instead of asking would teach
   * nothing — recognising that she just asked to be removed from the list IS
   * the skill being trained, and it is only tested if the trainee answers
   * first. The comparison is then theirs to see on the report.
   */
  const DISPOSITIONS: Array<{ value: string; label: string }> = [
    { value: 'NOT_INTERESTED', label: 'Not Interested' },
    { value: 'DNC', label: 'Do Not Call' },
    { value: 'DNQ', label: 'Does Not Qualify' },
    { value: 'CALLBACK', label: 'Callback Requested' },
    { value: 'WRONG_NUMBER', label: 'Wrong Number' },
    { value: 'CUSTOMER_HUNG_UP', label: 'Customer Hung Up' },
    { value: 'TRANSFERRED', label: 'Transferred' },
    { value: 'OTHER', label: 'Other' },
  ];
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [dispositionChoice, setDispositionChoice] = useState<string | null>(null);
  const [dispositionSubmitting, setDispositionSubmitting] = useState(false);

  const endSessionCommon = useCallback(async (fronterDisposition?: string) => {
    if (!token || !sessionId) {
      console.warn('[CallPage] endSession called with no token/sessionId', { token: !!token, sessionId });
      return;
    }
    setStatus('ending');
    resetSpeechTurn();
    stopRecording();
    stopBrowserStt();
    disconnect();
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      await sessions.end(token, sessionId, fronterDisposition);
      router.push(`/reports/${sessionId}`);
    } catch (err: any) {
      console.error('[CallPage] Failed to end session:', err);
      alert('Could not end the session cleanly: ' + (err?.message || 'unknown error') + '\nYou can still navigate away — the report will be generated from whatever was recorded.');
      setStatus('completed');
    }
  }, [token, sessionId, setStatus, resetSpeechTurn, stopRecording, stopBrowserStt, disconnect, router]);

  // END CALL — the trainee dispositions the call before it closes.
  const handleEndCall = useCallback(() => {
    setDispositionOpen(true);
  }, []);

  const submitDisposition = useCallback(async () => {
    if (!dispositionChoice || dispositionSubmitting) return;
    setDispositionSubmitting(true);
    setDispositionOpen(false);
    await endSessionCommon(dispositionChoice);
  }, [dispositionChoice, dispositionSubmitting, endSessionCommon]);

  // TRANSFER - CONF (green button) — for dual-agent calls, triggers the real transfer flow
  const handleTransferSuccess = useCallback(async () => {
    if (callIdParam && agentRole === 'FRONTER') {
      // Dual-agent flow — transfer to verifier
      if (!confirm('Transfer this call? The verifier will take over. Your part will be submitted for evaluation.')) return;
      setTransferring(true);
      try {
        await calls.transfer(token!, callIdParam);
        setStatus('completed');
        resetSpeechTurn();
        stopRecording();
        stopBrowserStt();
        disconnect();
        if (timerRef.current) clearInterval(timerRef.current);
        router.push(`/reports/${sessionId}`);
      } catch (err: any) {
        alert('Transfer failed: ' + (err?.message || 'Unknown error'));
        setTransferring(false);
      }
    } else if (callIdParam && agentRole === 'VERIFIER') {
      // Verifier completes the call
      if (!confirm('Close Sale: Mark this as a successful sale? All checklist fields must be verified.')) return;
      setTransferring(true);
      try {
        await calls.closeSale(token!, callIdParam);
        setStatus('completed');
        resetSpeechTurn();
        stopRecording();
        stopBrowserStt();
        disconnect();
        if (timerRef.current) clearInterval(timerRef.current);
        router.push(`/reports/${sessionId}`);
      } catch (err: any) {
        alert('Complete failed: ' + (err?.message || 'Unknown error'));
        setTransferring(false);
      }
    } else {
      // Legacy single-agent flow
      if (!confirm('TRANSFER — CONF: mark this call as a successful handoff and submit for evaluation?')) return;
      await endSessionCommon();
    }
  }, [callIdParam, agentRole, token, sessionId, endSessionCommon, setStatus, resetSpeechTurn, stopRecording, stopBrowserStt, disconnect, router]);

  /**
   * The text box is read-only while the customer is talking. `customerTurnActive`
   * spans her whole server-declared turn (response started → playback drained),
   * so typed text cannot land on the air as a barge-in mid-sentence, and it does
   * not flicker during buffer gaps the way `isSpeaking` does.
   */
  const inputLocked = status !== 'active' || customerTurnActive;
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputLocked) return;
    if (textInput.trim()) {
      clearEndpointTimer();
      speechBufferRef.current = '';
      sentTurnTextRef.current = textInput.trim();
      responseStartedRef.current = false;
      bufferVersionRef.current += 1;
      sendText(textInput.trim());
      setTextInput('');
    }
  };

  // Explicit start gesture — unlocks audio playback (browser autoplay policy
  // blocks it until a user interaction) and flips the gate so the connect
  // effect fires. Pipeline/model untouched; this only changes WHEN we connect.
  const handleBeginCall = useCallback(() => {
    unlockAudioContext();
    setHasStarted(true);
  }, []);

  // Derived display strings
  const campaign = (sessionData?.scenario?.campaign || '—').toString().replace('_', ' ');
  const scenarioName = sessionData?.scenario?.name || '';
  const ext = useMemo(() => 'TRAIN-' + (user?.id || '').slice(0, 4).toUpperCase(), [user?.id]);
  const userLabel = user ? `${user.firstName} ${user.lastName}` : '—';
  const sessionShort = sessionId ? sessionId.slice(0, 8).toUpperCase() : '—';

  const callStatusLabel =
    status === 'active' ? 'LIVE CALL' :
    status === 'connecting' ? 'CONNECTING' :
    status === 'ending' ? 'HANGING UP' :
    'NO LIVE CALL';

  if (!sessionId) {
    return (
      <div style={{ minHeight: '100vh', background: VD.canvas, fontFamily: FONT, fontSize: 13, padding: 24 }}>
        <div style={{ background: VD.panel, border: `2px outset ${VD.borderLight}`, padding: 16, maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>No Active Session</h2>
          <p style={{ marginTop: 8 }}>Go to Assignments to start a practice call.</p>
          <button onClick={() => router.push('/scenarios')} style={vdBtn('grey')}>
            MY ASSIGNMENTS
          </button>
        </div>
      </div>
    );
  }

  // Pre-call gate — show a Start screen until the trainee clicks Start. That
  // single gesture unlocks audio playback AND triggers the (now lazy) connect,
  // so the customer greeting is heard immediately instead of being dropped by
  // the browser autoplay policy. No pipeline/model behaviour changes here.
  if (!hasStarted) {
    const sd = sessionData?.scenario;
    const personaName = sd?.personaName || '';
    const camp = (sd?.campaign || '').toString().replace('_', ' ');
    const diff = (sd?.difficulty || '').toString();
    return (
      <div style={{ minHeight: '100vh', background: VD.canvas, fontFamily: FONT, fontSize: 13, color: VD.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: VD.panel, border: `2px outset ${VD.borderLight}`, padding: 28, maxWidth: 440, width: '100%', textAlign: 'center' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: VD.logoBlue, letterSpacing: -1 }}>
            VICI<span style={{ color: VD.statusRed }}>dial</span>
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555', marginTop: 6 }}>
            Poshnee Training Hub · Practice dialer
          </div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 18 }}>Ready to start your practice call</h2>
          <p style={{ margin: '0 0 6px', color: '#333' }}>
            You&apos;re about to place an outbound call{personaName ? <> to <b>{personaName}</b></> : null}{camp ? <> — <b>{camp}</b></> : null}{diff ? <> <span style={{ textTransform: 'capitalize' }}>({diff.toLowerCase()})</span></> : null}.
          </p>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#555' }}>
            Put your headset on. The customer picks up the moment you start — no waiting.
          </p>
          {/* VICIdial is not a second brand — it is the dialer these agents will
              sit in front of at work, rebuilt here so the practice screen and
              the real one look the same. Saying so once removes the "what am I
              even looking at" moment on a trainee's first call. */}
          <p style={{ margin: '0 0 18px', fontSize: 11, color: '#666', lineHeight: 1.5 }}>
            The next screen is a working copy of <b>VICIdial</b> — the dialer you&apos;ll use on the
            floor. Only the buttons along the middle bar do anything here.
          </p>
          <button
            onClick={handleBeginCall}
            style={{ ...vdBtn('green', { padding: '10px 30px', fontSize: 15 }) }}
            title="Connect and start the call"
          >
            ▶ START CALL
          </button>
          <div style={{ marginTop: 14 }}>
            <button onClick={() => router.push('/scenarios')} style={{ ...vdBtn('grey', { padding: '4px 14px', fontSize: 11 }) }}>
              ← BACK TO ASSIGNMENTS
            </button>
          </div>
          {!sessionData && <div style={{ marginTop: 12, fontSize: 11, color: '#777' }}>Loading scenario…</div>}
        </div>
      </div>
    );
  }

  // Static visual buttons — no click behaviour, look like the real VICIdial UI
  const dummyStyle: React.CSSProperties = { cursor: 'default', userSelect: 'none' };

  return (
    <div style={{ height: '100vh', background: VD.canvas, fontFamily: FONT, fontSize: 13, color: VD.text, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`@keyframes recPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
      {/* ── DISPOSITION PICKER ────────────────────────────────────────────────
        * The fronter records how the call ended, as they would on a real desk.
        * It is graded, never trusted: the engine's terminal record is
        * authoritative and unaffected by what is chosen here. */}
      {dispositionOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT,
        }}>
          <div style={{ background: VD.panel, border: `2px outset ${VD.borderLight}`, padding: '20px 26px', width: 420 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Disposition this call</div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 14 }}>
              How did the call end? Your answer is scored against what actually happened.
            </div>
            <div style={{ display: 'grid', gap: 4, marginBottom: 16 }}>
              {DISPOSITIONS.map((d) => (
                <label
                  key={d.value}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    border: `1px solid ${dispositionChoice === d.value ? VD.statusRed : VD.border}`,
                    background: dispositionChoice === d.value ? '#FFF4F4' : '#FFF',
                    cursor: 'pointer', fontSize: 13,
                  }}
                >
                  <input
                    type="radio"
                    name="disposition"
                    value={d.value}
                    checked={dispositionChoice === d.value}
                    onChange={() => setDispositionChoice(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDispositionOpen(false)}
                style={{ ...vdBtn('grey', { padding: '6px 16px', fontSize: 12 }) }}
              >
                Back to call
              </button>
              <button
                onClick={submitDisposition}
                disabled={!dispositionChoice || dispositionSubmitting}
                style={{
                  ...vdBtn('pink', { padding: '6px 20px', fontSize: 13 }),
                  opacity: dispositionChoice && !dispositionSubmitting ? 1 : 0.5,
                  cursor: dispositionChoice && !dispositionSubmitting ? 'pointer' : 'not-allowed',
                }}
              >
                {dispositionSubmitting ? 'Ending…' : 'End call'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── END-OF-CALL BANNER ────────────────────────────────────────────────
        * The customer ending the call used to be invisible: the audio simply
        * stopped and `status` went to 'completed' with nothing on screen. The
        * server now names the ending, so it is shown here in plain language,
        * for EVERY customer-side ending and for a completed transfer. */}
      {status === 'completed' && endReason && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT,
          }}
        >
          <div style={{
            background: VD.panel, border: `2px outset ${VD.borderLight}`,
            padding: '24px 34px', textAlign: 'center', maxWidth: 460,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#777', marginBottom: 8 }}>
              CALL ENDED
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, lineHeight: 1.35 }}>
              {endReason}
            </div>
            {endOutcome && (
              <div style={{
                display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                border: `1px solid ${VD.border}`, borderRadius: 3, padding: '2px 8px',
                background: '#FFF', color: '#333', marginBottom: 14,
              }}>
                {endOutcome.replace(/_/g, ' ')}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>
              Your microphone is off. Nothing further will reach the customer.
            </div>
            <button
              onClick={() => setDispositionOpen(true)}
              style={{ ...vdBtn('pink', { padding: '6px 18px', fontSize: 13 }) }}
            >
              Disposition this call
            </button>
          </div>
        </div>
      )}

      {/* Connecting overlay — covers the brief Deepgram handshake after Start
       * (and any mid-call reconnect) so the trainee never stares at a dead UI. */}
      {hasStarted && status !== 'active' && status !== 'ending' && status !== 'completed' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
          <div style={{ background: VD.panel, border: `2px outset ${VD.borderLight}`, padding: '20px 30px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Connecting to customer…</div>
            <div style={{ fontSize: 11, color: '#555' }}>Dialing — this only takes a moment.</div>
          </div>
        </div>
      )}
      {/* ════════════════════════════════════════════════════════════
       * TOP SECTION — VICIdial replica (dummy visual, 60–70% of screen)
       * ════════════════════════════════════════════════════════════ */}

      {/* ── Top info strip ── */}
      <div style={{ padding: '4px 10px', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          Logged in as User: <b>{userLabel}</b> on Phone: <b>{ext}</b> to campaign: <b>{campaign}</b>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <span style={{ color: VD.link, textDecoration: 'underline', ...dummyStyle }}>GROUPS</span>
          <a href="#" style={{ color: VD.link, textDecoration: 'underline' }} onClick={(e) => { e.preventDefault(); logout(); router.push('/login'); }}>LOGOUT</a>
        </div>
      </div>

      {/* ── Logo / SCRIPT tab / session info (no real tabs; single visual tab) ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '0 10px', height: 34, borderBottom: `1px solid ${VD.border}` }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: VD.logoBlue, letterSpacing: -1 }}>
          VICI<span style={{ color: VD.statusRed }}>dial</span>
        </div>
        <div style={{ marginLeft: 14 }}>
          <span style={{
            padding: '4px 18px',
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 700,
            background: VD.panel,
            border: `1px solid ${VD.border}`,
            borderBottom: `1px solid ${VD.panel}`,
            color: VD.text,
            display: 'inline-block',
          }}>SCRIPT</span>
        </div>
        <div style={{ marginLeft: 20, fontSize: 12 }}>{clock}</div>
        <div style={{ marginLeft: 20, fontSize: 12 }}>session ID: <b>{sessionShort}</b></div>
        <div style={{ marginLeft: 20, fontSize: 12 }}>Calls in Queue: <b>0</b></div>
        {/*
          ── THE RECORDING INDICATOR (owner ruling 2026-09-01) ──────────────
          Persistent and visible for the whole call, not a one-off notice at
          the start. Both sides of the call are recorded and the trainee's
          voice is a real person's; consent is taken at enrolment, and this is
          the reminder that it is happening RIGHT NOW.

          Deliberately beside the call status and in the same red: it is not a
          dismissible toast, there is no close button, and it disappears only
          when the call is no longer live.
        */}
        {status === 'active' && (
          <div
            aria-live="polite"
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 700, color: VD.statusRed,
              border: `1px solid ${VD.statusRed}`, padding: '2px 8px', borderRadius: 2,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8, height: 8, borderRadius: '50%', background: VD.statusRed,
                display: 'inline-block', animation: 'recPulse 1.6s ease-in-out infinite',
              }}
            />
            RECORDING
          </div>
        )}
        <div style={{ marginLeft: status === 'active' ? 12 : 'auto', fontSize: 12, fontWeight: 700, color: status === 'active' ? VD.statusRed : '#333' }}>
          {callStatusLabel}
        </div>
      </div>

      {/* ── Main body: left action column (ALL DUMMY) + right customer form ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, padding: 8, alignItems: 'start' }}>
        {/* ── LEFT COLUMN — pure visual VICIdial replica ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>STATUS:</div>

          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ ...vdBtn('green', { flex: 1 }), ...dummyStyle }}>PAUSE</div>
            <div style={{ ...vdBtn('green', { flex: 1 }), ...dummyStyle }}>RESUME</div>
          </div>

          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <input type="checkbox" disabled /> ALT PHONE DIAL
          </label>

          <div style={{ fontSize: 11, marginTop: 4 }}>RECORDING FILE:</div>
          <div style={{ fontSize: 11 }}>RECORD ID:</div>
          <div style={{ ...vdBtn('pink'), ...dummyStyle }}>START RECORDING</div>

          <div style={{ ...vdBtn('grey', { marginTop: 8 }), ...dummyStyle }}>WEB FORM</div>
          <div style={{ ...vdBtn('grey'), ...dummyStyle }}>PARK CALL</div>
          <div style={{ ...vdBtn('grey'), ...dummyStyle }}>TRANSFER - CONF</div>

          <div style={{ ...vdBtn('pink', { marginTop: 8 }), ...dummyStyle }}>HANGUP CUSTOMER</div>

          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <div style={{ ...vdBtn('pink'), ...dummyStyle }}>SEND DTMF</div>
            <input type="text" maxLength={4} style={vdInput({ width: 40 })} disabled />
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 16 }}>🔊</span>
            <div style={{ ...vdBtn('grey', { flex: 1 }), ...dummyStyle }}>MUTE</div>
          </div>
        </div>

        {/* ── RIGHT PANE — customer info form (pure VICIdial form) ── */}
        <div style={{ background: VD.panel, border: `2px inset ${VD.borderLight}` }}>
          <CustomerForm customer={customer} setCustomer={setCustomer} duration={duration} />
        </div>
      </div>

      {/* ── Compact VICIdial footer: links + version + HOT KEYS + alert, all in one row ── */}
      <div style={{
        padding: '4px 10px',
        borderTop: `1px solid ${VD.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontSize: 11,
        flexWrap: 'wrap',
      }}>
        <span style={{ color: VD.link, textDecoration: 'underline', ...dummyStyle }}>1 ACTIVE CALLBACKS</span>
        <span style={{ color: VD.link, textDecoration: 'underline', ...dummyStyle }}>MANUAL DIAL</span>
        <span style={{ color: VD.link, textDecoration: 'underline', ...dummyStyle }}>FAST DIAL</span>
        <span style={{ color: VD.link, textDecoration: 'underline', ...dummyStyle }}>ENTER A PAUSE CODE</span>
        <span style={{ marginLeft: 10 }}>VICIDIAL <b>TRAINER-1.0</b></span>
        <span>Scenario: <b>{scenarioName || '—'}</b></span>
        <span>Duration: <b>{formatDuration(duration)}</b></span>
        <span style={{ color: VD.link, textDecoration: 'underline', ...dummyStyle }}>Show conference info</span>
        <span style={{ color: VD.statusRed }}>Alert is OFF</span>
        <span style={{ marginLeft: 'auto', ...vdBtn('grey', { padding: '2px 8px', fontSize: 10 }), ...dummyStyle }}>HOT KEYS INACTIVE</span>
      </div>

      {/* ════════════════════════════════════════════════════════════
       * CENTRAL ACTION BAR — compact, working buttons
       * ════════════════════════════════════════════════════════════ */}
      <div style={{
        borderTop: `2px solid ${VD.border}`,
        background: VD.panel,
        padding: '6px 10px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
      }}>
        <button
          onClick={handleEndCall}
          disabled={status === 'ending'}
          style={{ ...vdBtn('pink', { padding: '5px 22px', fontSize: 12 }) }}
          title="End the call and submit for evaluation"
        >
          {status === 'ending' ? '■ ENDING…' : '■ END CALL'}
        </button>
        <button
          onClick={handleTransferSuccess}
          disabled={status === 'ending'}
          style={{ ...vdBtn('green', { padding: '5px 22px', fontSize: 12 }) }}
          title="Successful handoff — ends the call + submits for evaluation"
        >
          {agentRole === 'FRONTER' ? '➜ TRANSFER TO VERIFIER' :
           agentRole === 'VERIFIER' ? '✓ CLOSE SALE' :
           '➜ TRANSFER CALL (SUCCESS)'}
        </button>
        {agentRole === 'VERIFIER' && (
          <button
            onClick={async () => {
              if (!confirm('Sale Lost: The customer declined. End the call and submit for evaluation?')) return;
              setTransferring(true);
              try {
                await calls.saleLost(token!, callIdParam!);
                setStatus('completed');
                resetSpeechTurn(); stopRecording(); stopBrowserStt(); disconnect();
                if (timerRef.current) clearInterval(timerRef.current);
                router.push(`/reports/${sessionId}`);
              } catch (err: any) { alert('Failed: ' + (err?.message || 'Unknown error')); setTransferring(false); }
            }}
            disabled={status === 'ending' || transferring}
            style={{ ...vdBtn('pink', { padding: '5px 22px', fontSize: 12 }), background: '#F87171' }}
            title="Customer declined — mark as sale lost"
          >
            ✗ SALE LOST
          </button>
        )}
        <button
          onClick={() => setMuted(!isMuted)}
          disabled={status !== 'active'}
          style={{
            ...vdBtn('grey', { padding: '5px 22px', fontSize: 12 }),
            background: isMuted ? '#FFD24A' : VD.btnGrey,
          }}
          title={isMuted ? 'Paused: mic muted, Deepgram credits not spent. Click to resume.' : 'Pause: mute mic to stop sending audio to Deepgram.'}
        >
          {isMuted ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
        {isMuted && status === 'active' && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8A5A13' }}>
            ⏸ PAUSED (no Deepgram spend)
          </span>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
       * LOWER TRAINING PANEL — classic chat-bubble design
       * ════════════════════════════════════════════════════════════ */}
      <div style={{ padding: 10, background: '#F3F5F8', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {micError && (
          <div style={{
            background: '#FFF3B0',
            border: `1px solid #C9A41E`,
            borderLeft: `4px solid ${VD.statusRed}`,
            padding: '6px 10px',
            fontSize: 12,
            color: '#5A3A00',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            borderRadius: 6,
          }}>
            <span><b>Mic issue:</b> {micError}</span>
            <button onClick={() => setMicError(null)} style={{ ...vdBtn('grey', { padding: '1px 6px', fontSize: 10 }) }}>DISMISS</button>
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: callChecklist ? '1fr 240px 280px' : '1fr 280px',
          gap: 10,
          flex: 1,
          minHeight: 0,
        }}>
          {/* ── LEFT: chat ── */}
          <div style={{
            background: '#FFFFFF',
            border: `1px solid ${VD.border}`,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}>
            {/* Scrolling transcript as chat bubbles */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#FAFAFA' }}>
              {transcript.length === 0 && (
                <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>
                  No conversation yet. Start speaking into your microphone, or type below.
                </div>
              )}
              {transcript.map((msg: any) => {
                const isAgent = msg.role === 'agent';
                return (
                  <div key={msg.id} style={{ display: 'flex', justifyContent: isAgent ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                    <div style={{
                      maxWidth: '75%',
                      padding: '8px 12px',
                      borderRadius: 14,
                      borderBottomRightRadius: isAgent ? 4 : 14,
                      borderBottomLeftRadius: isAgent ? 14 : 4,
                      background: isAgent ? VD.logoBlue : '#FFFFFF',
                      color: isAgent ? '#FFFFFF' : '#1A2028',
                      border: isAgent ? 'none' : `1px solid ${VD.border}`,
                      boxShadow: isAgent ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}>
                      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2, fontWeight: 600 }}>
                        {isAgent ? 'You' : 'Customer'}
                      </div>
                      {msg.content}
                    </div>
                  </div>
                );
              })}
              {interimCustomerText && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8, opacity: 0.75 }}>
                  <div style={{
                    maxWidth: '75%',
                    padding: '8px 12px',
                    borderRadius: 14,
                    borderBottomLeftRadius: 4,
                    background: '#FFFFFF',
                    color: '#1A2028',
                    border: `1px solid ${VD.border}`,
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}>
                    <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2, fontWeight: 600 }}>Customer (speaking…)</div>
                    {interimCustomerText}
                  </div>
                </div>
              )}
              {interimTranscript && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, opacity: 0.55 }}>
                  <div style={{
                    maxWidth: '75%',
                    padding: '8px 12px',
                    borderRadius: 14,
                    borderBottomRightRadius: 4,
                    background: VD.logoBlue,
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontStyle: 'italic',
                  }}>
                    <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 2, fontWeight: 600 }}>You (speaking…)</div>
                    {interimTranscript}
                  </div>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Input row at bottom */}
            <form onSubmit={handleTextSubmit} style={{
              display: 'flex',
              gap: 8,
              padding: 10,
              borderTop: `1px solid ${VD.border}`,
              background: '#FFFFFF',
            }}>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={
                  status === 'completed'
                    ? 'This call has ended.'
                    : status !== 'active'
                      ? 'Waiting for call to connect…'
                      : customerTurnActive
                        ? 'The customer is speaking — wait for your turn…'
                        : 'Type a message (or speak into your microphone)…'
                }
                readOnly={customerTurnActive}
                disabled={status !== 'active'}
                aria-disabled={inputLocked}
                style={{
                  flex: 1,
                  border: `1px solid ${VD.border}`,
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: FONT,
                  outline: 'none',
                  background: customerTurnActive ? '#F3F4F6' : '#FFFFFF',
                  color: customerTurnActive ? '#6B7280' : undefined,
                  cursor: customerTurnActive ? 'not-allowed' : undefined,
                }}
              />
              <button
                type="submit"
                disabled={inputLocked || !textInput.trim()}
                style={{
                  padding: '8px 18px',
                  background: VD.logoBlue,
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: inputLocked || !textInput.trim() ? 'not-allowed' : 'pointer',
                  opacity: inputLocked || !textInput.trim() ? 0.45 : 1,
                  fontFamily: FONT,
                }}
              >
                Send
              </button>
            </form>
          </div>

          {/* ── MIDDLE: verification checklist (dual-agent only) ── */}
          {callChecklist && (
            <div style={{
              background: '#FFFFFF',
              border: `1px solid ${VD.border}`,
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '8px 12px',
                borderBottom: `1px solid ${VD.border}`,
                fontSize: 12,
                fontWeight: 700,
                color: '#333',
                background: '#F8F8F8',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span>📋 Verification Checklist</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888', fontWeight: 500 }}>
                  {Object.values(callChecklist).filter(Boolean).length}/{Object.keys(callChecklist).length}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                {checklistTemplate.map((field) => {
                  const verified = callChecklist[field.key] || false;
                  return (
                    <label
                      key={field.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 6,
                        marginBottom: 2,
                        cursor: 'pointer',
                        background: verified ? '#F0FDF4' : 'transparent',
                        fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={verified}
                        onChange={async () => {
                          const newVal = !verified;
                          // Optimistic update
                          setCallChecklist(prev => prev ? { ...prev, [field.key]: newVal } : prev);
                          // Persist via API
                          if (callIdParam && token) {
                            calls.updateChecklist(token, callIdParam, { [field.key]: newVal }).catch(() => {
                              // Revert on failure
                              setCallChecklist(prev => prev ? { ...prev, [field.key]: !newVal } : prev);
                            });
                          }
                        }}
                        style={{ width: 16, height: 16, accentColor: '#22C55E' }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: verified ? '#166534' : '#333' }}>
                          {field.label}
                        </div>
                        <div style={{ fontSize: 10, color: '#888' }}>{field.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {/* Progress bar */}
              <div style={{ padding: '6px 10px', borderTop: `1px solid ${VD.border}`, background: '#F8F8F8' }}>
                <div style={{ height: 4, background: '#E5E7EB', borderRadius: 2 }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 2,
                    background: Object.values(callChecklist).every(Boolean) ? '#22C55E' : VD.logoBlue,
                    width: `${(Object.values(callChecklist).filter(Boolean).length / Math.max(Object.keys(callChecklist).length, 1)) * 100}%`,
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            </div>
          )}

          {/* ── RIGHT: coaching tips ── */}
          <div style={{
            background: '#FFFFFF',
            border: `1px solid ${VD.border}`,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${VD.border}`,
              fontSize: 12,
              fontWeight: 700,
              color: '#333',
              background: '#F8F8F8',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span>💡 Live Coach</span>
              {coachingTips.length > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888', fontWeight: 500 }}>{coachingTips.length}</span>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
              {coachingTips.length === 0 && (
                <p style={{ fontSize: 11, color: '#999', textAlign: 'center', padding: 10 }}>
                  Coaching tips will appear here as you talk…
                </p>
              )}
              {coachingTips.map((tip: any) => {
                const bg = tip.positive ? '#F0FDF4' : tip.priority === 'high' ? '#FEF2F2' : '#FFFBEB';
                const fg = tip.positive ? '#166534' : tip.priority === 'high' ? '#991B1B' : '#92400E';
                const leftBar = tip.positive ? '#22C55E' : tip.priority === 'high' ? '#EF4444' : '#F59E0B';
                return (
                  <div
                    key={tip.id}
                    className="animate-fadeIn"
                    style={{
                      background: bg,
                      color: fg,
                      borderLeft: `3px solid ${leftBar}`,
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 12,
                      lineHeight: 1.5,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, fontSize: 11 }}>
                        {tip.positive ? 'Good' : tip.priority === 'high' ? 'Important' : 'Tip'}
                      </span>
                      <span style={{ fontSize: 10, opacity: 0.6 }}>{tip.tipType}</span>
                    </div>
                    {tip.tip}
                  </div>
                );
              })}
              <div ref={coachingEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Vicidial-styled form panel ─────────────────────────────────────
 * NOTE: label/input pairs use a <Field> fragment so there's no
 * stray whitespace inside <tr> (which otherwise triggers a
 * React hydration warning).
 * ─────────────────────────────────────────────────────────────────── */
const labelCellStyle: React.CSSProperties = { textAlign: 'right', padding: '1px 4px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' };
const inputCellStyle: React.CSSProperties = { padding: '1px 4px' };

function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <>
      <td style={labelCellStyle}>{label}</td>
      <td style={inputCellStyle} colSpan={colSpan}>{children}</td>
    </>
  );
}

function CustomerForm({ customer, setCustomer, duration }: any) {
  const set = (k: string) => (e: any) => setCustomer((c: any) => ({ ...c, [k]: e.target.value }));
  return (
    <div style={{ padding: 8 }}>
      <table style={{ width: '100%', fontSize: 12, marginBottom: 4 }}>
        <tbody>
          <tr>
            <Field label="Customer Time:"><input type="text" style={vdInput({ width: 130 })} /></Field>
            <Field label="Channel:"><input type="text" style={vdInput({ width: 130 })} /></Field>
            <td style={{ ...labelCellStyle, fontWeight: 400 }}>seconds:</td>
            <td style={{ ...inputCellStyle, fontWeight: 700, fontFamily: 'Courier New, monospace' }}>{formatDuration(duration)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, margin: '2px 0 4px' }}>
        Customer Information:
      </div>

      <table style={{ width: '100%', fontSize: 12 }}>
        <tbody>
          <tr>
            <Field label="Title:"><input style={vdInput({ width: 36 })} value={customer.title} onChange={set('title')} /></Field>
            <Field label="First:"><input style={vdInput({ width: 140 })} value={customer.first} onChange={set('first')} /></Field>
            <Field label="MI:"><input style={vdInput({ width: 30 })} maxLength={2} value={customer.mi} onChange={set('mi')} /></Field>
            <Field label="Last:"><input style={vdInput({ width: 160 })} value={customer.last} onChange={set('last')} /></Field>
          </tr>
          <tr>
            <Field label="Address1:" colSpan={7}><input style={vdInput({ width: '95%' })} value={customer.address1} onChange={set('address1')} /></Field>
          </tr>
          <tr>
            <Field label="Address2:"><input style={vdInput({ width: 150 })} value={customer.address2} onChange={set('address2')} /></Field>
            <Field label="Address3:" colSpan={5}><input style={vdInput({ width: '90%' })} value={customer.address3} onChange={set('address3')} /></Field>
          </tr>
          <tr>
            <Field label="City:"><input style={vdInput({ width: 150 })} value={customer.city} onChange={set('city')} /></Field>
            <Field label="State:"><input style={vdInput({ width: 40 })} maxLength={3} value={customer.state} onChange={set('state')} /></Field>
            <Field label="PostCode:" colSpan={3}><input style={vdInput({ width: 120 })} value={customer.postCode} onChange={set('postCode')} /></Field>
          </tr>
          <tr>
            <Field label="Province:"><input style={vdInput({ width: 150 })} value={customer.province} onChange={set('province')} /></Field>
            <Field label="Vendor ID:"><input style={vdInput({ width: 120 })} value={customer.vendorId} onChange={set('vendorId')} /></Field>
            <Field label="Gender:" colSpan={3}>
              <select style={vdInput({ width: 120 })} value={customer.gender} onChange={set('gender')}>
                <option value="U">U - Undefined</option>
                <option value="M">M - Male</option>
                <option value="F">F - Female</option>
              </select>
            </Field>
          </tr>
          <tr>
            <Field label="Phone:"><input style={vdInput({ width: 150 })} value={customer.phone} onChange={set('phone')} /></Field>
            <Field label="DialCode:"><input style={vdInput({ width: 60 })} value={customer.dialCode} onChange={set('dialCode')} /></Field>
            <Field label="Alt. Phone:" colSpan={3}><input style={vdInput({ width: 150 })} value={customer.altPhone} onChange={set('altPhone')} /></Field>
          </tr>
          <tr>
            <Field label="Show:"><input style={vdInput({ width: 150 })} value={customer.show} onChange={set('show')} /></Field>
            <Field label="Email:" colSpan={5}><input style={vdInput({ width: '90%' })} value={customer.email} onChange={set('email')} /></Field>
          </tr>
          <tr>
            <Field label="Comments:" colSpan={7}>
              <textarea
                style={{ ...vdInput({ width: '95%' }), height: 44, fontFamily: FONT, resize: 'vertical' }}
                value={customer.comments}
                onChange={set('comments')}
              />
            </Field>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ── Style helpers (inline to avoid touching Tailwind theme) ───────── */
function vdBtn(variant: 'grey' | 'pink' | 'green', extra: React.CSSProperties = {}): React.CSSProperties {
  const bg =
    variant === 'pink' ? VD.btnPink :
    variant === 'green' ? VD.btnGreen :
    VD.btnGrey;
  return {
    background: bg,
    border: `2px outset ${VD.borderLight}`,
    padding: '3px 10px',
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.3,
    cursor: 'pointer',
    color: VD.text,
    textTransform: 'uppercase',
    ...extra,
  };
}

function vdInput(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    border: `1px solid ${VD.border}`,
    background: VD.inputBg,
    padding: '1px 4px',
    fontFamily: FONT,
    fontSize: 12,
    color: VD.text,
    boxSizing: 'border-box',
    ...extra,
  };
}

/**
 * Infer persona gender from scenario data.
 * Scenarios don't explicitly store gender, so we derive it from the first name +
 * personality/backstory pronouns. Good enough for voice selection.
 */
function inferPersonaGender(scenario: any): 'male' | 'female' | 'unknown' {
  if (!scenario) return 'unknown';

  // 0) Authoritative source: explicit personaGender field on the scenario
  const explicit = (scenario.personaGender || '').toString().trim().toLowerCase();
  if (/\b(female|f|woman|women|lady|girl|mrs\.?|ms\.?|miss|ma'?am)\b/.test(explicit)) return 'female';
  if (/\b(male|m|man|men|gentleman|guy|boy|mr\.?|sir)\b/.test(explicit)) return 'male';

  // 1) Pronoun scan over personality + backstory + mood text
  const bag = [
    scenario.personaPersonality,
    scenario.personaBackstory,
    scenario.personaMood,
    scenario.description,
  ].filter(Boolean).join(' ').toLowerCase();

  // Count gendered pronouns. Require a reasonable gap to commit.
  const maleHits = (bag.match(/\b(he|him|his|mr\.?|sir|husband|father|dad|son|grandfather)\b/g) || []).length;
  const femaleHits = (bag.match(/\b(she|her|hers|mrs\.?|ms\.?|miss|ma'am|wife|mother|mom|daughter|grandmother)\b/g) || []).length;
  if (maleHits - femaleHits >= 2) return 'male';
  if (femaleHits - maleHits >= 2) return 'female';

  // 2) Fallback: crude first-name heuristic (common US first-name endings)
  const first = (scenario.personaName || '').split(/\s+/)[0]?.toLowerCase() || '';
  if (!first) return 'unknown';

  const maleFirstNames = new Set([
    'james','john','robert','michael','william','david','richard','joseph','thomas','charles',
    'christopher','daniel','matthew','anthony','donald','mark','paul','steven','andrew','kenneth',
    'george','joshua','kevin','brian','edward','ronald','timothy','jason','jeffrey','ryan',
    'gary','nicholas','eric','jonathan','stephen','larry','justin','scott','brandon','frank',
    'benjamin','gregory','samuel','raymond','patrick','alexander','jack','dennis','jerry','tyler',
    'aaron','henry','douglas','peter','adam','nathan','zachary','walter','harold','kyle',
    'carl','arthur','gerald','roger','keith','jeremy','lawrence','sean','christian','ethan',
    'austin','joe','albert','bruce','russell','willie','jordan','dylan','alan','ralph',
    'gabriel','roy','juan','wayne','eugene','logan','randy','louis','chad','ernest',
    'marcus','amir','hugo','demarcus','sergio','bart','bernard','cal','rhett','warren',
    'ross','brandon','conrad','jasper','morrison','horace','reggie','corey','doug','bobby',
    'omar','travis','terry','hector','sergio','nicolas','elijah','raj','hassan','ismail',
    'mohammed','abdul','muhammad','tariq','harun','mahmoud','karim','samir','ali','khalil',
  ]);
  const femaleFirstNames = new Set([
    'mary','patricia','jennifer','linda','elizabeth','barbara','susan','jessica','sarah','karen',
    'nancy','lisa','betty','helen','sandra','donna','carol','ruth','sharon','michelle',
    'laura','sarah','kimberly','deborah','dorothy','amy','angela','ashley','brenda','emma',
    'olivia','cynthia','marie','janet','catherine','frances','christine','samantha','debra','rachel',
    'carolyn','virginia','maria','heather','diane','julie','joyce','victoria','kelly','christina',
    'joan','evelyn','lauren','judith','megan','cheryl','andrea','hannah','jacqueline','martha',
    'gloria','teresa','sara','janice','marilyn','julia','kathryn','doris','priya','alejandra',
    'nadia','isabella','simone','farrah','grace','chloe','ashley','mia','karen','penny',
    'rachel','rosa','crystal','brittany','melissa','tamika','linda','paige','veronica','francesca',
    'gloria','shante','lisa','evelyn','magdalena','delphine','yolanda','dorothy','jennifer','maria',
    'harriet','dolores','yolanda','vera','prudence','hazel','georgina','anjali','marcia','esperanza',
    'harriette','opal','agnes','gladys','pearl','imogene','esther','minerva','vesper','connie',
    'iris','leona','mildred','miriam','sylvia','beatrice','henrietta','genevieve','charlotte',
  ]);

  if (maleFirstNames.has(first)) return 'male';
  if (femaleFirstNames.has(first)) return 'female';
  return 'unknown';
}

function generateFakePhone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const area = 200 + (h % 800);
  const mid = 200 + ((h >>> 8) % 800);
  const end = String((h >>> 16) % 10000).padStart(4, '0');
  return `${area}-${mid}-${end}`;
}
