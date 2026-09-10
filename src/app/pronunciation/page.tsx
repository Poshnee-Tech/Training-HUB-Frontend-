'use client';

/**
 * Pronunciation practice.
 *
 * An admin publishes phrases from the calls agents actually make; the agent
 * reads one aloud and Azure Speech scores the take down to individual sounds,
 * with reference audio to copy.
 *
 * Everything a learner needs to act on is server-side already — the marking
 * curve, the IPA-to-plain-English table, the per-word verdicts — so this page
 * renders what it is given rather than deciding anything about scoring.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { usePracticeRecorder } from '@/hooks/usePracticeRecorder';
import {
  pronunciation as api,
  type PhonemeGuide,
  type PracticeAttempt,
  type PracticeResult,
  type PracticeSentence,
  type PracticeWord,
  type PracticeAllowance,
} from '@/lib/api';

/**
 * What is left of today's practice, and of any longer cap that is set.
 *
 * Renders NOTHING when no limit applies. An agent with no cap should not be
 * shown an empty allowance strip — it would invite the question "how many do I
 * get?" where the answer is "as many as you like".
 *
 * Only caps that are actually set appear. `null` from the server means that
 * kind of limit does not exist, which is different from a limit of zero, and
 * the two must not render the same way.
 */
function AllowanceStrip({ allowance }: { allowance: PracticeAllowance | null }) {
  if (!allowance) return null;

  const { remaining, limits, usage } = allowance;

  const rows: Array<{ label: string; left: number; cap: number; unit: string }> = [];
  const add = (label: string, left: number | null, cap: number | null, unit = '') => {
    if (left === null || cap === null) return;
    rows.push({ label, left, cap, unit });
  };
  add('today', remaining.dailyAttempts, limits.dailyAttemptLimit);
  add('today', remaining.dailyMinutes, limits.dailyMinutesLimit, 'm');
  add('this month', remaining.monthlyAttempts, limits.monthlyAttemptLimit);
  add('this month', remaining.monthlyMinutes, limits.monthlyMinutesLimit, 'm');
  add('in total', remaining.totalAttempts, limits.totalAttemptLimit);
  add('in total', remaining.totalMinutes, limits.totalMinutesLimit, 'm');

  // Blocked reads very differently from "a few left" and gets its own line
  // rather than a number the agent would have to interpret. Checked BEFORE the
  // empty-rows return: an agent who is locked out has to be told so even when
  // no countdown row could be built from the caps that are set.
  if (!allowance.allowed) {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-[12px] border border-air-live/40 bg-air-live/10 px-4 py-3">
        <LockGlyph className="mt-0.5 h-4 w-4 shrink-0 stroke-air-live" />
        <div>
          <p className="text-sm font-semibold text-air-text">
            {allowance.message ?? 'You have used all your practice for now.'}
          </p>
          <p className="mt-0.5 text-[12.5px] text-air-muted">
            Used {usage.day.attempts} attempt{usage.day.attempts === 1 ? '' : 's'} and{' '}
            {usage.day.minutes}m today.
          </p>
        </div>
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[12px] border border-air-line bg-air-card px-4 py-3">
      <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
        Practice left
      </span>
      {rows.map((row, i) => {
        const spent = row.cap > 0 ? 1 - row.left / row.cap : 1;
        const tone = row.left === 0
          ? 'text-air-live'
          : spent >= 0.8
            ? 'text-amber-400'
            : 'text-air-text';
        return (
          <span key={i} className="text-[13px] text-air-muted">
            <b className={`font-semibold ${tone}`}>{row.left}{row.unit}</b>
            <span className="text-air-faint"> / {row.cap}{row.unit}</span> {row.label}
          </span>
        );
      })}
      <span className="ml-auto text-[12px] text-air-faint">
        {usage.day.attempts} done today
      </span>
    </div>
  );
}

/**
 * The padlock. Practice being spent is a state the agent should SEE before
 * they hold the button down, not learn from a rejected upload.
 */
function LockGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`fill-none stroke-[1.7] ${className}`} aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

