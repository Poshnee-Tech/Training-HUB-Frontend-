'use client';

/**
 * The shell every product-knowledge guide is built on.
 *
 * ACA and Medicare are a matched pair by design — the same directory listing,
 * the same one-screen-per-topic reading, the same three-question Quick Check
 * at the bottom of each screen. That shell lives here so the pair cannot
 * drift: a guide supplies its content (sections, quizzes, topic bodies) and
 * nothing else. Adding a product means adding content, not a second layout.
 *
 * NAVIGATION. The guide is a directory, not a scroll: the landing screen is a
 * one-row-per-topic listing, and picking a row opens that topic on its own
 * screen with a way back. Quick Check answers are local UI state — a
 * self-test, nothing is submitted.
 *
 * FRONTEND ONLY. The single server call is the knowledge fetch, which marks
 * the campaign's knowledge stage as visited on the journey map and carries
 * back the narration the admin portal publishes. The written content stays
 * code-maintained, so a failed fetch costs the recordings and nothing else.
 *
 * PALETTE. The `--pk-*` "signal board" tokens in globals.css, scoped to the
 * `.pk-guide` wrapper rendered here. Nothing in this file or in a guide built
 * on it should hardcode a colour.
 */

import {
  createContext, useContext, useEffect, useState,
  type ComponentType, type ReactNode,
} from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, CircleX, ClipboardCheck,
  FileText, Headphones, Info, type LucideIcon,
  NotebookPen,
} from 'lucide-react';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { AudioNote } from '@/components/knowledge/AudioNote';
import Markdown from '@/components/knowledge/Markdown';
import { useAuthStore } from '@/store/auth.store';
import { journey as journeyApi, type KnowledgeArticle, type KnowledgeRecording } from '@/lib/api';
import { iconFor } from './icons';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────

/** One Quick Check question. `why` is shown once answered, right or wrong. */
export type Question = { q: string; opts: string[]; correct: number; why: string };

/**
 * One row of the listing, and one screen when opened. `blurb` says what the
 * topic answers so a row can be picked without opening it first. Narration and
 * the Quick Check are both admin-owned and arrive from the API.
 */
export type GuideSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
};

/** Answers given so far, by section and question index. */
type AnswerMap = Record<string, Record<number, number>>;

// ── Narration ───────────────────────────────────────────────

/**
 * Admin-published narration, grouped by the section each recording is pinned
 * to. A section can carry as many recordings as an admin adds — they stack in
 * the topic screen, in the order the admin portal lists them.
 *
 * A context rather than props because a guide's players can sit two and three
 * levels down (topic screens, and sub-parts inside one of them — the ACA
 * script screen has three).
 */
const NarrationContext = createContext<Record<string, KnowledgeRecording[]>>({});

/**
 * Admin-authored text, keyed the same way narration is.
 *
 * The guides are code-maintained components, so this is additive: a topic
 * always renders its built-in body, and anything an admin has written for that
 * topic reads underneath it. That is what makes the portal's editor real —
 * before this the payload's articles were fetched and dropped.
 */
const ArticleContext = createContext<Record<string, KnowledgeArticle[]>>({});

/**
 * The blocks of the topic currently on screen, by kind.
 *
 * Scoped to the open topic rather than the whole guide so a screen component
 * asks for "my tiers" and cannot accidentally read another topic's.
 */
const BlockContext = createContext<Record<string, Record<string, unknown>[]>>({});

/**
 * One shape's items on the open screen, in admin order.
 *
 * Returns [] for a kind with nothing behind it — an admin who deleted every
 * carrier gets an empty grid, not a crash, and the panel around it still reads.
 */
export function useBlocks<T = Record<string, unknown>>(kind: string): T[] {
  return (useContext(BlockContext)[kind] ?? []) as T[];
}

/** Articles pinned to a topic, in admin order. */
export function useArticles(sectionKey: string): KnowledgeArticle[] {
  return useContext(ArticleContext)[sectionKey] ?? [];
}

/** Recordings pinned to a section key, in admin order. */
export function useRecordings(sectionKey: string): KnowledgeRecording[] {
  return useContext(NarrationContext)[sectionKey] ?? [];
}

// ── Scoring ─────────────────────────────────────────────────

function isComplete(id: string, quizzes: Record<string, Question[]>, answers: AnswerMap) {
  // A topic with no questions is not "complete" — it has nothing to complete,
  // and counting it as done would inflate the guide's progress line.
  const total = (quizzes[id] ?? []).length;
  return total > 0 && Object.keys(answers[id] ?? {}).length === total;
}

