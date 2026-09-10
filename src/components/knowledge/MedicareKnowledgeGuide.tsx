'use client';

/**
 * Medicare Product Knowledge — the agent's reference guide.
 *
 * Built on GuideKit, so this file is content and topic screens only: the
 * listing, the topic navigation, the narration players and the three-question
 * Quick Check under every screen all come from the kit, and the page is the
 * matched pair of the ACA guide by construction rather than by upkeep.
 *
 * The colours are the shared `--pk-*` "signal board" tokens; nothing here
 * hardcodes a hex except the Advantage band, which is meant to read as the
 * one warm, loud screen in the set — the benefits an agent sells on.
 */

import {
  BookMarked, Check, CircleX, HeartPulse, ScrollText, ShieldCheck, ShieldPlus, Sparkles,
} from 'lucide-react';
import {
  BandLabel, CheatSheet, Eyebrow, KnowledgeGuide, SectionHead, useBlocks,
} from '@/components/knowledge/GuideKit';
import { iconFor } from './icons';

// ── Content ─────────────────────────────────────────────────











const BODIES: Record<string, React.ComponentType> = {
  basics: BasicsBody,
  parts: PartsBody,
  advantage: AdvantageBody,
  medigap: MedigapBody,
  comparison: ComparisonBody,
  payoff: PayoffBody,
  cheat: CheatBody,
};

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

export default function MedicareKnowledgeGuide() {
  return (
    <KnowledgeGuide
      campaign="MEDICARE"
      header={{
        icon: BookMarked,
        title: 'Medicare Product Knowledge',
        tagline: 'Everything you need to know about Medicare.',
      }}
      listing={{
        title: 'One screen per topic',
        sub: 'Read the topic, then take the three-question Quick Check at the bottom of the screen.',
      }}
      bodies={BODIES}
    />
  );
}

// ── topic screens ───────────────────────────────────────────

