/**
 * Poshnee Training Hub brand mark.
 *
 * THE IDEA
 * A headset band, drawn so the arc also reads as a C. One ear cup is amber:
 * on a real floor that is the "you are on a live call" light, so the accent
 * carries a meaning rather than being a splash of colour.
 *
 * WHY IT IS BUILT THIS WAY
 * The band and the left cup are `currentColor`, so the mark inherits whatever
 * ink it sits in — plum on paper, cream on the plum rail — and only the accent
 * is fixed. That is what lets one component serve the sidebar, the auth pages,
 * the landing nav and a favicon without four hand-tuned copies.
 *
 * It survives being shrunk: three shapes, no hairlines, no gradients, nothing
 * that collapses at 16px. Drop the accent and it still reads, which is what
 * makes it safe for a one-colour print or an embroidered headset.
 */

const TITLE_ID = 'callsim-logo-title';

export function LogoMark({
  className,
  accent = '#DE8A24',
  title,
}: {
  className?: string;
  /** Set to `currentColor` for a one-colour rendering. */
  accent?: string;
  /** Give this only when the mark stands alone; a lockup labels itself. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-labelledby={title ? TITLE_ID : undefined}
    >
      {title && <title id={TITLE_ID}>{title}</title>}
      {/* the band — a true semicircle, so the curve stays even at any size */}
      <path
        d="M7.5 17.5V15a8.5 8.5 0 0 1 17 0v2.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <rect x="4.8" y="16.4" width="5.4" height="9" rx="2.7" fill="currentColor" />
      <rect x="21.8" y="16.4" width="5.4" height="9" rx="2.7" fill={accent} />
    </svg>
  );
}

/**
 * The mark on its plum tile — the app-icon form.
 *
 * Used where the logo needs to hold its own against a busy or light surface
 * (the sidebar header, the auth pages). On a surface that is already plum,
 * reach for `LogoMark` instead so the tile does not stack plum on plum.
 */
export function LogoTile({ className, radius = 9 }: { className?: string; radius?: number }) {
  return (
    <span
      className={className}
      style={{
        display: 'grid',
        placeItems: 'center',
        background: '#2E1B33',
        borderRadius: radius,
        color: '#F6F1F7',
      }}
    >
      <LogoMark className="h-[68%] w-[68%]" />
    </span>
  );
}