function scoreOf(id: string, quizzes: Record<string, Question[]>, answers: AnswerMap) {
  const given = answers[id] ?? {};
  return (quizzes[id] ?? []).reduce((n, q, i) => n + (given[i] === q.correct ? 1 : 0), 0);
}

// ── The guide ───────────────────────────────────────────────

export function KnowledgeGuide({
  campaign, header, listing, bodies,
}: {
  campaign: 'ACA' | 'MEDICARE';
  header: { icon: LucideIcon; title: string; tagline: string };
  listing: { title: string; sub: string };

  /** The screen each section opens, by section id. */
  bodies: Record<string, ComponentType>;
}) {
  const { token, loadFromStorage } = useAuthStore();

  // `open` is the topic on screen; null is the listing.
  const [open, setOpen] = useState<string | null>(null);
  // Quick Check answers live here, not in the topic screen, so they survive
  // going back to the listing and opening the topic again.
  const [answers, setAnswers] = useState<AnswerMap>({});

  const [narration, setNarration] = useState<Record<string, KnowledgeRecording[]>>({});
  const [recordings, setRecordings] = useState<KnowledgeRecording[]>([]);
  const [articles, setArticles] = useState<Record<string, KnowledgeArticle[]>>({});
  /** Topics the admin added for this campaign, in their order. */
  const [customSections, setCustomSections] = useState<GuideSection[]>([]);
  /** Built-in topics the admin has taken out of the guide, and renamed ones. */
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [renames, setRenames] = useState<Record<string, string>>({});
  /** Written for the campaign rather than a topic — read from the listing. */
  const [looseArticles, setLooseArticles] = useState<KnowledgeArticle[]>([]);
  /**
   * The Quick Check questions, by topic.
   *
   * These were a compile-time constant until they moved into the admin portal.
   * Empty until the fetch lands, which is why every reader below tolerates a
   * missing topic rather than indexing straight into it.
   */
  const [quizzes, setQuizzes] = useState<Record<string, Question[]>>({});
  /** Every topic's screen, by topic then kind. */
  const [blocks, setBlocks] = useState<Record<string, Record<string, Record<string, unknown>[]>>>({});
  /** The topic list itself: label, blurb, icon and order, all admin-owned. */
  const [topics, setTopics] = useState<
    { key: string; label: string; blurb: string | null; icon: string | null; sortOrder: number }[]
  >([]);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (!token) return;
    journeyApi
      .knowledge(token, campaign)
      .then((res) => {
        // An admin-added topic has no screen in code, so it becomes a section
        // whose whole content is whatever is pinned to it.
        const custom: GuideSection[] = (res.data.sections ?? []).map((s) => ({
          id: s.key,
          label: s.label,
          icon: NotebookPen,
          blurb: 'Added by your trainer.',
        }));
        setQuizzes(res.data.quickChecks ?? {});
        setBlocks(res.data.blocks ?? {});
        setTopics(res.data.topics ?? []);
        setCustomSections(custom);
        setHiddenKeys(new Set(res.data.hiddenSections ?? []));
        setRenames(res.data.renamedSections ?? {});

        // Every key the payload knows about: topics, admin-added ones, and the
        // narration slots inside a screen (a script part pins its own clip).
        const partKeys = Object.values(res.data.blocks ?? {}).flatMap((kinds) =>
          ((kinds['script-part'] ?? []) as { key?: string }[]).map((p) => `script-${p.key}`),
        );
        const keys = new Set([
          ...(res.data.topics ?? []).map((t) => t.key),
          ...custom.map((s) => s.id),
          ...partKeys,
        ]);
        const byKey: Record<string, KnowledgeRecording[]> = {};
        for (const rec of res.data.recordings ?? []) {
          // The server returns recordings sorted (sortOrder, created), so
          // appending keeps each section's stack in the admin portal's order.
          if (rec.sectionKey && keys.has(rec.sectionKey)) {
            (byKey[rec.sectionKey] ??= []).push(rec);
          }
        }
        setRecordings(res.data.recordings ?? []);
        setNarration(byKey);

        // Same split for text: pinned to a topic it reads there, otherwise it
        // belongs to the campaign and reads on the listing.
        const articlesByKey: Record<string, KnowledgeArticle[]> = {};
        const loose: KnowledgeArticle[] = [];
        for (const article of res.data.articles ?? []) {
          if (article.sectionKey && keys.has(article.sectionKey)) {
            (articlesByKey[article.sectionKey] ??= []).push(article);
          } else {
            loose.push(article);
          }
        }
        setArticles(articlesByKey);
        setLooseArticles(loose);
      })
      .catch(() => {});
    // The section and narration-key lists are module constants in every guide,
    // so the fetch is keyed on the campaign and the session, as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, campaign]);

  /**
   * Built-in topics first, then the admin's. A custom topic with nothing in it
   * is dropped rather than shown as an empty screen — the admin creates the
   * topic before filling it, and a trainee should not see the gap between.
   */
  /**
   * The topic list, admin-owned.
   *
   * `topics` from the API is the source: label, blurb, icon and order all come
   * from the portal. The guide's own `sections` prop is the fallback for the
   * first paint before the fetch lands, and it supplies the screen component
   * for each key — which is the only thing left in code.
   */
  const listed = topics
        .filter((t) => !hiddenKeys.has(t.key))
        .map((t) => ({
          id: t.key,
          label: renames[t.key] ?? t.label,
          blurb: t.blurb ?? '',
          icon: iconFor(t.icon),
        }));

  const allSections = [
    ...listed,
    // A topic an admin ADDED has no screen in code, so it appears only once it
    // has something to show.
    ...customSections.filter(
      (c) =>
        !listed.some((l) => l.id === c.id) &&
        (articles[c.id]?.length ?? 0) + (narration[c.id]?.length ?? 0) + (blocks[c.id] ? 1 : 0) > 0,
    ),
  ];

  const section = allSections.find((s) => s.id === open) ?? null;

  function goTo(id: string | null) {
    setOpen(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function answer(sectionId: string, qIndex: number, optIndex: number) {
    setAnswers((prev) => {
      // First answer stands — this is a check, not a retry loop.
      if (prev[sectionId]?.[qIndex] !== undefined) return prev;
      return { ...prev, [sectionId]: { ...prev[sectionId], [qIndex]: optIndex } };
    });
  }

  /**
   * Narration keys that belong to a topic without being one.
   *
   * A script part pins its own clip under `script-<key>`, so those keys have a
   * player even though they never appear in the listing. Derived from the
   * blocks rather than declared per guide — adding a fourth script part in the
   * admin portal gives it narration with no code change.
   */
  const partKeysBySection: Record<string, string[]> = {};
  for (const [sectionId, kinds] of Object.entries(blocks)) {
    const parts = (kinds['script-part'] ?? []) as { key?: string }[];
    if (parts.length) partKeysBySection[sectionId] = parts.map((p) => `script-${p.key}`);
  }
  const extraNarrationKeys = Object.values(partKeysBySection).flat();

  /** Topics with no clip of their own show no clip count rather than "0 clips". */
  function clipsFor(sectionId: string) {
    const own = (narration[sectionId] ?? []).length;
    const parts = (partKeysBySection[sectionId] ?? []).reduce(
      (n, key) => n + (narration[key] ?? []).length,
      0,
    );
    return own + parts;
  }

  // Keys this guide has a player for; anything pinned outside them is listed.
  const rendered = new Set([...allSections.map((s) => s.id), ...extraNarrationKeys]);
  const doneCount = allSections.filter((s) => isComplete(s.id, quizzes, answers)).length;

  return (
    <TrainingFloorShell>
      <NarrationContext.Provider value={narration}>
        <ArticleContext.Provider value={articles}>
        <div className="pk-guide w-full px-5 pb-24 sm:px-8 xl:px-12">
          <GuideHeader {...header} />

          {section ? (
            <TopicScreen
              key={section.id}
              section={section}
              index={allSections.findIndex((s) => s.id === section.id)}
              total={allSections.length}
              body={bodies[section.id]}
              blocks={blocks[section.id] ?? {}}
              questions={quizzes[section.id] ?? []}
              answers={answers[section.id] ?? {}}
              onAnswer={(qi, oi) => answer(section.id, qi, oi)}
              onBack={() => goTo(null)}
            />
          ) : (
            <Listing
              articles={looseArticles}
              sections={allSections}
              quizzes={quizzes}
              answers={answers}
              doneCount={doneCount}
              listing={listing}
              clipsFor={clipsFor}
              onOpen={goTo}
              recordings={recordings.filter((r) => !r.sectionKey || !rendered.has(r.sectionKey))}
            />
          )}
        </div>
        </ArticleContext.Provider>
      </NarrationContext.Provider>
    </TrainingFloorShell>
  );
}

// ── page head ───────────────────────────────────────────────

function GuideHeader({ icon: Icon, title, tagline }: { icon: LucideIcon; title: string; tagline: string }) {
  return (
    <header className="pt-8">
      <div className="flex items-start gap-3.5">
        <span
          className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border"
          style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)', color: 'rgb(var(--pk-brand))' }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="flex flex-wrap items-center gap-3 font-display text-[29px] font-semibold leading-tight tracking-[-0.01em] text-air-text">
            {title}
            <span
              className="inline-flex items-center gap-[7px] rounded-full border px-2.5 py-1 font-mono-ui text-[10.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ background: 'var(--pk-gold-soft)', borderColor: 'var(--pk-gold-line)', color: 'rgb(var(--pk-gold))' }}
            >
              <span className="pk-pulse h-[7px] w-[7px] rounded-full" style={{ background: 'rgb(var(--pk-gold))' }} />
              Always open
            </span>
          </h1>
          <p className="mt-1.5 text-air-muted">{tagline}</p>
        </div>
      </div>

      <div
        className="mt-4 flex items-center gap-2.5 rounded-[10px] border px-4 py-3 text-[13.5px]"
        style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)' }}
      >
        <Info className="h-4 w-4 shrink-0" style={{ color: 'rgb(var(--pk-brand))' }} />
        <span className="text-air-text">
          Read this any time — before, during or after your quizzes. Nothing here is locked.
        </span>
      </div>
    </header>
  );
}