function BasicsBody() {
  const eligibility = useBlocks<{ icon?: string; label: string; sub?: string }>('fact');
  const covers = useBlocks<{ text: string }>('chip');
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
      <HeartPulse
        className="pointer-events-none absolute right-7 top-6 h-[72px] w-[72px] opacity-[0.14]"
        style={{ color: 'var(--pk-band-ink)' }}
        aria-hidden
      />

      <Eyebrow onBand>The basics</Eyebrow>
      <h2 className="mb-2.5 font-display text-[26px] font-semibold" style={{ color: 'var(--pk-band-ink)' }}>
        What is Medicare?
      </h2>
      <p className="max-w-[64ch] leading-relaxed" style={{ color: 'var(--pk-band-sub)' }}>
        Medicare is a{' '}
        <b className="font-semibold" style={{ color: 'var(--pk-band-ink)' }}>federal health insurance program</b> that
        helps cover health care costs like hospital stays, doctor visits, prescription drugs, and more.
      </p>

      <BandLabel className="mb-2.5 mt-6">Mainly for</BandLabel>
      <div className="grid gap-3 sm:grid-cols-3">
        {eligibility.map((e) => (
          <div
            key={e.label}
            className="flex items-start gap-3 rounded-[10px] border p-3.5"
            style={{ background: 'rgb(255 255 255 / 0.06)', borderColor: 'rgb(255 255 255 / 0.12)' }}
          >
            <IconOf item={e} className="mt-px h-[18px] w-[18px] shrink-0" style={{ color: 'var(--pk-band-gold)' }} />
            <b className="font-display text-[14px] font-semibold leading-snug" style={{ color: 'var(--pk-band-ink)' }}>
              {e.label}
            </b>
          </div>
        ))}
      </div>

      <div
        className="mt-5 flex flex-wrap items-center gap-2 border-t pt-[18px]"
        style={{ borderColor: 'rgb(255 255 255 / 0.12)' }}
      >
        <BandLabel className="mr-1">Helps cover</BandLabel>
        {covers.map((c) => (
          <span
            key={c.text}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12.5px]"
            style={{ background: 'rgb(255 255 255 / 0.08)', borderColor: 'rgb(255 255 255 / 0.14)', color: 'var(--pk-band-ink)' }}
          >
            <Check className="h-3 w-3" style={{ color: 'var(--pk-band-gold)' }} />
            {c.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function PartsBody() {
  const parts = useBlocks<{ id: string; icon?: string; name: string; coverage?: string[] }>('part');
  return (
    <>
      <BlockHead />
      <div className="grid gap-3 sm:grid-cols-2">
        {parts.map((part) => (
          <article key={part.id} className="air-panel rounded-[14px] border p-4">
            <div className="mb-3 flex items-center gap-3">
              <span
                className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] border font-display text-[15px] font-bold"
                style={{ background: 'var(--pk-brand-soft)', borderColor: 'var(--pk-brand-line)', color: 'rgb(var(--pk-brand))' }}
              >
                {part.id}
              </span>
              <div className="min-w-0">
                <b className="block font-display text-[15px] font-semibold text-air-text">Part {part.id}</b>
                <small className="block text-[12.5px] text-air-muted">{part.name}</small>
              </div>
              <IconOf item={part} className="ml-auto h-[18px] w-[18px] shrink-0" style={{ color: 'rgb(var(--pk-gold))' }} />
            </div>

            <ul className="grid gap-2">
              {(part.coverage ?? []).map((item) => (
                <li key={item} className="flex gap-2.5 text-[13px] leading-[1.5] text-air-muted">
                  <Check className="mt-0.5 h-[15px] w-[15px] shrink-0" style={{ color: 'rgb(var(--pk-gold))' }} />
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </>
  );
}

function AdvantageBody() {
  const extras = useBlocks<{ icon?: string; label: string; sub?: string }>('fact');
  const cards = useBlocks<{ icon?: string; title: string; body: string }>('benefit');
  return (
    <>
      <BlockHead />

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <article key={c.title} className="air-panel rounded-[14px] border p-4">
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

      {/* The extras band — the loud screen in the set, because these are what
          the customer hears about on the call. */}
      <div
        className="relative mt-3 overflow-hidden rounded-[20px] px-[26px] py-6 shadow-[var(--air-shadow-lg)]"
        style={{ background: 'linear-gradient(135deg, #EFCE86 0%, #D69A44 48%, #B87A2E 100%)' }}
      >
        <span
          className="pointer-events-none absolute -bottom-10 -right-[30px] h-[220px] w-[220px] rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgb(255 255 255 / .35), transparent 70%)' }}
          aria-hidden
        />
        <p className="mb-1.5 flex items-center gap-2 font-mono-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7A4410]">
          <span className="h-0.5 w-[18px] rounded-sm bg-[#7A4410]" />
          May offer extra benefits
        </p>
        <h3 className="font-display text-[22px] font-semibold text-[#40260C]">Beyond hospital and medical</h3>
        <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-[#5A3A15]">
          Extras that Original Medicare does not carry — and the reason most customers move to a Part C plan.
        </p>

        <div className="relative mt-[18px] grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {extras.map((a) => (
            <div
              key={a.label}
              className="flex items-center gap-3 rounded-[10px] border border-white/10 bg-[#241205] px-3.5 py-3"
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-[rgb(192_138_62_/_0.24)] text-[#EDC77E]">
                <IconOf item={a} className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] font-semibold text-[#F7E7D2]">{a.label}</b>
                {a.sub && <small className="block text-[11.5px] text-[#C2A279]">{a.sub}</small>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function MedigapBody() {
  const gaps = useBlocks<{ text: string }>('chip');
  const freedoms = useBlocks<{ text: string }>('bullet');
  return (
    <>
      <BlockHead />

      <div className="grid gap-3.5 lg:grid-cols-2">
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
                The gaps
              </div>
              <h4 className="font-display text-[16px] font-semibold text-air-text">What Original Medicare leaves</h4>
            </div>
          </div>
          <p className="my-3 text-[13px] text-air-muted">
            Parts A and B do not pay everything. What is left over is what a Medigap plan is bought for:
          </p>
          <div className="flex flex-wrap gap-[7px]">
            {gaps.map((gap) => (
              <span
                key={gap.text}
                className="inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[12.5px] font-medium"
                style={{ background: 'var(--pk-stop-soft)', borderColor: 'rgb(var(--pk-stop) / 0.35)', color: 'rgb(var(--pk-stop))' }}
              >
                <ShieldCheck className="h-3 w-3" />
                {gap.text}
              </span>
            ))}
          </div>
        </div>

        <div
          className="air-panel rounded-[14px] border p-[18px]"
          style={{ borderColor: 'rgb(var(--pk-ok))', borderTopWidth: 3 }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-[30px] w-[30px] place-items-center rounded-lg"
              style={{ background: 'var(--pk-ok-soft)', color: 'rgb(var(--pk-ok))' }}
            >
              <ShieldPlus className="h-[17px] w-[17px]" />
            </span>
            <div>
              <div className="font-mono-ui text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgb(var(--pk-ok))' }}>
                What it buys
              </div>
              <h4 className="font-display text-[16px] font-semibold text-air-text">Freedom of choice</h4>
            </div>
          </div>
          <div className="my-3 font-display text-[34px] font-semibold leading-none tracking-[-0.02em] text-air-text">
            $100<span className="mx-1.5 text-[22px] text-air-faint">–</span>$200
            <small className="ml-2 font-mono-ui text-[12px] font-normal text-air-faint">a month</small>
          </div>
          <ul className="grid gap-2">
            {freedoms.map((f) => (
              <li key={f.text} className="flex gap-2.5 text-[13px] text-air-muted">
                <Check className="mt-0.5 h-[15px] w-[15px] shrink-0" style={{ color: 'rgb(var(--pk-ok))' }} />
                {f.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function ComparisonBody() {
  const comparison = useBlocks<{ label: string; advantage: string; medigap: string }>('comparison');
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

        <div className="relative -mx-[22px] overflow-x-auto px-[22px]">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="w-[110px] pb-3" />
                <th scope="col" className="pb-3 pr-4 align-bottom">
                  <span className="flex items-center gap-2 font-display text-[15px] font-semibold" style={{ color: 'var(--pk-band-ink)' }}>
                    <Sparkles className="h-4 w-4 shrink-0" style={{ color: 'var(--pk-band-gold)' }} />
                    Medicare Advantage
                  </span>
                  <span className="mt-0.5 block font-mono-ui text-[10.5px] uppercase tracking-[0.14em]" style={{ color: 'var(--pk-band-sub)' }}>
                    Part C
                  </span>
                </th>
                <th scope="col" className="pb-3 align-bottom">
                  <span className="flex items-center gap-2 font-display text-[15px] font-semibold" style={{ color: 'var(--pk-band-ink)' }}>
                    <ShieldPlus className="h-4 w-4 shrink-0" style={{ color: 'var(--pk-band-gold)' }} />
                    Medicare Supplement
                  </span>
                  <span className="mt-0.5 block font-mono-ui text-[10.5px] uppercase tracking-[0.14em]" style={{ color: 'var(--pk-band-sub)' }}>
                    Medigap
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.label} className="border-t" style={{ borderColor: 'rgb(255 255 255 / 0.08)' }}>
                  <th
                    scope="row"
                    className="py-3 pr-4 align-top font-mono-ui text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: 'var(--pk-band-sub)' }}
                  >
                    {row.label}
                  </th>
                  <td className="py-3 pr-4 align-top text-[13px] leading-[1.5]" style={{ color: 'var(--pk-band-ink)' }}>
                    {row.advantage}
                  </td>
                  <td className="py-3 align-top text-[13px] leading-[1.5]" style={{ color: 'var(--pk-band-ink)' }}>
                    {row.medigap}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PayoffBody() {
  const payoffs = useBlocks<{ icon?: string; label: string; sub?: string }>('fact');
  const extrasChips = useBlocks<{ text: string }>('chip');
  return (
    <>
      <BlockHead />

      <div className="grid gap-3 sm:grid-cols-2">
        {payoffs.map((p) => (
          <article key={p.label} className="air-panel flex items-start gap-3.5 rounded-[14px] border p-4">
            <span
              className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] border"
              style={{ background: 'var(--pk-gold-soft)', borderColor: 'var(--pk-gold-line)', color: 'rgb(var(--pk-gold))' }}
            >
              <IconOf item={p} className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <b className="block font-display text-[15px] font-semibold text-air-text">{p.label}</b>
              <p className="mt-0.5 text-[13px] leading-[1.5] text-air-muted">{p.sub}</p>
            </div>
          </article>
        ))}
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-2 rounded-[14px] border p-4"
        style={{ background: 'var(--pk-rust-soft)', borderColor: 'var(--pk-rust-line)' }}
      >
        <p className="mr-1 font-mono-ui text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgb(var(--pk-rust))' }}>
          Say it as savings
        </p>
        {extrasChips.map((t) => (
          <span
            key={t.text}
            className="rounded-lg border bg-air-panel px-3 py-[7px] text-[13px] font-medium text-air-text"
            style={{ borderColor: 'var(--pk-rust-line)' }}
          >
            {t.text}
          </span>
        ))}
        <p className="mt-1 w-full text-[12.5px] text-air-muted">
          Money saved every month is the line customers respond to — not the list of benefits by name.
        </p>
      </div>
    </>
  );
}

function CheatBody() {
  const cheat = useBlocks<{ term: string; definition: string }>('cheat');
  return (
    <>
      <BlockHead />
      <CheatSheet
        icon={ScrollText}
        title="Medicare in one page"
        sub="The whole guide, compressed to the lines you say on a call."
        rows={cheat.map((c) => [c.term, c.definition] as [string, string])}
      />
    </>
  );
}
