'use client';

/**
 * ACA Product Knowledge — the agent's reference guide, "signal board" design.
 *
 * Always accessible, never gated. Content is code-maintained so the page can
 * use a rich, interactive layout (concept chain, plan-tier meters, expandable
 * essential benefits, call-script decision tree, capture checklist) rather
 * than a flat article dump.
 *
 * Built on GuideKit, which owns the shell every product-knowledge guide
 * shares: the directory listing, the topic screens, the narration players and
 * the three-question Quick Check under each screen. This file is content and
 * topic bodies — the pieces that are actually ACA.
 *
 * Two hues carry the whole page: coffee/structure and honey/energy, defined as
 * `--pk-*` in globals.css so the design lands as drawn in the bright theme and
 * resolves to console equivalents in dark. Nothing here hardcodes a hex except
 * the tier metals, which are meant to look like metal.
 */

import { useState } from 'react';
import {
  Ban, BarChart3, BookMarked, Check, ChevronDown, CircleX, Info, Landmark, PhoneCall, Quote,
} from 'lucide-react';
import { AudioNote } from '@/components/knowledge/AudioNote';
import {
  CheatSheet, Eyebrow, BandLabel, KnowledgeGuide, SectionHead, useRecordings, useBlocks,
} from '@/components/knowledge/GuideKit';
import {
  journey as journeyApi,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { iconFor } from './icons';

// ── Content ─────────────────────────────────────────────────
















const BODIES: Record<string, React.ComponentType> = {
  basics: BasicsBody,
  foundations: FoundationsBody,
  carriers: CarriersBody,
  eligibility: EligibilityBody,
  tiers: TiersBody,
  benefits: BenefitsBody,
  addons: AddonsBody,
  programs: ProgramsBody,
  script: ScriptBody,
  capture: CaptureBody,
  cheat: CheatBody,
};

export default function AcaKnowledgeGuide() {
  return (
    <KnowledgeGuide
      campaign="ACA"
      header={{
        icon: BookMarked,
        title: 'ACA Product Knowledge',
        tagline: 'Everything you need to know about ACA coverage.',
      }}
      listing={{
        title: 'One screen per topic',
        sub: 'Every topic opens with its narration — listen or read, then take the three-question Quick Check at the bottom.',
      }}
      bodies={BODIES}
    />
  );
}

/** Resolves a block's icon name to a component; unknown names fall back. */
function IconOf({ item, ...rest }: { item: { icon?: string }; className?: string; style?: React.CSSProperties }) {
  const Glyph = iconFor(item.icon);
  return <Glyph {...rest} />;
}

/**
 * The screen's heading, from the admin's `heading` block.
 *
 * Renders nothing when there is none — a topic whose heading an admin cleared
 * should lose the heading, not fall back to wording they cannot see or edit.
 */
function BlockHead() {
  const [head] = useBlocks<{ eyebrow?: string; title: string; sub?: string }>('heading');
  if (!head) return null;
  return <SectionHead eyebrow={head.eyebrow ?? ''} title={head.title} sub={head.sub} />;
}

// ── topic bodies ────────────────────────────────────────────

function BasicsBody() {
  const facts = useBlocks<{ icon?: string; label: string; sub?: string }>('fact');
  const provides = useBlocks<{ text: string }>('chip');
  return (
    <div
      className="relative overflow-hidden rounded-[20px] px-8 py-7 shadow-[var(--air-shadow-lg)]"
      style={{ background: 'var(--pk-hero)' }}
    >
      <span
        className="pointer-events-none absolute -bottom-[130px] -left-[90px] h-[330px] w-[330px] rounded-full border-[1.5px]"
        style={{ borderColor: 'rgb(var(--pk-gold) / 0.16)' }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -right-10 -top-10 h-[260px] w-[260px] rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgb(var(--pk-gold) / .22), transparent 70%)' }}
        aria-hidden
      />
      <Landmark
        className="pointer-events-none absolute right-7 top-6 h-[72px] w-[72px] opacity-[0.14]"
        style={{ color: 'var(--pk-band-ink)' }}
        aria-hidden
      />

      <Eyebrow onBand>The basics</Eyebrow>
      <h2 className="mb-2.5 font-display text-[26px] font-semibold" style={{ color: 'var(--pk-band-ink)' }}>
        What is ACA?
      </h2>
      <p className="max-w-[64ch] leading-relaxed" style={{ color: 'var(--pk-band-sub)' }}>
        ACA stands for the{' '}
        <b className="font-semibold" style={{ color: 'var(--pk-band-ink)' }}>Affordable Care Act</b> — a federal
        program offering low-cost health insurance to people with low income, helping them save on medical
        expenses. Signed into law in 2010, provided through the Healthcare Marketplace, and also known as
        Obamacare.
      </p>

      <BandLabel className="mb-2.5 mt-6">Key facts</BandLabel>
      <div className="grid gap-3 sm:grid-cols-3">
        {facts.map((f) => (
          <div
            key={f.label}
            className="flex items-start gap-3 rounded-[10px] border p-3.5"
            style={{ background: 'rgb(255 255 255 / 0.06)', borderColor: 'rgb(255 255 255 / 0.12)' }}
          >
            <IconOf item={f} className="mt-px h-[18px] w-[18px] shrink-0" style={{ color: 'var(--pk-band-gold)' }} />
            <div>
              <b className="font-display text-[14.5px] font-semibold" style={{ color: 'var(--pk-band-ink)' }}>
                {f.label}
              </b>
              <small className="mt-0.5 block text-[12px]" style={{ color: 'var(--pk-band-sub)' }}>
                {f.sub}
              </small>
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-5 flex flex-wrap items-center gap-2 border-t pt-[18px]"
        style={{ borderColor: 'rgb(255 255 255 / 0.12)' }}
      >
        <BandLabel className="mr-1">Provides</BandLabel>
        {provides.map((p) => (
          <span
            key={p.text}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12.5px]"
            style={{ background: 'rgb(255 255 255 / 0.08)', borderColor: 'rgb(255 255 255 / 0.14)', color: 'var(--pk-band-ink)' }}
          >
            <Check className="h-3 w-3" style={{ color: 'var(--pk-band-gold)' }} />
            {p.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function FoundationsBody() {
  const concepts = useBlocks<{ n: string; icon?: string; title: string; body: string }>('concept');
  return (
    <>
      <BlockHead />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {concepts.map((c) => (
          <article key={c.n} className="air-panel relative rounded-[14px] border p-4">
            <span className="absolute right-3.5 top-3 font-display text-[15px] font-bold" style={{ color: 'rgb(var(--pk-gold))' }}>
              {c.n}
            </span>
            <span
              className="mb-3 grid h-8 w-8 place-items-center rounded-[9px] border"
              style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)', color: 'rgb(var(--pk-brand))' }}
            >
              <IconOf item={c} className="h-[17px] w-[17px]" />
            </span>
            <h4 className="mb-1.5 font-display text-[15px] font-semibold text-air-text">{c.title}</h4>
            <p className="text-[13px] leading-[1.5] text-air-muted">{c.body}</p>
          </article>
        ))}
      </div>

      <div
        className="mt-3 rounded-[14px] border p-4"
        style={{ background: 'var(--pk-rust-soft)', borderColor: 'var(--pk-rust-line)' }}
      >
        <p className="mb-2.5 font-mono-ui text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgb(var(--pk-rust))' }}>
          How a health plan is built
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <FlowNode>
            Basic Plan <span className="text-air-faint">(Major Health Coverage)</span>
          </FlowNode>
          <span className="font-display font-bold" style={{ color: 'rgb(var(--pk-rust))' }}>+</span>
          <FlowNode>Low-Cost Additional Benefits</FlowNode>
          <span className="font-display font-bold" style={{ color: 'rgb(var(--pk-rust))' }}>+</span>
          <FlowNode>Dental, Hearing &amp; Vision Coverage</FlowNode>
        </div>
        <p className="mt-2.5 text-[12.5px] text-air-muted">
          The care package — grocery card, benefits card, and cashbacks — is part of the additional benefits.
        </p>
      </div>
    </>
  );
}

function CarriersBody() {
  const carriers = useBlocks<{ mono: string; name: string }>('carrier');
  return (
    <>
      <BlockHead />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {carriers.map((c) => (
          <div key={c.name} className="air-panel flex items-center gap-3 rounded-[14px] border p-3.5">
            <span
              className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] border font-mono-ui text-[13px] font-semibold"
              style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)', color: 'rgb(var(--pk-brand))' }}
            >
              {c.mono}
            </span>
            <b className="text-[14.5px] font-semibold text-air-text">{c.name}</b>
          </div>
        ))}
      </div>
    </>
  );
}

function EligibilityBody() {
  const exclusions = useBlocks<{ text: string }>('chip');
  const notes = useBlocks<{ text: string }>('bullet');
  return (
    <>
      <BlockHead />
      <div className="grid gap-3.5 lg:grid-cols-2">
        <div
          className="air-panel rounded-[14px] border p-[18px]"
          style={{ borderColor: 'rgb(var(--pk-ok))', borderTopWidth: 3 }}
        >
          <div className="mb-0.5 flex items-center gap-2.5">
            <span
              className="grid h-[30px] w-[30px] place-items-center rounded-lg"
              style={{ background: 'var(--pk-ok-soft)', color: 'rgb(var(--pk-ok))' }}
            >
              <BarChart3 className="h-[17px] w-[17px]" />
            </span>
            <div>
              <div className="font-mono-ui text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgb(var(--pk-ok))' }}>
                First check
              </div>
              <b className="font-display text-[16px] font-semibold text-air-text">Age range</b>
            </div>
          </div>
          <div className="my-3 font-display text-[40px] font-semibold leading-none tracking-[-0.02em] text-air-text">
            19<span className="mx-1.5 text-[24px] text-air-faint">–</span>64
          </div>
          <ul className="grid gap-2">
            {notes.map((t) => (
              <li key={t.text} className="flex gap-2.5 text-[13px] text-air-muted">
                <Check className="mt-0.5 h-[15px] w-[15px] shrink-0" style={{ color: 'rgb(var(--pk-ok))' }} />
                {t.text}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="air-panel rounded-[14px] border p-[18px]"
          style={{ borderColor: 'rgb(var(--pk-stop))', borderTopWidth: 3 }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-[30px] w-[30px] place-items-center rounded-lg"
              style={{ background: 'var(--pk-stop-soft)', color: 'rgb(var(--pk-stop))' }}
            >
              <CircleX className="h-[17px] w-[17px]" />
            </span>
            <div>
              <div className="font-mono-ui text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgb(var(--pk-stop))' }}>
                Hard exclusion rule
              </div>
              <h4 className="font-display text-[16px] font-semibold text-air-text">No MMVAJPvt</h4>
            </div>
          </div>
          <p className="my-3 text-[13px] text-air-muted">
            MMVAJPvt = Medicare, Medicaid, VA, Job insurance, Pvt — no Private insurance. Must not already have
            major health coverage from:
          </p>
          <div className="flex flex-wrap gap-[7px]">
            {exclusions.map((e) => (
              <span
                key={e.text}
                className="inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[12.5px] font-medium"
                style={{ background: 'var(--pk-stop-soft)', borderColor: 'rgb(var(--pk-stop) / 0.35)', color: 'rgb(var(--pk-stop))' }}
              >
                <Ban className="h-3 w-3" />
                {e.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function TiersBody() {
  const tiers = useBlocks<{ name: string; initial: string; metal: string; pays: number }>('tier');
  return (
    <>
      <BlockHead />
      <div
        className="relative overflow-hidden rounded-[20px] p-[22px] shadow-[var(--air-shadow-lg)]"
        style={{ background: 'var(--pk-band)' }}
      >
        <span
          className="pointer-events-none absolute -right-[60px] -top-[60px] h-[280px] w-[280px] rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgb(var(--pk-gold) / .16), transparent 70%)' }}
          aria-hidden
        />
        <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map((t) => (
            <div
              key={t.name}
              className="rounded-[14px] border p-4"
              style={{ background: 'rgb(255 255 255 / 0.045)', borderColor: 'rgb(255 255 255 / 0.1)' }}
            >
              <div className="flex items-center gap-2 font-display text-[16px] font-semibold" style={{ color: 'var(--pk-band-ink)' }}>
                {t.name}
                <span
                  className="grid h-5 w-5 place-items-center rounded-full font-mono-ui text-[10px] font-semibold text-white"
                  style={{ background: t.metal, boxShadow: '0 0 0 2px rgb(255 255 255 / 0.08)' }}
                >
                  {t.initial}
                </span>
              </div>

              <div className="mb-2 mt-3.5 flex items-baseline justify-between">
                <span className="font-mono-ui text-[9.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--pk-band-sub)' }}>
                  Company pays
                </span>
                <span className="font-display text-[30px] font-semibold leading-none tracking-[-0.02em]" style={{ color: 'var(--pk-band-gold)' }}>
                  {t.pays}%
                </span>
              </div>

              <div className="flex h-2 overflow-hidden rounded-full" style={{ background: 'rgb(255 255 255 / 0.1)' }}>
                <span style={{ width: `${t.pays}%`, background: 'linear-gradient(90deg, rgb(var(--pk-gold)), rgb(var(--pk-gold) / 0.6))' }} />
                <span style={{ width: `${100 - t.pays}%`, background: 'rgb(255 255 255 / 0.07)' }} />
              </div>

              <div className="mt-2.5 flex justify-between text-[11.5px]" style={{ color: 'var(--pk-band-sub)' }}>
                <span>Company <b className="font-semibold" style={{ color: 'var(--pk-band-ink)' }}>{t.pays}%</b></span>
                <span>Consumer <b className="font-semibold" style={{ color: 'var(--pk-band-ink)' }}>{100 - t.pays}%</b></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function BenefitsBody() {
  const benefits = useBlocks<{ icon?: string; title: string; body: string }>('benefit');
  return (
    <>
      <BlockHead />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {benefits.map((b) => (
          <BenefitCard key={b.title} {...b} />
        ))}
      </div>
    </>
  );
}

function AddonsBody() {
  const addons = useBlocks<{ icon?: string; label: string }>('fact');
  return (
    <div
      className="relative overflow-hidden rounded-[20px] px-[26px] py-6 shadow-[var(--air-shadow-lg)]"
      style={{ background: 'linear-gradient(135deg, #EFCE86 0%, #D69A44 48%, #B87A2E 100%)' }}
    >
      <span
        className="pointer-events-none absolute -bottom-10 -right-[30px] h-[220px] w-[220px] rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgb(255 255 255 / .35), transparent 70%)' }}
        aria-hidden
      />
      <p className="mb-1.5 flex items-center gap-2 font-mono-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7A4410]">
        <span className="h-0.5 w-[18px] rounded-sm bg-[#7A4410]" />
        Low-cost add-ons
      </p>
      <h2 className="font-display text-[22px] font-semibold text-[#40260C]">Additional benefits</h2>
      <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-[#5A3A15]">
        Part of the health insurance structure — minor coverage on top of the major health coverage, and strong
        talking points on calls.
      </p>

      <div className="relative mt-[18px] grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {addons.map((a) => (
          <div
            key={a.label}
            className="flex items-center gap-3 rounded-[10px] border border-white/10 bg-[#241205] px-3.5 py-3"
          >
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-[rgb(192_138_62_/_0.24)] text-[#EDC77E]">
              <IconOf item={a} className="h-4 w-4" />
            </span>
            <b className="text-[13.5px] font-semibold text-[#F7E7D2]">{a.label}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgramsBody() {
  const programs = useBlocks<{ icon?: string; name: string; active?: boolean; tags?: string[] }>('program');
  return (
    <>
      <BlockHead />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {programs.map((p) => (
          <article
            key={p.name}
            className="air-panel rounded-[14px] border p-4"
            style={p.active ? { borderColor: 'rgb(var(--pk-brand))', borderTopWidth: 3 } : undefined}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className="grid h-7 w-7 place-items-center rounded-lg"
                style={
                  p.active
                    ? { background: 'rgb(var(--pk-brand))', color: 'rgb(var(--air-bg))' }
                    : { background: 'var(--pk-brand-soft)', color: 'rgb(var(--pk-brand))' }
                }
              >
                <IconOf item={p} className="h-[15px] w-[15px]" />
              </span>
              <h4 className="font-display text-[15px] font-semibold text-air-text">{p.name}</h4>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(p.tags ?? []).map((t) => (
                <span
                  key={t}
                  className="rounded-md border px-2 py-1 text-[11.5px]"
                  style={
                    p.active
                      ? { background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)', color: 'rgb(var(--pk-brand))' }
                      : { background: 'rgb(var(--air-line) / 0.07)', borderColor: 'rgb(var(--air-line) / 0.18)', color: 'rgb(var(--air-muted))' }
                  }
                >
                  {t}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * The ACA call script. Three parts, each with its own narration and its own
 * lines — agent speech is quoted verbatim, and every branch the caller can
 * take is shown where it happens rather than described afterwards.
 */
function ScriptBody() {
  const scriptBenefits = useBlocks<{ text: string }>('chip');
  const scriptParts = useBlocks<{ n: number; key: string; title: string; sub?: string }>('script-part');
  const [opening, insurance, questions] = scriptParts;

  return (
    <>
      <BlockHead />

      {/* ── 1 · opening ─────────────────────────── */}
      <ScriptPart part={opening}>
        <Say>Hi, this is ________, how are you doing today? Doing good?</Say>

        <Fork>
          <ForkCard when="If the customer says “I’m fine”">
            <Say small>Good to hear that.</Say>
            <Say small>Or: That’s great.</Say>
          </ForkCard>
          <ForkCard when="If they ask “how are you?”">
            <Say small>I’m also fine, thanks for asking.</Say>
          </ForkCard>
        </Fork>

        <Say>
          This short call is to make sure that you’re receiving all the updated additional benefits on your
          current health insurance plan. So, do you have an active health insurance right now?
        </Say>
      </ScriptPart>

      {/* ── 2 · insurance ───────────────────────── */}
      <ScriptPart part={insurance}>
        <StepLabel>Answer to “do you have an active health insurance right now?”</StepLabel>

        <Fork>
          <ForkCard when="Customer says YES" tone="ok">
            <Say small>
              That’s great, you may get qualified for some newly updated additional benefits for the year 2026.
            </Say>
          </ForkCard>
          <ForkCard when="Customer says NO" tone="stop">
            <Say small>
              No problem, that’s why we are calling you — we’ll help you with that and provide you low-cost
              health insurance along with additional benefits for the year 2026.
            </Say>
          </ForkCard>
        </Fork>

        <div
          className="mt-3 rounded-[10px] border px-3.5 py-3"
          style={{ background: 'var(--pk-gold-soft)', borderColor: 'var(--pk-gold-line)' }}
        >
          <p className="mb-2 font-mono-ui text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgb(var(--pk-gold))' }}>
            Then name the benefits
          </p>
          <div className="flex flex-wrap gap-1.5">
            {scriptBenefits.map((b) => (
              <span
                key={b.text}
                className="rounded-md border bg-air-panel px-2 py-1 text-[12px] text-air-text"
                style={{ borderColor: 'var(--pk-gold-line)' }}
              >
                {b.text}
              </span>
            ))}
          </div>
        </div>

        <StepLabel className="mt-4">Then ask</StepLabel>
        <Say>So, have you received them or not yet?</Say>

        <Fork>
          <ForkCard when="Customer says YES" tone="ok">
            <Say small>
              That’s great, we’re gonna make sure you are not missing any benefits on your current plan by giving
              you a quick review.
            </Say>
          </ForkCard>
          <ForkCard when="Customer says NO" tone="stop">
            <Say small>
              That’s why we are calling you — we’re gonna help you get qualified for some newly updated benefits
              being offered in your area on your current plan.
            </Say>
          </ForkCard>
        </Fork>

        <StepLabel className="mt-4">Both answers lead to the same two questions</StepLabel>
        <Say>So, what’s the name of your current insurance provider — like Cigna, Aetna, Oscar, Molina?</Say>
        <Say>Is it through the Marketplace?</Say>
      </ScriptPart>

      {/* ── 3 · important questions ─────────────── */}
      <ScriptPart part={questions}>
        <ScriptQ
          n={1}
          q="So, just to check if you qualify — do you have any Medicare, Medicaid, VA, Tricare, job insurance or any private insurance?"
          note="Must be No."
        >
          <Answers yes="If no — say “Perfect.”" no="If yes — ask “which one is it?”" />
        </ScriptQ>

        <ScriptQ n={2} q="And may I know how young are you?" note="Must be between 19 and 64.">
          <Answers yes="If between 19 and 64 — say “that’s great.”" />
        </ScriptQ>

        <ScriptQ
          n={3}
          q="And one last thing from my side — for the mailing purposes, can I have your 5-digit zip code down there?"
        />

        <div
          className="mt-4 rounded-[12px] border p-4"
          style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)' }}
        >
          <p className="mb-2 flex items-center gap-2 font-mono-ui text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgb(var(--pk-brand))' }}>
            <PhoneCall className="h-3 w-3" />
            The transfer
          </p>
          <Say>
            So, everything looks good from my side. Now I’m going to bring in one of our senior verification
            officers on the line. They’ll quickly review which additional benefits you may qualify for and assist
            you further. Is that okay with you?
          </Say>
          <div className="my-2.5">
            <Answers yes="Yes · Ok · Alright" />
          </div>
          <Say>So please stay on the line with me, and here we go.</Say>
        </div>
      </ScriptPart>
    </>
  );
}

/** One numbered part of the script, with its own clip above its lines. */
function ScriptPart({
  part, children,
}: {
  part: { n: number; key: string; title: string; sub?: string }; children: React.ReactNode;
}) {
  // Section keys for the three script clips are prefixed, because `opening`
  // alone would not say which guide it belongs to in the admin portal.
  const pinned = useRecordings(`script-${part.key}`);

  return (
    <div className="air-panel mb-3.5 rounded-[14px] border p-5 last:mb-0">
      <div className="mb-3 flex items-start gap-3">
        <span
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full font-mono-ui text-[13px] font-semibold"
          style={{ background: 'rgb(var(--pk-brand))', color: 'rgb(var(--air-bg))' }}
        >
          {part.n}
        </span>
        <div className="min-w-0">
          <b className="font-display text-[17px] font-semibold text-air-text">{part.title}</b>
          <small className="block text-[12.5px] text-air-muted">{part.sub}</small>
        </div>
      </div>

      {pinned.length > 0 ? (
        <div className="space-y-3">
          {pinned.map((rec) => (
            <AudioNote
              key={rec.id}
              src={journeyApi.recordingMediaUrl(rec.id)}
              title={rec.title || `Listen: ${part.title}`}
              durationSeconds={rec.durationSeconds}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-3.5">{children}</div>
    </div>
  );
}

/** A line the agent says, quoted so it is never mistaken for guidance. */
function Say({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <p
      className={cn(
        'flex gap-2.5 border-l-2 py-1.5 pl-3 text-air-text',
        small ? 'text-[13px]' : 'text-[14.5px] font-medium',
      )}
      style={{ borderColor: 'var(--pk-gold-line)' }}
    >
      <Quote className="mt-1 h-3 w-3 shrink-0" style={{ color: 'rgb(var(--pk-gold))' }} />
      <span>{children}</span>
    </p>
  );
}

function StepLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('mb-1.5 font-mono-ui text-[10px] font-semibold uppercase tracking-[0.14em] text-air-faint', className)}>
      {children}
    </p>
  );
}

function Fork({ children }: { children: React.ReactNode }) {
  return <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">{children}</div>;
}

function ForkCard({
  when, tone, children,
}: {
  when: string; tone?: 'ok' | 'stop'; children: React.ReactNode;
}) {
  const hue = tone ?? 'brand';
  const accent = `rgb(var(--pk-${hue}))`;
  const soft = `var(--pk-${hue}-soft)`;

  return (
    <div className="rounded-[10px] border p-3" style={{ background: soft, borderColor: `rgb(var(--pk-${hue}) / 0.3)` }}>
      <p className="mb-1.5 font-mono-ui text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: accent }}>
        {when}
      </p>
      {children}
    </div>
  );
}

function CaptureBody() {
  return (
    <>
      <BlockHead />
      <CaptureConsole />
    </>
  );
}

function CheatBody() {
  const cheat = useBlocks<{ term: string; definition: string }>('cheat');
  return (
    <>
      <BlockHead />
      <CheatSheet
        title="Key product knowledge summary"
        sub="The one-page recap — open it before a call instead of scrolling the whole page."
        rows={cheat.map((c) => [c.term, c.definition] as [string, string])}
      />
    </>
  );
}

// ── pieces ──────────────────────────────────────────────────

function FlowNode({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-lg border bg-air-panel px-3 py-[7px] text-[13px] font-medium text-air-text"
      style={{ borderColor: 'var(--pk-rust-line)' }}
    >
      {children}
    </span>
  );
}

function BenefitCard({ icon, title, body }: { icon?: string; title: string; body: string }) {
  const Icon = iconFor(icon);
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className="air-panel rounded-[10px] border p-3.5 text-left transition-colors"
      style={open ? { borderColor: 'var(--pk-gold-line)' } : undefined}
    >
      <span
        className="mb-2.5 grid h-[30px] w-[30px] place-items-center rounded-lg border"
        style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)', color: 'rgb(var(--pk-brand))' }}
      >
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <b className="block text-[13.5px] font-semibold leading-tight text-air-text">{title}</b>
      <span
        className="mt-2 flex items-center gap-1.5 font-mono-ui text-[10.5px] uppercase tracking-[0.06em]"
        style={{ color: open ? 'rgb(var(--air-faint))' : 'rgb(var(--pk-gold))' }}
      >
        Details
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </span>
      <span
        className="block overflow-hidden text-[12.5px] text-air-muted transition-all duration-300"
        style={{ maxHeight: open ? 140 : 0, marginTop: open ? 8 : 0 }}
      >
        {body}
      </span>
    </button>
  );
}

function ScriptQ({
  n, q, must, note, children,
}: {
  n: number; q: string; must?: boolean; note?: string; children?: React.ReactNode;
}) {
  return (
    <div className="air-hairline flex gap-3.5 border-b border-dashed py-4 last:border-none last:pb-0">
      <span
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full font-mono-ui text-[12px] font-semibold"
        style={{ background: 'rgb(var(--pk-brand))', color: 'rgb(var(--air-bg))' }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-semibold text-air-text">{q}</p>
        {(must || note) && (
          <p className="mb-2 mt-1 flex items-center gap-1.5 font-mono-ui text-[11px] text-air-faint">
            {must ? <Check className="h-3 w-3" /> : <Info className="h-3 w-3 shrink-0" />}
            {must ? 'Must be Yes' : note}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

function Answers({ yes, no }: { yes?: string; no?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {yes && (
        <span
          className="inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[12.5px] font-medium"
          style={{ background: 'var(--pk-ok-soft)', borderColor: 'rgb(var(--pk-ok) / 0.4)', color: 'rgb(var(--pk-ok))' }}
        >
          <Check className="h-3 w-3" />
          {yes}
        </span>
      )}
      {no && (
        <span
          className="inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[12.5px] font-medium"
          style={{ background: 'var(--pk-stop-soft)', borderColor: 'rgb(var(--pk-stop) / 0.4)', color: 'rgb(var(--pk-stop))' }}
        >
          <CircleX className="h-3 w-3" />
          {no}
        </span>
      )}
    </div>
  );
}

/**
 * Call-capture checklist. Ticks are local UI state only — this is a study aid,
 * not a form, and nothing is submitted anywhere.
 */
function CaptureConsole() {
  const capture = useBlocks<{ icon?: string; label: string; sub?: string }>('fact');
  const [done, setDone] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  return (
    <div
      className="relative overflow-hidden rounded-[14px] border p-5 shadow-[var(--air-shadow-lg)]"
      style={{ background: 'var(--pk-band)', borderColor: 'rgb(var(--pk-gold) / 0.25)' }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <b className="font-display text-[16px] font-semibold" style={{ color: 'var(--pk-band-ink)' }}>
          Call capture
        </b>
        <span
          className="rounded-full border px-3 py-1 font-mono-ui text-[12px]"
          style={{ background: 'rgb(var(--pk-gold) / 0.16)', borderColor: 'rgb(var(--pk-gold) / 0.38)', color: 'var(--pk-band-gold)' }}
        >
          {done.size} of {capture.length} captured
        </span>
      </div>

      {capture.map((c, i) => {
        const isDone = done.has(i);
        return (
          <button
            key={c.label}
            type="button"
            onClick={() => toggle(i)}
            aria-pressed={isDone}
            className="flex w-full items-center gap-3 border-b py-3 text-left last:border-none"
            style={{ borderColor: 'rgb(255 255 255 / 0.08)' }}
          >
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md border-[1.5px] transition-colors"
              style={
                isDone
                  ? { background: 'rgb(var(--pk-gold))', borderColor: 'rgb(var(--pk-gold))', color: '#241708' }
                  : { borderColor: 'rgb(255 255 255 / 0.28)', color: 'transparent' }
              }
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <IconOf item={c} className="h-4 w-4 shrink-0" style={{ color: 'var(--pk-band-gold)' }} />
            <span
              className="text-[14px] font-medium"
              style={{ color: isDone ? 'var(--pk-band-sub)' : 'var(--pk-band-ink)' }}
            >
              {c.label}
            </span>
            {c.sub && (
              <span className="ml-auto hidden font-mono-ui text-[11px] sm:block" style={{ color: 'var(--pk-band-sub)' }}>
                {c.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