// ── listing ─────────────────────────────────────────────────

function Listing({
  sections, quizzes, answers, doneCount, listing, clipsFor, onOpen, recordings, articles,
}: {
  sections: GuideSection[];
  quizzes: Record<string, Question[]>;
  answers: AnswerMap;
  doneCount: number;
  listing: { title: string; sub: string };
  clipsFor: (sectionId: string) => number;
  onOpen: (id: string) => void;
  /** Admin recordings with no topic of their own (no pin, or a pin this guide no longer renders). */
  recordings: KnowledgeRecording[];
  /** Admin text written for the campaign rather than for one topic. */
  articles: KnowledgeArticle[];
}) {
  return (
    <section className="pt-7">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <Eyebrow>Topics</Eyebrow>
          <h2 className="font-display text-[23px] font-semibold leading-tight tracking-[-0.01em] text-air-text">
            {listing.title}
          </h2>
          <p className="mt-1 max-w-[60ch] text-air-muted">{listing.sub}</p>
        </div>
        <span className="font-mono-ui text-[11.5px] uppercase tracking-[0.12em] text-air-faint">
          {doneCount} of {sections.length} quick checks done
        </span>
      </div>

      <div className="air-hairline border-t">
        {sections.map((s) => {
          const done = isComplete(s.id, quizzes, answers);
          const started = Object.keys(answers[s.id] ?? {}).length > 0;
          const clips = clipsFor(s.id);

          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.id)}
              className="air-hairline group flex w-full items-center gap-4 border-b py-4 pl-1.5 pr-1.5 text-left transition-[padding,background-color] duration-200 hover:bg-[rgb(var(--air-line)/0.07)] hover:pl-3.5"
            >
              <span
                className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] border transition-colors"
                style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)', color: 'rgb(var(--pk-brand))' }}
              >
                <s.icon className="h-[18px] w-[18px]" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <b className="font-display text-[15.5px] font-semibold text-air-text">{s.label}</b>
                  {done && (
                    <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'rgb(var(--pk-gold))' }} aria-hidden />
                  )}
                </span>
                <span className="mt-0.5 flex items-baseline gap-1.5 text-[12.5px] leading-[1.45] text-air-muted">
                  {clips > 0 && (
                    <>
                      <span
                        className="inline-flex shrink-0 items-center gap-1 font-mono-ui text-[11px]"
                        style={{ color: 'rgb(var(--pk-gold))' }}
                      >
                        <Headphones className="h-3 w-3 self-center" />
                        {clips === 1 ? '1 clip' : `${clips} clips`}
                      </span>
                      <span className="text-air-faint">·</span>
                    </>
                  )}
                  <span className="min-w-0">{s.blurb}</span>
                </span>
              </span>

              {(done || started) && (
                <span
                  className="hidden shrink-0 rounded-full border px-2.5 py-1 font-mono-ui text-[11px] sm:block"
                  style={
                    done
                      ? { background: 'var(--pk-gold-soft)', borderColor: 'var(--pk-gold-line)', color: 'rgb(var(--pk-gold))' }
                      : { borderColor: 'rgb(var(--air-line) / 0.25)', color: 'rgb(var(--air-faint))' }
                  }
                >
                  {done ? `Quick check ${scoreOf(s.id, quizzes, answers)}/${quizzes[s.id].length}` : `In progress`}
                </span>
              )}

              <span
                className="hidden shrink-0 items-center gap-1.5 font-mono-ui text-[12px] font-semibold sm:flex"
                style={{ color: 'rgb(var(--pk-gold))' }}
              >
                Want to learn more
                <ArrowRight className="h-[14px] w-[14px] transition-transform duration-200 group-hover:translate-x-1" />
              </span>
              <ArrowRight className="h-[15px] w-[15px] shrink-0 sm:hidden" style={{ color: 'rgb(var(--pk-gold))' }} />
            </button>
          );
        })}
      </div>

      {recordings.length > 0 && (
        <section className="mt-8">
          <div className="mb-3">
            <Eyebrow>Recordings</Eyebrow>
            <h2 className="font-display text-[21px] font-semibold leading-tight tracking-[-0.01em] text-air-text">
              Extra narration
            </h2>
            <p className="mt-1 max-w-[60ch] text-air-muted">
              Added by your trainer. Listen any time — these sit alongside the topic clips.
            </p>
          </div>
          <div className="space-y-3">
            {recordings.map((rec) => (
              <AudioNote
                key={rec.id}
                src={journeyApi.recordingMediaUrl(rec.id)}
                title={rec.title || 'Narration'}
                durationSeconds={rec.durationSeconds}
              />
            ))}
          </div>
        </section>
      )}

      <TrainerNotes articles={articles} />
    </section>
  );
}