/** Colour bands match the server's marking profile: good / ok / warn / poor. */
function toneFor(score: number): { text: string; bg: string; ring: string } {
  if (score >= 80) return { text: 'text-air-mint', bg: 'bg-air-mint', ring: 'rgb(var(--air-mint))' };
  if (score >= 65) return { text: 'text-air-signal-bright', bg: 'bg-air-signal-bright', ring: 'rgb(var(--air-signal-bright))' };
  if (score >= 45) return { text: 'text-air-amber', bg: 'bg-air-amber', ring: 'rgb(var(--air-amber))' };
  return { text: 'text-air-live', bg: 'bg-air-live', ring: 'rgb(var(--air-live))' };
}

/** Where the agent left off, so closing the tab does not send them back to phrase one. */
const POSITION_KEY = 'callsim.practice.position';

const ERROR_LABEL: Record<string, string> = {
  Mispronunciation: 'mispronounced',
  Omission: 'missed',
  Insertion: 'extra',
  UnexpectedBreak: 'pause',
  MissingBreak: 'no pause',
  Monotone: 'flat',
};

function ScoreDial({ label, score }: { label: string; score: number }) {
  const tone = toneFor(score);
  const pct = Math.max(0, Math.min(100, Math.round(score)));

  return (
    <div className="air-panel flex flex-col items-center gap-2 rounded-[16px] border px-3 py-4">
      <div
        className="air-ring relative h-[58px] w-[58px] shrink-0 rounded-full"
        style={{ ['--p' as string]: String(pct), ['--air-ring-color' as string]: tone.ring }}
        aria-hidden
      >
        <span className={`absolute inset-0 z-10 grid place-items-center font-mono-ui text-[13px] font-bold ${tone.text}`}>
          {pct}
        </span>
      </div>
      <span className="font-mono-ui text-[9.5px] uppercase tracking-[0.12em] text-air-faint">{label}</span>
    </div>
  );
}

