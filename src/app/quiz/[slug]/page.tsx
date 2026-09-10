'use client';

/**
 * Quiz runner — one component for every quiz.
 *
 * The ACA Quiz and the Grand Test both render here; they differ only by slug.
 * Nothing about either is special-cased, so a third quiz needs no new code.
 *
 * Two kinds of question. Multiple choice is radio buttons, scored the moment
 * the paper is submitted. Written questions are a textarea with the line count
 * the admin asked for — those cannot be machine-marked, so a paper containing
 * any of them comes back "with your trainer" rather than with a score.
 *
 * Scoring is entirely server-side. The paper served here carries no correct
 * answers, and the result screen only shows them after submission.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Lock, PhoneCall, XCircle } from 'lucide-react';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { journey as journeyApi, type QuizPaper, type QuizResult } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Non-empty lines — what "write 5 lines" actually asks for. */
function countLines(text: string): number {
  return text.split('\n').filter((line) => line.trim().length > 0).length;
}

export default function QuizPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug ?? '');
  const router = useRouter();
  const { token, loadFromStorage } = useAuthStore();

  const [paper, setPaper] = useState<QuizPaper | null>(null);
  // Option id for multiple choice, prose for written — keyed by question id in
  // two maps rather than one, so neither kind can read the other's value.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [written, setWritten] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [showUnanswered, setShowUnanswered] = useState(false);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token || !slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await journeyApi.getQuiz(token, slug);
      setPaper(res.data);
    } catch (err: any) {
      setError(err.message || 'Could not load this quiz');
    } finally {
      setLoading(false);
    }
  }, [token, slug]);

  useEffect(() => { load(); }, [load]);

  const unanswered = useMemo(
    () =>
      paper
        ? paper.questions.filter((q) =>
            q.kind === 'WRITTEN' ? !written[q.id]?.trim() : !answers[q.id],
          )
        : [],
    [paper, answers, written],
  );

  /**
   * Written answers that are present but shorter than the admin asked for.
   * Warned about, never blocked: a short answer is still an answer, and losing
   * a paper to a line count would be worse than marking a thin one.
   */
  const tooShort = useMemo(
    () =>
      paper
        ? paper.questions.filter((q) => {
            if (q.kind !== 'WRITTEN' || !q.minLines) return false;
            const text = written[q.id]?.trim();
            return Boolean(text) && countLines(text!) < q.minLines;
          })
        : [],
    [paper, written],
  );

  const hasWritten = Boolean(paper?.questions.some((q) => q.kind === 'WRITTEN'));
  const hasScenarios = Boolean(paper?.sections.some((s) => s.key === 'scenario'));

  /**
   * The paper as alternating section headers and questions. Section boundaries
   * are server-announced (a header whenever the section changes — and, inside
   * the scenario section, one per set, because each set has its own script),
   * so the runner just reads them off in order.
   */
  const rows = useMemo(() => {
    if (!paper) return [];
    const rows: Array<
      | { type: 'section'; section: QuizPaper['sections'][number] }
      | { type: 'question'; question: QuizPaper['questions'][number]; number: number }
    > = [];
    let sectionIndex = 0;
    let questionNumber = 0;
    paper.questions.forEach((question, index) => {
      const prev = paper.questions[index - 1];
      const changed =
        !prev ||
        prev.sectionKey !== question.sectionKey ||
        (question.sectionKey === 'scenario' && prev.scenarioTag !== question.scenarioTag) ||
        (prev.heading ?? null) !== (question.heading ?? null);
      if (changed) {
        rows.push({ type: 'section', section: paper.sections[sectionIndex++] });
      }
      questionNumber += 1;
      rows.push({ type: 'question', question, number: questionNumber });
    });
    return rows;
  }, [paper]);

  async function handleSubmit() {
    if (!token || !paper) return;

    // Single-attempt quizzes make an accidental submit unrecoverable, so an
    // incomplete or under-length paper needs an explicit second confirmation.
    if ((unanswered.length > 0 || tooShort.length > 0) && !showUnanswered) {
      setShowUnanswered(true);
      document.getElementById('quiz-submit-warning')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await journeyApi.submitQuiz(
        token,
        slug,
        paper.questions.map((q) =>
          q.kind === 'WRITTEN'
            ? { questionId: q.id, answerText: written[q.id]?.trim() || null }
            : { questionId: q.id, selectedOptionId: answers[q.id] ?? null },
        ),
      );
      setResult(res.data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err.message || 'Could not submit your answers');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TrainingFloorShell>
      <main className="w-full px-5 sm:px-8 xl:px-12">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 pt-8 text-[13.5px] font-semibold text-air-muted transition-colors hover:text-air-text"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to my journey
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-air-signal border-t-transparent" />
          </div>
        ) : result ? (
          <ResultPanel result={result} onBack={() => router.push('/dashboard')} />
        ) : error && !paper ? (
          <LockedPanel message={error} />
        ) : paper ? (
          <>
            <header className="air-panel mt-5 rounded-[22px] border p-6 backdrop-blur-md sm:p-8">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-air-text">
                    {paper.title}
                  </h1>
                  <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-air-muted">{paper.description}</p>
                </div>
                <span className="inline-flex items-center gap-2.5 rounded-full border border-air-signal/30 bg-air-signal/10 px-3.5 py-[7px] font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.2em] text-air-signal-bright">
                  <i className="h-[7px] w-[7px] rounded-full bg-air-signal-bright shadow-[0_0_10px_rgb(var(--air-signal-bright))]" />
                  In progress
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label="Questions" value={String(paper.questions.length)} />
                <Fact label="Pass mark" value={`${paper.passThresholdPct}%`} />
                <Fact
                  label="Attempts"
                  value={
                    paper.attemptsAllowed === null
                      ? 'Unlimited'
                      : `${paper.attemptsRemaining} of ${paper.attemptsAllowed} left`
                  }
                />
              </dl>

              {paper.attemptsAllowed === 1 && (
                <p className="mt-4 flex items-start gap-2.5 rounded-xl border border-air-amber/30 bg-air-amber/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-air-text">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-air-amber" aria-hidden />
                  <span>
                    You get <strong className="text-air-amber">one attempt</strong> at this quiz. Take your time — your answers are only
                    marked once you press Submit.
                  </span>
                </p>
              )}

              {hasWritten && (
                <p className="mt-3 flex items-start gap-2.5 rounded-xl border border-air-signal/25 bg-air-signal/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-air-text">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-air-signal-bright" aria-hidden />
                  <span>
                    Some questions ask you to <strong className="text-air-signal-bright">write your answer</strong>. Those are read by your
                    trainer, so your result comes back after they have marked it — not straight away.
                  </span>
                </p>
              )}

              {hasScenarios && (
                <p className="mt-3 flex items-start gap-2.5 rounded-xl border border-air-signal/25 bg-air-signal/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-air-text">
                  <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-air-signal-bright" aria-hidden />
                  <span>
                    At the end there is a <strong className="text-air-signal-bright">practice call scenario</strong>: read the call script, then
                    answer its questions. Every other paper may carry a different scenario — they are
                    drawn at random from the scenario pool.
                  </span>
                </p>
              )}
            </header>

            <ol className="mt-6 space-y-5">
              {rows.map((row, index) =>
                row.type === 'section' ? (
                  <li key={`section-${index}`}>
                    {row.section.key === 'scenario' ? (
                      <div className="air-panel overflow-hidden rounded-[22px] border border-air-signal/25 bg-air-signal/[0.07] backdrop-blur-md">
                        <div className="air-hairline flex items-center gap-2.5 border-b px-6 py-3.5">
                          <PhoneCall className="h-4 w-4 shrink-0 text-air-signal-bright" aria-hidden />
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-air-signal-bright">
                            Practice call scenario
                          </p>
                          {row.section.scenarioTitle && (
                            <h2 className="ml-auto font-display text-[15px] font-bold tracking-[-0.01em] text-air-text">
                              {row.section.scenarioTitle}
                            </h2>
                          )}
                        </div>
                        {row.section.scenarioNarrative && (
                          <div className="whitespace-pre-wrap px-6 py-5 text-[14px] leading-[1.75] text-air-text">
                            {row.section.scenarioNarrative}
                          </div>
                        )}
                        <p className="air-hairline flex items-center gap-2 border-t px-6 py-3 text-[12px] text-air-cyan">
                          Read the call above, then answer the questions that follow. Your trainer marks
                          these by hand.
                        </p>
                      </div>
                    ) : (
                      <div className="pt-3">
                        <h2 className="font-display text-[17px] font-extrabold tracking-[-0.01em] text-air-text">
                          {row.section.title}
                        </h2>
                      </div>
                    )}
                  </li>
                ) : (
                  <li key={row.question.id} className="air-panel rounded-[22px] border p-6 backdrop-blur-md sm:p-7">
                    <fieldset>
                      <legend className="mb-4 flex gap-3">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-air-signal/35 bg-air-signal/10 font-mono-ui text-[11.5px] font-bold text-air-signal-bright">
                          {row.number}
                        </span>
                        <span className="pt-0.5 text-[15px] font-semibold leading-relaxed text-air-text">
                          {row.question.prompt}
                        </span>
                      </legend>

                      {row.question.kind === 'WRITTEN' ? (
                        <WrittenAnswer
                          question={row.question}
                          value={written[row.question.id] ?? ''}
                          onChange={(text) => setWritten((prev) => ({ ...prev, [row.question.id]: text }))}
                        />
                      ) : (
                        <div className="space-y-2.5 sm:pl-10">
                          {row.question.options.map((option) => {
                            const checked = answers[row.question.id] === option.id;
                            return (
                              <label
                                key={option.id}
                                className={cn(
                                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all duration-150',
                                  checked
                                    ? 'border-air-signal/50 bg-air-signal/[0.1] shadow-[0_0_0_1px_rgb(var(--air-signal)/0.35)]'
                                    : 'border-air-line/25 hover:border-air-line/50 hover:bg-air-line/[0.06]',
                                )}
                              >
                                <input
                                  type="radio"
                                  name={row.question.id}
                                  value={option.id}
                                  checked={checked}
                                  onChange={() => setAnswers((prev) => ({ ...prev, [row.question.id]: option.id }))}
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-air-signal-bright"
                                />
                                <span className={cn('text-[14px] leading-relaxed', checked ? 'font-semibold text-air-text' : 'text-air-muted')}>
                                  {option.text}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </fieldset>
                  </li>
                ),
              )}
            </ol>

            <div className="air-panel sticky bottom-4 mt-6 rounded-[20px] border p-5 shadow-[var(--air-shadow-lg)] backdrop-blur-xl" id="quiz-submit-warning">
              {showUnanswered && unanswered.length > 0 && (
                <p className="mb-3 flex items-start gap-2.5 rounded-xl border border-air-amber/30 bg-air-amber/[0.08] px-4 py-3 text-[13px] leading-relaxed text-air-text">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-air-amber" aria-hidden />
                  <span>
                    You have <strong className="text-air-amber">{unanswered.length}</strong> unanswered{' '}
                    {unanswered.length === 1 ? 'question' : 'questions'}. Unanswered questions are marked wrong.
                    Press Submit again to hand in anyway.
                  </span>
                </p>
              )}

              {showUnanswered && tooShort.length > 0 && (
                <p className="mb-3 flex items-start gap-2.5 rounded-xl border border-air-amber/30 bg-air-amber/[0.08] px-4 py-3 text-[13px] leading-relaxed text-air-text">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-air-amber" aria-hidden />
                  <span>
                    <strong className="text-air-amber">{tooShort.length}</strong> written{' '}
                    {tooShort.length === 1 ? 'answer is' : 'answers are'} shorter than asked for. You can hand
                    in anyway — your trainer marks what you wrote.
                  </span>
                </p>
              )}

              {error && (
                <p className="mb-3 rounded-xl border border-air-live/35 bg-air-live/10 px-4 py-3 text-[13px] font-medium text-air-live">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono-ui text-[12px] text-air-faint">
                  <b className="text-air-signal-bright">{paper.questions.length - unanswered.length}</b> of {paper.questions.length} answered
                </p>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-xl bg-gradient-to-r from-air-signal to-air-signal-bright px-7 py-3 text-[14px] font-bold text-white shadow-[0_0_28px_rgb(var(--air-signal)/0.45)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgb(var(--air-signal)/0.7)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {submitting
                    ? 'Submitting…'
                    : showUnanswered && (unanswered.length > 0 || tooShort.length > 0)
                      ? 'Submit anyway'
                      : 'Submit answers'}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </main>
    </TrainingFloorShell>
  );
}

/**
 * A written answer, with the length the admin asked for shown as a live count.
 *
 * The count is guidance, not a gate: the textarea never refuses input and the
 * paper always submits. Writing "3 of 5 lines" under the box is enough — the
 * agent can see where they are, and a trainer marks what is actually there.
 */
function WrittenAnswer({
  question, value, onChange,
}: {
  question: QuizPaper['questions'][number];
  value: string;
  onChange: (text: string) => void;
}) {
  const lines = countLines(value);
  const min = question.minLines;
  const max = question.maxLines;
  const short = Boolean(min && lines > 0 && lines < min);
  const over = Boolean(max && lines > max);

  const asked = min && max ? `${min}–${max} lines` : min ? `at least ${min} lines` : max ? `up to ${max} lines` : null;

  return (
    <div className="sm:pl-10">
      {asked && (
        <p className="mb-2 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.14em] text-air-cyan">
          Write {asked}
        </p>
      )}

      <textarea
        rows={Math.min(Math.max(min ?? 5, 4), 14)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your answer here — one point per line."
        className={cn(
          'w-full rounded-xl border bg-air-bg2 p-3.5 text-[14px] leading-relaxed text-air-text outline-none transition placeholder:text-air-faint focus:border-air-signal/50 focus:shadow-[0_0_0_1px_rgb(var(--air-signal)/0.35)]',
          value.trim() ? 'border-air-signal/35' : 'border-air-line/25',
        )}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className={cn('font-mono-ui', short || over ? 'text-air-amber' : 'text-air-faint')}>
          {lines} line{lines === 1 ? '' : 's'}
          {min ? ` of ${min}${max && max !== min ? `–${max}` : ''}` : ''}
          {over ? ' — longer than asked for, which is fine' : ''}
        </span>
        <span className="text-air-faint">
          Marked by your trainer · {question.points} point{question.points === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-air-line/25 bg-air-line/[0.07] px-3.5 py-2.5">
      <dt className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.12em] text-air-faint">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-bold text-air-text">{value}</dd>
    </div>
  );
}

/** Shown when the server refuses the quiz — locked, out of attempts, unpublished. */
function LockedPanel({ message }: { message: string }) {
  return (
    <div className="air-panel mt-8 rounded-[22px] border p-14 text-center backdrop-blur-md">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-air-line/30 bg-air-line/10">
        <Lock className="h-6 w-6 text-air-faint" aria-hidden />
      </div>
      <h1 className="mt-5 font-display text-[24px] font-extrabold tracking-[-0.02em] text-air-text">
        You can&apos;t open this quiz yet
      </h1>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-air-muted">{message}</p>
      <Link
        href="/dashboard"
        className="mt-7 inline-flex rounded-xl bg-gradient-to-r from-air-signal to-air-signal-bright px-6 py-3 text-[14px] font-bold text-white shadow-[0_0_28px_rgb(var(--air-signal)/0.45)] transition hover:-translate-y-px"
      >
        Back to my journey
      </Link>
    </div>
  );
}

function ResultPanel({ result, onBack }: { result: QuizResult; onBack: () => void }) {
  // A paper with written answers has no score yet — showing one would either
  // be the multiple-choice half masquerading as the total, or a zero.
  if (result.pendingReview) return <PendingPanel result={result} onBack={onBack} />;

  const passed = result.passed;
  const unlocked = result.journey.stages.find((s) => s.slug === result.journey.nextStageSlug);

  return (
    <div className="air-panel mt-8 rounded-[22px] border p-8 text-center backdrop-blur-md sm:p-10">
      <div
        className={cn(
          'mx-auto grid h-16 w-16 place-items-center rounded-full border',
          passed
            ? 'border-air-amber/30 bg-air-amber/10 text-air-amber'
            : 'border-air-live/30 bg-air-live/10 text-air-live',
        )}
      >
        {passed ? (
          <CheckCircle2 className="h-8 w-8" aria-hidden />
        ) : (
          <XCircle className="h-8 w-8" aria-hidden />
        )}
      </div>

      <h1 className="mt-5 font-display text-[30px] font-extrabold leading-tight tracking-[-0.03em] text-air-text">
        {passed ? 'You passed' : 'You did not pass'}
      </h1>

      <p className="mt-2 text-air-muted">
        You scored{' '}
        <span
          className={cn(
            'font-display text-[26px] font-extrabold tracking-[-0.02em]',
            passed ? 'text-air-amber' : 'text-air-live',
          )}
        >
          {result.scorePct}%
        </span>{' '}
        <span className="text-air-faint">({result.pointsEarned} of {result.pointsPossible})</span>
      </p>
      <p className="mt-1 font-mono-ui text-[10.5px] uppercase tracking-[0.12em] text-air-faint">
        Pass mark {result.passThresholdPct}%
      </p>

      {passed && unlocked && (
        <p className="mx-auto mt-6 max-w-md rounded-xl border border-air-amber/25 bg-air-amber/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-air-text">
          <strong className="font-bold text-air-amber">{unlocked.title}</strong> is now unlocked on your
          journey.
        </p>
      )}

      {!passed && (
        <p className="mx-auto mt-6 max-w-md rounded-xl border border-air-amber/25 bg-air-amber/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-air-text">
          Your product knowledge pages are still open to you. Read back through them, then ask your trainer to
          reopen this quiz when you&apos;re ready to try again.
        </p>
      )}

      <button
        onClick={onBack}
        className="mt-7 rounded-xl bg-gradient-to-r from-air-signal to-air-signal-bright px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-px"
      >
        Back to my journey
      </button>
    </div>
  );
}

/**
 * Handed in, not yet marked.
 *
 * Deliberately shows no score and no pass/fail — not even the multiple-choice
 * subtotal. A partial number here would be read as the result, and an agent
 * who scored 60% on the auto-marked half before their written answers are read
 * would think they had failed.
 */
function PendingPanel({ result, onBack }: { result: QuizResult; onBack: () => void }) {
  return (
    <div className="air-panel mt-8 rounded-[22px] border p-10 text-center backdrop-blur-md">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-air-amber/30 bg-air-amber/10">
        <Clock className="h-8 w-8 text-air-amber" aria-hidden />
      </div>

      <h1 className="mt-5 font-display text-[26px] font-extrabold tracking-[-0.02em] text-air-text">Handed in</h1>

      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-air-muted">
        Your paper is with your trainer. {result.awaitingMarks} written{' '}
        {result.awaitingMarks === 1 ? 'answer needs' : 'answers need'} to be read and marked, so your
        result is not ready yet.
      </p>

      <p className="mx-auto mt-5 max-w-md rounded-xl border border-air-signal/25 bg-air-signal/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-air-text">
        You will see your score, and the next stage of your journey, as soon as the marking is done.
        Nothing else is needed from you.
      </p>

      <p className="mt-3 font-mono-ui text-[12px] text-air-faint">Pass mark is {result.passThresholdPct}%.</p>

      <button
        onClick={onBack}
        className="mt-6 rounded-xl bg-gradient-to-r from-air-signal to-air-signal-bright px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-px"
      >
        Back to my journey
      </button>
    </div>
  );
}