/**
 * Text an admin has written for one topic.
 *
 * Rendered as its own panel rather than merged into the guide's prose so a
 * trainee can see at a glance which part is the standing material and which
 * part their trainer added, and so a half-finished article can never make the
 * built-in body look broken.
 */
function TrainerNotes({ articles }: { articles: KnowledgeArticle[] }) {
  if (articles.length === 0) return null;

  return (
    <section className="mt-8 space-y-4">
      <div>
        <Eyebrow>From your trainer</Eyebrow>
        <h2 className="font-display text-[21px] font-semibold leading-tight tracking-[-0.01em] text-air-text">
          {articles.length === 1 ? 'Added note' : 'Added notes'}
        </h2>
      </div>

      {articles.map((article) => (
        <article
          key={article.id}
          className="air-panel rounded-[18px] border border-air-line/25 p-5 backdrop-blur-md"
        >
          <h3 className="font-display text-[17px] font-bold tracking-[-0.015em] text-air-text">
            {article.title}
          </h3>
          {article.summary && (
            <p className="mt-1 text-[13px] leading-relaxed text-air-faint">{article.summary}</p>
          )}
          <div className="mt-3">
            <Markdown source={article.bodyMarkdown} />
          </div>
        </article>
      ))}
    </section>
  );
}

// ── topic screen ────────────────────────────────────────────

