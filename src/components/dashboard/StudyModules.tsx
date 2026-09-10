'use client';

/**
 * The always-open product-knowledge modules, drawn as books whose covers swing
 * open on hover.
 *
 * THE FLIP, AND THE BUG THAT USED TO COME WITH IT
 * The 3D open is the point of these cards and it is back. What is not back is
 * the fixed 300px card height it used to need: both layers were absolutely
 * positioned, so nothing in the card established a height and one had to be
 * hard-coded — which clipped the topic chips on the ACA module, the one with
 * the longest topic names.
 *
 * The fix is to leave the *cover* in normal flow so it sizes to its own
 * content, and absolutely position only the inside page behind it. The card is
 * then as tall as the chips need, the two layers still occupy the same box,
 * and the flip is unchanged. `items-stretch` on the grid keeps two modules of
 * different length the same height as each other.
 *
 * Everything a trainee needs to choose a module — title, summary, topics, call
 * to action — is on the cover and readable at rest. The open is a flourish, it
 * never gates information, and it is keyboard-reachable: `.book:focus-visible`
 * opens it too, so tabbing to a module shows the same thing hovering does.
 *
 * The transform itself lives in globals.css (`.book` / `.book-cover`) because
 * Tailwind has no utility that pairs transform-origin with backface-visibility.
 */

import Link from 'next/link';
import type { JourneyStage } from '@/lib/api';
import { productLabel } from '@/lib/labels';
import { stageHref } from './SignalLine';


/**
 * The module cards.
 *
 * `topicsByCampaign` is the real topic list for each guide, fetched from the
 * knowledge endpoint by the caller. It used to be a hardcoded MODULE_COPY here,
 * written by hand "from the module content that already ships in the guides" —
 * a premise that stopped being true the moment that content moved into the
 * admin portal. It had drifted to six invented topic names per campaign against
 * a guide that has eleven and seven, so the card advertised topics that did not
 * exist and a count that was wrong.
 */
export default function StudyModules({
  stages,
  topicsByCampaign = {},
}: {
  stages: JourneyStage[];
  topicsByCampaign?: Record<string, string[]>;
}) {
  return (
    <div className="grid items-stretch gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
      {stages.map((stage, i) => (
        <StudyCard
          key={stage.id}
          stage={stage}
          topics={topicsByCampaign[stage.knowledgeCampaign ?? ''] ?? []}
          delay={i * 90}
        />
      ))}
    </div>
  );
}

function StudyCard({
  stage, topics, delay,
}: {
  stage: JourneyStage;
  /** The guide's real topics. Empty until the fetch lands, or for a campaign with none. */
  topics: string[];
  delay: number;
}) {

  return (
    <Link
      href={stageHref(stage)}
      className="book floor-rise group relative block rounded-[14px]"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* ── inside page, revealed as the cover swings away ── */}
      <div className="air-panel absolute inset-0 flex flex-col justify-center overflow-hidden rounded-[14px] border border-air-amber/30 bg-air-amber/[0.06] p-5 pl-8">
        <span className="book-spine absolute inset-y-0 left-0 w-[6px]" aria-hidden />
        <span className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.18em] text-air-amber">
          {stage.knowledgeCampaign ? productLabel(stage.knowledgeCampaign) : 'Module'} · Reference
        </span>
        <b className="mt-2 block text-[20px] font-bold tracking-[-0.02em] text-air-text">
          {stage.title}
        </b>
        <span className="mt-3 inline-flex items-center gap-2 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-amber">
          Open module
          <ArrowIcon className="h-[13px] w-[13px]" />
        </span>
      </div>

      {/* ── cover: carries every piece of real content, and sets the height ── */}
      {/* `air-hairline` for the rule rather than `air-panel`: the panel class
            would also set a translucent background, and the cover has to stay
            opaque or the inside page smears through its own text. globals.css
            gives `.book-cover` that opaque fill. */}
        <div className="book-cover air-hairline relative z-10 flex h-full flex-col rounded-[14px] border p-5 shadow-[var(--air-shadow)]">
        <span
          className="absolute inset-y-0 left-0 w-[4px] rounded-l-[14px] bg-gradient-to-b from-air-amber to-air-amber/40 opacity-70"
          aria-hidden
        />

        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="floor-sunken grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-air-signal transition-transform duration-200 group-hover:-rotate-6">
            <ModuleIcon kind={stage.kind} className="h-[17px] w-[17px]" />
          </span>
          <span className="font-mono-ui text-[10.5px] uppercase tracking-[0.11em] text-air-faint">
            {topics.length ? `${topics.length} topics` : 'Always open'}
          </span>
        </div>

        <h3 className="mb-2 text-[16.5px] font-bold tracking-[-0.008em] text-air-text">
          {stage.title}
        </h3>
        <p className="mb-4 max-w-[56ch] text-[14px] leading-relaxed text-air-muted">
          {stage.description}
        </p>

        {topics.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {topics.map((topic) => (
              <span
                key={topic}
                className="floor-sunken rounded-[8px] px-[9px] py-1 font-mono-ui text-[9.5px] uppercase tracking-[0.08em] text-air-muted"
              >
                {topic}
              </span>
            ))}
          </div>
        )}

        <span className="mt-auto inline-flex items-center gap-2 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-signal">
          Open module
          <ArrowIcon className="h-[13px] w-[13px] transition-transform duration-150 group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  );
}

function ModuleIcon({ kind, className }: { kind: JourneyStage['kind']; className?: string }) {
  if (kind === 'CLIPS_LIBRARY') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
