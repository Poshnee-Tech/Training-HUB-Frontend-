'use client';

/**
 * The small Markdown subset the admin portal advertises, rendered as React.
 *
 * Deliberately not `dangerouslySetInnerHTML` and deliberately not a library.
 * This text is admin-authored and arrives over the wire, so building elements
 * means a stray `<script>` or `onerror=` in an article is inert text rather
 * than something to sanitise correctly forever. It also keeps the bundle and
 * the CSP untouched.
 *
 * Supported, matching the hint under the editor: `##`/`###` headings,
 * `-`/`*` bullets, `1.` numbered lists, `>` quotes, fenced and inline code,
 * `**bold**`, `*italic*`, and `[text](https://link)`. Anything else renders as
 * the paragraph it looks like, which is the right failure for prose.
 */

import { Fragment, type ReactNode } from 'react';

/** Inline spans, applied in one pass so `**bold**` inside a link still works. */
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((piece, i) => {
    const key = `${keyBase}-${i}`;
    if (!piece) return null;

    if (piece.startsWith('`') && piece.endsWith('`')) {
      return (
        <code
          key={key}
          className="rounded bg-air-line/[0.12] px-1.5 py-0.5 font-mono-ui text-[0.88em] text-air-text"
        >
          {piece.slice(1, -1)}
        </code>
      );
    }

    if (piece.startsWith('**') && piece.endsWith('**')) {
      return <b key={key} className="font-semibold text-air-text">{piece.slice(2, -2)}</b>;
    }

    if (piece.startsWith('*') && piece.endsWith('*')) {
      return <i key={key}>{piece.slice(1, -1)}</i>;
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
    if (link) {
      const href = link[2];
      // Only http(s) and in-app paths become links; anything else (javascript:,
      // data:) renders as its own text rather than a clickable trap.
      const safe = /^(https?:\/\/|\/)/i.test(href);
      if (!safe) return <Fragment key={key}>{piece}</Fragment>;
      return (
        <a
          key={key}
          href={href}
          target={href.startsWith('/') ? undefined : '_blank'}
          rel="noopener noreferrer"
          className="font-medium text-air-signal-bright underline underline-offset-2 hover:text-air-cyan"
        >
          {link[1]}
        </a>
      );
    }

    return <Fragment key={key}>{piece}</Fragment>;
  });
}

type Block =
  | { kind: 'h'; level: 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

/** Group the source into blocks first; inline formatting happens per block. */
function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flush(); continue; }

    if (trimmed.startsWith('```')) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: 'h', level: heading[1].length === 2 ? 2 : 3, text: heading[2] });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flush();
      blocks.push({ kind: 'quote', text: trimmed.replace(/^>\s?/, '') });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ol') last.items.push(numbered[1]);
      else blocks.push({ kind: 'ol', items: [numbered[1]] });
      continue;
    }

    para.push(trimmed);
  }

  flush();
  return blocks;
}

export default function Markdown({ source }: { source: string }) {
  const blocks = parse(source ?? '');

  return (
    <div className="space-y-3 text-[14.5px] leading-relaxed text-air-muted">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'h':
            return block.level === 2 ? (
              <h3
                key={i}
                className="pt-1 font-display text-[19px] font-bold tracking-[-0.02em] text-air-text"
              >
                {inline(block.text, `h${i}`)}
              </h3>
            ) : (
              <h4 key={i} className="pt-1 font-display text-[16px] font-bold text-air-text">
                {inline(block.text, `h${i}`)}
              </h4>
            );

          case 'quote':
            return (
              <blockquote
                key={i}
                className="border-l-2 border-air-signal/45 bg-air-signal/[0.06] py-2 pl-4 pr-3 italic text-air-text"
              >
                {inline(block.text, `q${i}`)}
              </blockquote>
            );

          case 'code':
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-xl border border-air-line/20 bg-air-line/[0.07] p-3.5 font-mono-ui text-[12.5px] text-air-text"
              >
                {block.text}
              </pre>
            );

          case 'ul':
            return (
              <ul key={i} className="space-y-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2.5">
                    <span
                      className="mt-[9px] h-[4px] w-[4px] shrink-0 rounded-full bg-air-signal-bright"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">{inline(item, `ul${i}-${j}`)}</span>
                  </li>
                ))}
              </ul>
            );

          case 'ol':
            return (
              <ol key={i} className="space-y-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2.5">
                    <span className="mt-px shrink-0 font-mono-ui text-[12px] font-bold text-air-signal-bright">
                      {j + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{inline(item, `ol${i}-${j}`)}</span>
                  </li>
                ))}
              </ol>
            );

          default:
            return <p key={i}>{inline(block.text, `p${i}`)}</p>;
        }
      })}
    </div>
  );
}