function TopicScreen({
  section, index, total, body: Body, blocks, questions, answers, onAnswer, onBack,
}: {
  section: GuideSection;
  index: number;
  total: number;
  /** Absent on admin-added topics, which have no screen in code. */
  body?: ComponentType;
  /** This topic's screen content, by kind. The body reads it via useBlocks(). */
  blocks: Record<string, Record<string, unknown>[]>;
  questions: Question[];
  answers: Record<number, number>;
  onAnswer: (qIndex: number, optIndex: number) => void;
  onBack: () => void;
}) {
  // Every recording pinned to this topic plays here, in admin order. There is
  // no bundled fallback any more: if a trainer removes the clip, the topic has
  // no narration, which is what removing it is supposed to mean.
  const pinned = useRecordings(section.id);
  const notes = useArticles(section.id);

  return (
    <div className="pt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="group flex items-center gap-2 text-[13px] font-semibold text-air-muted transition-colors hover:text-air-text"
        >
          <ArrowLeft className="h-[15px] w-[15px] transition-transform duration-200 group-hover:-translate-x-1" />
          All topics
        </button>
        <span className="font-mono-ui text-[11px] uppercase tracking-[0.12em] text-air-faint">
          Topic {index + 1} of {total} · {section.label}
        </span>
      </div>

      {pinned.length > 0 && (
        <div className="mb-5 space-y-3">
          {pinned.map((rec) => (
            <AudioNote
              key={rec.id}
              src={journeyApi.recordingMediaUrl(rec.id)}
              title={rec.title || `Listen: ${section.label}`}
              durationSeconds={rec.durationSeconds}
            />
          ))}
        </div>
      )}

      {Body && (
        <section className="relative">
          <BlockContext.Provider value={blocks}>
            <Body />
          </BlockContext.Provider>
        </section>
      )}

      <TrainerNotes articles={notes} />

      <QuickCheck questions={questions} answers={answers} onAnswer={onAnswer} />

      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={onBack}
          className="air-panel rounded-full border px-4 py-2 text-[13px] font-semibold text-air-muted transition-colors hover:text-air-text"
        >
          Back to all topics
        </button>
      </div>
    </div>
  );
}

