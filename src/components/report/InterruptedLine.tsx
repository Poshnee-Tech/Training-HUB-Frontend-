import type { CSSProperties } from 'react';

/**
 * A customer line the trainee talked over.
 *
 * `heard` is only the whole sentences the trainee definitely heard — what the
 * server scores and remembers. `content` is the display text the server built
 * at the barge-in: those sentences, an estimate of how far into the next one
 * the customer got, and "—". The estimated part is drawn lighter so it never
 * reads as a finished statement. A line cut before any of it played is just
 * the mark, shown as a sentence instead of an empty bubble.
 */
export const CUT_MARK = '—';

const TAG_STYLE: CSSProperties = {
  display: 'inline-block',
  marginLeft: 6,
  padding: '0 6px',
  borderRadius: 999,
  border: '1px solid currentColor',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  opacity: 0.55,
  verticalAlign: 'middle',
  lineHeight: '15px',
};

export function InterruptedLine({ content, heard, reason }: { content: string; heard: string; reason?: string }) {
  const failed = reason === 'tts_incomplete' || reason === 'playback_unresolved';
  const tag = <span style={TAG_STYLE}>{failed ? 'Audio problem' : 'Interrupted'}</span>;

  if (!content || content === CUT_MARK || content === '…') {
    return (
      <span style={{ fontStyle: 'italic', opacity: 0.6 }}>
        {failed ? 'Audio ended before any words could be confirmed' : 'Cut off before a word was heard'}{tag}
      </span>
    );
  }

  const heardTrim = heard.trim();
  const prefix = heardTrim && content.startsWith(heardTrim) ? heardTrim : '';
  const rest = content.slice(prefix.length).trim();
  return (
    <span title={failed ? 'Audio delivery failed. The faded part is an estimate of what played.' : 'You spoke over the customer here. The faded part is an estimate of what was said before the cut.'}>
      {prefix}
      {prefix && rest ? ' ' : ''}
      <span style={{ opacity: 0.55 }}>{rest}</span>
      {tag}
    </span>
  );
}

/** For rows loaded from the API: reads the server's `metadata`. */
export function interruptedFromRow(msg: any): { content: string; heard: string; reason?: string } | null {
  if (msg?.role !== 'CUSTOMER') return null;
  const meta = msg?.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
  const heard = typeof msg?.content === 'string' ? msg.content : '';
  const reason = typeof meta.interruptionReason === 'string' ? meta.interruptionReason : undefined;
  if (typeof meta.displayText === 'string' && meta.displayText) return { content: meta.displayText, heard, reason };
  if (reason === 'tts_incomplete' || reason === 'playback_unresolved') return { content: heard ? `${heard}…` : '…', heard, reason };
  // Rows written before `displayText` existed: nothing heard, flagged inaudible.
  if (!heard.trim() && meta.audible === false) return { content: CUT_MARK, heard: '' };
  return null;
}