/** One take's word chips; clicking one opens its sounds below. */
function WordRow({
  words,
  selected,
  onSelect,
}: {
  words: PracticeWord[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {words.map((word, i) => {
        const score = word.marked?.strict ?? word.PronunciationAssessment?.AccuracyScore ?? 0;
        const tone = toneFor(score);
        const errorType = word.PronunciationAssessment?.ErrorType ?? 'None';
        const isSelected = i === selected;

        return (
          <button
            key={`${word.Word}-${i}`}
            type="button"
            onClick={() => onSelect(i)}
            className={`group relative rounded-[10px] border px-3 pb-[10px] pt-2 text-left transition ${
              isSelected ? 'border-air-signal bg-air-bg2' : 'border-air-line bg-air-panel hover:border-air-line2'
            }`}
          >
            <span className="block text-[15px] leading-tight text-air-text">{word.Word}</span>
            <span className={`mt-0.5 block font-mono-ui text-[10px] ${tone.text}`}>{Math.round(score)}</span>
            {errorType !== 'None' && (
              <span className={`mt-1 block font-mono-ui text-[8.5px] uppercase tracking-[0.08em] ${tone.text}`}>
                {ERROR_LABEL[errorType] ?? errorType.toLowerCase()}
              </span>
            )}
            <span className={`absolute inset-x-2 bottom-1 block h-[2px] rounded ${tone.bg}`} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export default function PracticePage() {
  const { token, loadFromStorage } = useAuthStore();
  const recorder = usePracticeRecorder();

  // The store starts empty on a fresh page load; every other floor page does
  // the same, otherwise token stays null and nothing ever fetches.
  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const [sentences, setSentences] = useState<PracticeSentence[]>([]);
  const [guide, setGuide] = useState<PhonemeGuide>({});
  const [index, setIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [history, setHistory] = useState<PracticeAttempt[]>([]);
  const [selectedWord, setSelectedWord] = useState(0);
  const [scoring, setScoring] = useState(false);
  /** Set while reviewing a past take; null means "the take I just recorded". */
  const [reviewing, setReviewing] = useState<{ id: string; at: string } | null>(null);
  /**
   * The recording just made, decoded so single words can be replayed from it.
   * Never uploaded anywhere and never persisted — it lives for this take only,
   * which is why a past attempt cannot be listened back to.
   */
  const [take, setTake] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * ── A LIMIT SHOULD BE VISIBLE BEFORE IT IS HIT ─────────────────────────
   *
   * Practice is capped, and until now the only way an agent found out was to
   * run out: a take came back 429 "Practice limit reached" partway through a
   * session, with no warning and no way to have paced themselves.
   *
   * Null while it loads, and null on failure — the allowance is informational,
   * so a failed fetch hides the strip rather than blocking practice.
   */
  const [allowance, setAllowance] = useState<PracticeAllowance | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentencesRef = useRef<PracticeSentence[]>([]);
  /** Opened attempts by id — re-opening a row should not re-fetch 7 KB. */
  const attemptCache = useRef(new Map<string, PracticeResult>());
  const playbackCtx = useRef<AudioContext | null>(null);
  const playingSource = useRef<AudioBufferSourceNode | null>(null);
  const indexRef = useRef(0);
  sentencesRef.current = sentences;
  indexRef.current = index;

  const active = sentences[index] ?? null;
  const activeId = active?.id ?? null;
  /**
   * ── PRACTICE IS SPENT: LOCK THE BUTTON, DO NOT REJECT THE UPLOAD ─────────
   *
   * MEASURED behaviour before this: the agent held the button, read the whole
   * phrase, waited for it to upload, and only then got "please try again
   * later, maximum attempts". The allowance was already on the page and simply
   * was not consulted. The button is now locked while `allowed` is false, and
   * `handleRecordToggle` refuses as well — a disabled button is the courtesy,
   * the guard is the rule.
   *
   * `allowance` is null while it loads and null when the fetch failed, and
   * NEITHER locks: practice must not be blocked by an informational request
   * that did not come back. The server is the authority and still answers 429.
   */
  const practiceLocked = allowance?.allowed === false;

  /**
   * Move to another phrase. The score belongs to the take, not the list, so
   * it is cleared — the history panel below reloads for the new phrase.
   */
  const goTo = useCallback(
    (next: number) => {
      setIndex((prev) => {
        const clamped = Math.max(0, Math.min(next, sentencesRef.current.length - 1));
        if (clamped !== prev) {
          setResult(null);
          setError(null);
          setShowAll(false);
          setReviewing(null);
          setTake(null);
          try { window.localStorage.setItem(POSITION_KEY, String(clamped)); } catch {}
        }
        return clamped;
      });
    },
    [],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const [list, table, left] = await Promise.all([
          api.sentences(token),
          api.phonemes(token),
          // Informational: a failure must not stop the agent practising.
          api.allowance(token).catch(() => null),
        ]);
        if (cancelled) return;
        setSentences(list.data);
        setGuide(table.data);
        if (left) setAllowance(left.data);
        // Resume where they left off, unless the list shrank since.
        const saved = Number(window.localStorage.getItem(POSITION_KEY) ?? 0);
        setIndex(Number.isFinite(saved) ? Math.max(0, Math.min(saved, list.data.length - 1)) : 0);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  // History is per sentence, so it reloads when the agent switches phrase.
  useEffect(() => {
    if (!token || !activeId) return;
    let cancelled = false;
    api
      .attempts(token, activeId)
      .then((r) => { if (!cancelled) setHistory(r.data); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [token, activeId, result]);

  const play = useCallback(
    async (text: string, opts: { ipa?: string; rate?: number } = {}) => {
      const el = audioRef.current;
      if (!el || !token) return;
      try {
        // Fetched with the token rather than pointed at directly: a media
        // element sends no Authorization header, so a bare src would 401.
        el.src = await api.audio(token, text, opts);
        await el.play();
      } catch (err) {
        setError((err as Error).message || 'Could not play the reference audio.');
      }
    },
    [token],
  );

  // Arrow keys, for an agent working through a run of phrases.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.key === 'ArrowRight') goTo(indexRef.current + 1);
      if (e.key === 'ArrowLeft') goTo(indexRef.current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo]);

  /**
   * Play the take back, or one word of it.
   *
   * Word offsets come from the assessment in 100-nanosecond ticks measured
   * from the start of the audio that was sent — which is exactly this buffer,
   * so a word can be sliced out without any alignment work. Hearing your own
   * "dawood" next to the reference is the thing that actually teaches; a
   * score only says something is wrong.
   */
  const playOwn = useCallback(
    (fromTicks?: number, durationTicks?: number) => {
      if (!take) return;
      const ctx = playbackCtx.current ?? new AudioContext();
      playbackCtx.current = ctx;
      // Stop whatever was playing, so two taps do not overlap.
      try { playingSource.current?.stop(); } catch {}

      const source = ctx.createBufferSource();
      source.buffer = take;
      source.connect(ctx.destination);
      playingSource.current = source;

      if (fromTicks == null || durationTicks == null) {
        source.start();
        return;
      }
      const from = fromTicks / 10_000_000;
      // A hair of padding either side: cutting exactly on the boundary clips
      // the onset of the first sound and sounds worse than it was.
      const pad = 0.06;
      const start = Math.max(0, from - pad);
      const length = Math.min(take.duration - start, durationTicks / 10_000_000 + pad * 2);
      source.start(0, start, length);
    },
    [take],
  );

  /** Load one past take and show it through the same score view. */
  const openAttempt = useCallback(
    async (attemptId: string, at: string) => {
      if (!token) return;
      setError(null);
      const cached = attemptCache.current.get(attemptId);
      if (cached) {
        setResult(cached);
        setSelectedWord(0);
        setReviewing({ id: attemptId, at });
        return;
      }
      try {
        const res = await api.attempt(token, attemptId);
        attemptCache.current.set(attemptId, res.data);
        setResult(res.data);
        setSelectedWord(0);
        setReviewing({ id: attemptId, at });
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [token],
  );

  const backToLatest = useCallback(() => {
    setReviewing(null);
    setResult(null);
    setError(null);
  }, []);

  const handleRecordToggle = useCallback(async () => {
    setError(null);
    // Spent means spent: nothing starts, so no take is recorded that the
    // server would only reject.
    if (practiceLocked && !recorder.isRecording) return;

    if (!recorder.isRecording) {
      await recorder.start();
      return;
    }

    const wav = await recorder.stop();
    if (!wav) {
      setError('That take was too short. Hold the button while you read the whole phrase.');
      return;
    }
    if (!token || !activeId) return;

    // Keep the take for playback before it is uploaded. Decoding copies the
    // samples, so the blob itself is not held on to.
    try {
      const ctx = playbackCtx.current ?? new AudioContext();
      playbackCtx.current = ctx;
      setTake(await ctx.decodeAudioData(await wav.arrayBuffer()));
    } catch {
      setTake(null);
    }

    setScoring(true);
    try {
      const scored = await api.score(token, activeId, wav);
      setReviewing(null);
      setResult(scored);
      setSelectedWord(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScoring(false);
      // Re-read the allowance WHICHEVER WAY the take ended, so the strip counts
      // down as it is spent rather than only on a page reload — and so a take
      // the server refused for hitting the cap locks the button immediately
      // instead of leaving it inviting.
      void api.allowance(token).then((left) => setAllowance(left.data)).catch(() => {});
    }
  }, [recorder, token, activeId, practiceLocked]);

  const word = result?.words[selectedWord] ?? null;

  // Compare against the take immediately before the one on screen. Comparing
  // a take from Tuesday against "your latest" would report a change that
  // never happened; the oldest take has nothing to compare to.
  const shownIndex = reviewing ? history.findIndex((a) => a.id === reviewing.id) : 0;
  const previous = shownIndex >= 0 ? history[shownIndex + 1] : undefined;
  const delta =
    result && previous
      ? Math.round((result.overall.pronunciation - previous.overallScore) * 10) / 10
      : null;

  return (
    <TrainingFloorShell>
      <audio ref={audioRef} className="hidden" />

      {/* Same full-width shell the other floor pages use: no max-width cap,
          padding scales with the viewport. */}
      <main className="w-full px-5 pb-28 pt-8 sm:px-8 xl:px-12">
      <div className="mb-6">
        {/* Their redesign's section eyebrow, carried onto our page: the rest of
            the trainee floor gained one in the same pull, and a screen without
            it now reads as a different product. */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-air-signal shadow-[0_0_10px_rgb(var(--air-signal))]" />
          <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
            Speaking practice
          </span>
        </div>
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.035em] text-air-text">
          Pronunciation Practice
        </h1>
        <p className="mt-1 max-w-[62ch] text-sm text-air-muted">
          Read a phrase aloud and get scored on every sound. Tap any word to hear how it should sound
          and see exactly where a take went wrong.
        </p>
      </div>

      <AllowanceStrip allowance={allowance} />

      {error && (
        <div className="mb-5 rounded-[12px] border border-air-live/40 bg-air-live/10 px-4 py-3 text-sm text-air-text">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-air-muted">Loading practice phrases…</p>
      ) : sentences.length === 0 ? (
        <div className="air-panel rounded-[16px] border px-5 py-8 text-center">
          <p className="text-sm text-air-muted">
            No practice phrases have been published yet. An admin adds them from the portal.
          </p>
        </div>
      ) : (
        <div className="w-full">
          {/* ── position + navigation ─────────────────── */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                aria-label="Previous phrase"
                className="grid h-9 w-9 place-items-center rounded-[10px] border border-air-line text-air-muted transition hover:border-air-signal hover:text-air-text disabled:opacity-30 disabled:hover:border-air-line"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                disabled={index >= sentences.length - 1}
                aria-label="Next phrase"
                className="grid h-9 w-9 place-items-center rounded-[10px] border border-air-line text-air-muted transition hover:border-air-signal hover:text-air-text disabled:opacity-30 disabled:hover:border-air-line"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="font-mono-ui text-[11px] uppercase tracking-[0.11em] text-air-faint">
                Phrase {index + 1} of {sentences.length}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="font-mono-ui text-[11px] uppercase tracking-[0.09em] text-air-muted transition hover:text-air-text"
            >
              {showAll ? 'Hide list' : 'All phrases'}
            </button>
          </div>

          {/* One dot per phrase: position and length at a glance, and a way
              to jump without stepping through everything in between. */}
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Phrases">
            {sentences.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Phrase ${i + 1}`}
                title={s.text}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-6 bg-air-signal' : 'w-1.5 bg-air-line hover:bg-air-line2'
                }`}
              />
            ))}
          </div>

          {showAll && (
            <ul className="air-panel mb-4 flex max-h-[260px] flex-col gap-1 overflow-y-auto rounded-[14px] border p-2">
              {sentences.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    className={`w-full rounded-[9px] px-3 py-2 text-left text-[13px] leading-snug transition ${
                      i === index ? 'bg-air-signal/12 text-air-text' : 'text-air-muted hover:bg-air-bg2 hover:text-air-text'
                    }`}
                  >
                    <span className="mr-2 font-mono-ui text-[10px] text-air-faint">{i + 1}</span>
                    {s.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-5">
            {/* ── the phrase + recorder ─────────────────── */}
            <section className="air-panel rounded-[16px] border p-5">
              <div className="flex items-start justify-between gap-4">
                <p className="text-[19px] font-semibold leading-snug text-air-text">{active?.text}</p>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Locked with the recorder. Reference playback costs no
                      allowance — /api/pronunciation/tts is not metered — so
                      this is not a cost control: it is that a practice surface
                      whose recorder is locked should not stay half alive,
                      inviting an agent to work at a phrase they cannot attempt. */}
                  <button
                    type="button"
                    onClick={() => { if (active && !practiceLocked) void play(active.text); }}
                    disabled={practiceLocked}
                    data-testid="practice-listen"
                    title={practiceLocked ? (allowance?.message ?? 'You have used all your practice for now.') : 'Hear the phrase'}
                    className="flex items-center gap-1.5 rounded-[9px] border border-air-line px-3 py-2 font-mono-ui text-[11px] uppercase tracking-[0.08em] text-air-muted transition hover:border-air-signal hover:text-air-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-air-line disabled:hover:text-air-muted"
                  >
                    {practiceLocked && <LockGlyph className="h-3 w-3 stroke-current" />}
                    Listen
                  </button>
                  {/* Your own voice, straight after the model — the comparison is
                      the lesson. Only the current take exists; recordings are
                      never stored, so a past attempt has nothing to play. */}
                  <button
                    type="button"
                    onClick={() => playOwn()}
                    disabled={!take || practiceLocked}
                    title={take ? 'Play your recording' : 'Record this phrase first'}
                    className="rounded-[9px] border border-air-line px-3 py-2 font-mono-ui text-[11px] uppercase tracking-[0.08em] text-air-muted transition hover:border-air-signal hover:text-air-text disabled:opacity-35 disabled:hover:border-air-line"
                  >
                    You
                  </button>
                </div>
              </div>
              {active?.hint && <p className="mt-2 text-[13px] text-air-muted">{active.hint}</p>}
              {active?.campaign && (
                <span className="mt-2 inline-block font-mono-ui text-[9.5px] uppercase tracking-[0.1em] text-air-faint">
                  {active.campaign.replace('_', ' ')}
                </span>
              )}

              <div className="mt-5 flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleRecordToggle}
                  disabled={scoring || practiceLocked}
                  data-testid="practice-record"
                  aria-label={
                    practiceLocked
                      ? 'Practice locked — you have used your attempts'
                      : recorder.isRecording ? 'Stop recording' : 'Start recording'
                  }
                  title={practiceLocked ? (allowance?.message ?? 'You have used all your practice for now.') : undefined}
                  className={`grid h-[62px] w-[62px] shrink-0 place-items-center rounded-full border transition disabled:cursor-not-allowed ${
                    practiceLocked
                      ? 'border-air-line bg-air-line/10 text-air-faint opacity-100'
                      : recorder.isRecording
                        ? 'border-air-live bg-air-live/15 text-air-live disabled:opacity-50'
                        : 'border-air-signal bg-air-signal/12 text-air-signal-bright hover:bg-air-signal/20 disabled:opacity-50'
                  }`}
                >
                  {practiceLocked ? (
                    <LockGlyph className="h-6 w-6 stroke-current" />
                  ) : recorder.isRecording ? (
                    <span className="block h-4 w-4 rounded-[3px] bg-current" />
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current stroke-[1.7]">
                      <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Z" />
                      <path d="M18.5 11.5a6.5 6.5 0 0 1-13 0M12 18v3" strokeLinecap="round" />
                    </svg>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex h-8 items-end gap-[3px]" aria-hidden>
                    {Array.from({ length: 32 }).map((_, i) => {
                      const wobble = 0.55 + 0.45 * Math.sin((i / 32) * Math.PI);
                      const h = recorder.isRecording ? 3 + recorder.level * wobble * 28 : 3;
                      return (
                        <span
                          key={i}
                          className="flex-1 rounded-[2px] bg-air-signal/70 transition-[height] duration-75"
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                  <p className="mt-1 flex items-center justify-between text-[12px] text-air-muted">
                    <span>
                      {practiceLocked
                        ? (allowance?.message ?? 'You have used all your practice for now.')
                        : scoring
                          ? 'Scoring your take…'
                          : recorder.isRecording
                            ? 'Listening — press again when you finish'
                            : 'Press to record'}
                    </span>
                    <span className="font-mono-ui text-[11px]">
                      {recorder.seconds > 0 ? `${recorder.seconds.toFixed(1)}s` : ''}
                    </span>
                  </p>
                </div>
              </div>

              {recorder.error && <p className="mt-3 text-[13px] text-air-live">{recorder.error}</p>}
            </section>

            {/* ── the score ─────────────────────────────── */}
            {result && (
              <>
                <section className="air-panel rounded-[16px] border p-5">
                  {reviewing && (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-air-line bg-air-bg2 px-4 py-2.5">
                      <span className="text-[13px] text-air-muted">
                        Reviewing your take from{' '}
                        <b className="font-medium text-air-text">
                          {new Date(reviewing.at).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </b>
                      </span>
                      <button
                        type="button"
                        onClick={backToLatest}
                        className="font-mono-ui text-[10.5px] uppercase tracking-[0.09em] text-air-signal-bright transition hover:text-air-text"
                      >
                        Back to recording
                      </button>
                    </div>
                  )}

                  <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-mono-ui text-[10px] uppercase tracking-[0.12em] text-air-faint">Score</h2>
                    <span className="text-[12px] italic text-air-muted">heard: “{result.recognizedText}”</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <ScoreDial label="Overall" score={result.overall.pronunciation} />
                    <ScoreDial label="Accuracy" score={result.overall.accuracy} />
                    <ScoreDial label="Fluency" score={result.overall.fluency} />
                    <ScoreDial label="Prosody" score={result.overall.prosody} />
                    <ScoreDial label="Complete" score={result.overall.completeness} />
                  </div>

                  <p className="mt-3 flex items-center gap-3 text-[12px] text-air-muted">
                    {delta !== null && delta !== 0 && (
                      <span className={delta > 0 ? 'text-air-mint' : 'text-air-live'}>
                        {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs your last try
                      </span>
                    )}
                    {!reviewing && (
                    <span className="font-mono-ui text-[11px] text-air-faint">
                      {/* No cap set at any scope means there is no denominator
                          to show — printing one rendered "3/ attempts today". */}
                      {result.dailyLimit === null
                        ? `${result.attemptsToday} attempts today`
                        : `${result.attemptsToday}/${result.dailyLimit} attempts today`}
                    </span>
                    )}
                  </p>
                </section>

                <section className="air-panel rounded-[16px] border p-5">
                  <h2 className="mb-3 font-mono-ui text-[10px] uppercase tracking-[0.12em] text-air-faint">
                    Word by word <span className="normal-case tracking-normal">— tap one for its sounds</span>
                  </h2>
                  <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                    <WordRow words={result.words} selected={selectedWord} onSelect={setSelectedWord} />

                  {word && (
                    <div className="rounded-[14px] border border-air-line bg-air-bg2 p-4 max-xl:mt-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-[19px] font-semibold text-air-text">{word.Word}</h3>
                        <span className="font-mono-ui text-[12px] text-air-muted">
                          {Math.round(word.marked?.strict ?? 0)} / 100
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void play(word.Word, {
                              // Pin the sound to the phonemes that were scored, so a
                              // homograph (read, live, bow) plays the right reading.
                              ipa:
                                (word.Syllables?.length ?? 0) <= 1
                                  ? word.Phonemes?.map((p) => p.Phoneme).join('')
                                  : undefined,
                            })
                          }
                          className="rounded-[8px] border border-air-line px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-air-muted transition hover:border-air-signal hover:text-air-text"
                        >
                          Listen
                        </button>
                        <button
                          type="button"
                          onClick={() => void play(word.Word, { rate: 0.6 })}
                          className="rounded-[8px] border border-air-line px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-air-muted transition hover:border-air-signal hover:text-air-text"
                        >
                          Slowly
                        </button>
                        {/* The same word cut out of the agent's own recording. */}
                        <button
                          type="button"
                          onClick={() => playOwn(word.Offset, word.Duration)}
                          disabled={!take || word.Offset == null}
                          title={take ? 'Hear yourself say this word' : 'Record this phrase first'}
                          className="rounded-[8px] border border-air-line px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-air-muted transition hover:border-air-signal hover:text-air-text disabled:opacity-35 disabled:hover:border-air-line"
                        >
                          You
                        </button>
                      </div>

                      <p className="mt-3 font-mono-ui text-[10px] uppercase tracking-[0.12em] text-air-faint">
                        Sounds
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(word.Phonemes ?? []).map((p, i) => {
                          const score = p.PronunciationAssessment?.AccuracyScore ?? 0;
                          const tone = toneFor(score);
                          const plain = guide[p.Phoneme];
                          return (
                            <div
                              key={`${p.Phoneme}-${i}`}
                              className="min-w-[64px] rounded-[10px] border border-air-line bg-air-panel px-3 py-2 text-center"
                            >
                              <span className="block font-mono-ui text-[14px] text-air-text">
                                {plain?.say ?? p.Phoneme}
                              </span>
                              <span className="mt-1 block h-[3px] w-full overflow-hidden rounded bg-air-line/40">
                                <span
                                  className={`block h-full rounded ${tone.bg}`}
                                  style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                                />
                              </span>
                              <span className={`mt-1 block font-mono-ui text-[10px] ${tone.text}`}>
                                {Math.round(score)}
                              </span>
                              {plain && (
                                <span className="mt-0.5 block text-[9.5px] text-air-faint">as in {plain.as}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Only the sounds that actually went wrong get advice. */}
                      {(word.Phonemes ?? [])
                        .filter((p) => (p.PronunciationAssessment?.AccuracyScore ?? 100) < 60)
                        .slice(0, 2)
                        .map((p, i) => {
                          const alt = (p.PronunciationAssessment.NBestPhonemes ?? []).find(
                            (a) => a.Phoneme !== p.Phoneme && a.Score > 0,
                          );
                          if (!alt) return null;
                          const want = guide[p.Phoneme];
                          const got = guide[alt.Phoneme];
                          return (
                            <p key={i} className="mt-3 text-[13px] text-air-muted">
                              Your <b className="font-mono-ui text-air-text">{want?.say ?? p.Phoneme}</b>
                              {want && <> (as in {want.as})</>} sounded more like{' '}
                              <b className="font-mono-ui text-air-amber">{got?.say ?? alt.Phoneme}</b>
                              {got && <> (as in {got.as})</>}.
                            </p>
                          );
                        })}
                    </div>
                  )}
                  </div>
                </section>
              </>
            )}

            {/* ── past takes ────────────────────────────── */}
            {history.length > 0 && (
              <section className="air-panel rounded-[16px] border p-5">
                <h2 className="mb-3 font-mono-ui text-[10px] uppercase tracking-[0.12em] text-air-faint">
                  Your attempts <span className="normal-case tracking-normal">— tap one to see how it scored</span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-[13px]">
                    <thead>
                      <tr className="text-left font-mono-ui text-[9.5px] uppercase tracking-[0.1em] text-air-faint">
                        <th className="pb-2 pr-3 font-medium">When</th>
                        <th className="pb-2 pr-3 text-right font-medium">Overall</th>
                        <th className="pb-2 pr-3 text-right font-medium">Accuracy</th>
                        <th className="pb-2 pr-3 text-right font-medium">Fluency</th>
                        <th className="pb-2 text-right font-medium">Prosody</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((a) => (
                        <tr
                          key={a.id}
                          onClick={() => void openAttempt(a.id, a.createdAt)}
                          title="Open this take"
                          className={`cursor-pointer border-t border-air-line/60 transition ${
                            reviewing?.id === a.id ? 'bg-air-signal/10' : 'hover:bg-air-bg2'
                          }`}
                        >
                          <td className="py-2 pr-3 text-air-muted">
                            {new Date(a.createdAt).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                          <td className={`py-2 pr-3 text-right font-mono-ui ${toneFor(a.overallScore).text}`}>
                            {Math.round(a.overallScore)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono-ui text-air-muted">{Math.round(a.accuracyScore)}</td>
                          <td className="py-2 pr-3 text-right font-mono-ui text-air-muted">{Math.round(a.fluencyScore)}</td>
                          <td className="py-2 text-right font-mono-ui text-air-muted">{Math.round(a.prosodyScore)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
      </main>
    </TrainingFloorShell>
  );
}