// ── quick check ─────────────────────────────────────────────

/**
 * The topic's self-test. Collapsed by default so the reference material is
 * what the screen opens on; answers are final once given, and the score row
 * appears only when all of them are in.
 */
function QuickCheck({
  questions, answers, onAnswer,
}: {
  questions: Question[];
  answers: Record<number, number>;
  onAnswer: (qIndex: number, optIndex: number) => void;
}) {
  const answered = Object.keys(answers).length;
  const complete = answered === questions.length;
  const score = questions.reduce((n, q, i) => n + (answers[i] === q.correct ? 1 : 0), 0);
  const [open, setOpen] = useState(false);

  return (
    <div
      className="mt-8 overflow-hidden rounded-[14px] border"
      style={{ background: 'var(--pk-rust-soft)', borderColor: 'var(--pk-brand-line)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px]"
          style={
            complete
              ? { background: 'rgb(var(--pk-gold))', color: 'rgb(var(--air-bg))' }
              : { background: 'rgb(var(--pk-brand))', color: 'rgb(var(--air-bg))' }
          }
        >
          {complete ? <Check className="h-[17px] w-[17px]" strokeWidth={3} /> : <ClipboardCheck className="h-[17px] w-[17px]" />}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block font-display text-[16px] font-semibold text-air-text">
            Quick Check · {questions.length} questions
          </b>
          <small className="block text-[12.5px] text-air-muted">
            {complete
              ? `Answered. You scored ${score} of ${questions.length}.`
              : answered > 0
                ? `${answered} of ${questions.length} answered.`
                : 'Check yourself on this topic. Nothing is submitted.'}
          </small>
        </span>
        <ChevronDown
          className={cn('h-[18px] w-[18px] shrink-0 transition-transform duration-300', open && 'rotate-180')}
          style={{ color: 'rgb(var(--pk-brand))' }}
        />
      </button>

      {open && (
        <div className="px-5 pb-5">
          {questions.map((q, qi) => {
            const given = answers[qi];
            const isAnswered = given !== undefined;

            return (
              <div key={q.q} className="air-panel mt-3 rounded-[12px] border p-4 first:mt-0">
                <p className="mb-3 flex gap-2.5 font-display text-[14.5px] font-semibold text-air-text">
                  <span className="font-mono-ui text-[13px]" style={{ color: 'rgb(var(--pk-gold))' }}>
                    {qi + 1}.
                  </span>
                  {q.q}
                </p>

                <div className="grid gap-1.5">
                  {q.opts.map((opt, oi) => {
                    const right = oi === q.correct;
                    const picked = given === oi;
                    const show = isAnswered && (right || picked);

                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={isAnswered}
                        onClick={() => onAnswer(qi, oi)}
                        className={cn(
                          'flex items-center gap-2.5 rounded-[9px] border px-3 py-2.5 text-left text-[13px] transition-colors',
                          !isAnswered && 'hover:bg-[rgb(var(--air-line)/0.08)]',
                          isAnswered && !show && 'opacity-60',
                        )}
                        style={
                          show && right
                            ? { background: 'var(--pk-ok-soft)', borderColor: 'rgb(var(--pk-ok) / 0.45)', color: 'rgb(var(--pk-ok))' }
                            : show
                              ? { background: 'var(--pk-stop-soft)', borderColor: 'rgb(var(--pk-stop) / 0.45)', color: 'rgb(var(--pk-stop))' }
                              : { borderColor: 'rgb(var(--air-line) / 0.22)' }
                        }
                      >
                        <span
                          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border font-mono-ui text-[10px]"
                          style={{ borderColor: 'currentColor' }}
                        >
                          {show && right ? <Check className="h-[11px] w-[11px]" strokeWidth={3} />
                            : show ? <CircleX className="h-[11px] w-[11px]" />
                              : String.fromCharCode(65 + oi)}
                        </span>
                        <span className={cn(!show && 'text-air-text')}>{opt}</span>
                      </button>
                    );
                  })}
                </div>

                {isAnswered && (
                  <p className="mt-2.5 flex gap-2 text-[12.5px] text-air-muted">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'rgb(var(--pk-brand))' }} />
                    <span>
                      <b className="font-semibold" style={{ color: given === q.correct ? 'rgb(var(--pk-ok))' : 'rgb(var(--pk-stop))' }}>
                        {given === q.correct ? 'Correct. ' : 'Not quite. '}
                      </b>
                      {q.why}
                    </span>
                  </p>
                )}
              </div>
            );
          })}

          {complete && (
            <div
              className="mt-3.5 flex items-center justify-between rounded-[10px] px-4 py-3"
              style={{ background: 'var(--pk-band)' }}
            >
              <span className="font-mono-ui text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--pk-band-sub)' }}>
                Quick check score
              </span>
              <b className="font-display text-[18px] font-semibold" style={{ color: 'var(--pk-band-gold)' }}>
                {score} / {questions.length}
              </b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── shared pieces ───────────────────────────────────────────

/** The rule-and-caps label above every heading. `onBand` is the dark-band variant. */
export function Eyebrow({ children, onBand }: { children: ReactNode; onBand?: boolean }) {
  return (
    <p
      className="mb-1.5 flex items-center gap-2 font-mono-ui text-[11px] font-semibold uppercase tracking-[0.16em]"
      style={{ color: onBand ? 'var(--pk-band-gold)' : 'rgb(var(--pk-gold))' }}
    >
      <span
        className="h-0.5 w-[18px] rounded-sm"
        style={{ background: `linear-gradient(90deg, ${onBand ? 'var(--pk-band-gold)' : 'rgb(var(--pk-gold))'}, transparent)` }}
      />
      {children}
    </p>
  );
}

/** Small caps label used inside a dark feature band. */
export function BandLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('font-mono-ui text-[10.5px] uppercase tracking-[0.16em]', className)} style={{ color: 'var(--pk-band-gold)' }}>
      {children}
    </p>
  );
}

/** The heading a topic body opens with. */
export function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-display text-[23px] font-semibold leading-tight tracking-[-0.01em] text-air-text">{title}</h2>
      {sub && <p className="mt-1 max-w-[60ch] text-air-muted">{sub}</p>}
    </div>
  );
}

/**
 * The collapsible one-page recap every guide closes on. Term/definition pairs,
 * open by default — it is the screen an agent opens right before a call.
 */
export function CheatSheet({
  title, sub, rows, icon: Icon = FileText,
}: {
  title: string;
  sub: string;
  rows: [string, string][];
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className="overflow-hidden rounded-[14px] border"
      style={{ background: 'var(--pk-rust-soft)', borderColor: 'var(--pk-brand-line)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px]"
          style={{ background: 'rgb(var(--pk-brand))', color: 'rgb(var(--air-bg))' }}
        >
          <Icon className="h-[17px] w-[17px]" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block font-display text-[16px] font-semibold text-air-text">{title}</b>
          <small className="block text-[12.5px] text-air-muted">{sub}</small>
        </span>
        <ChevronDown
          className={cn('h-[18px] w-[18px] shrink-0 transition-transform duration-300', open && 'rotate-180')}
          style={{ color: 'rgb(var(--pk-brand))' }}
        />
      </button>

      <div className="overflow-hidden transition-all duration-300" style={{ maxHeight: open ? 700 : 0 }}>
        <div className="grid gap-x-6 px-5 pb-5 sm:grid-cols-2">
          {rows.map(([term, def]) => (
            <div
              key={term}
              className="border-t py-2 text-[13px] text-air-muted"
              style={{ borderColor: 'var(--pk-brand-line)' }}
            >
              <b className="font-semibold text-air-text">{term}</b>{' '}{def}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
