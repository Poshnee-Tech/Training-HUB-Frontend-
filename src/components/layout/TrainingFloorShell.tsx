'use client';

/**
 * Training Floor shell — agent/user portal chrome.
 *
 * The user portal now follows the same structural pattern as AdminSidebar:
 * - fixed 16rem left sidebar
 * - 74px brand header
 * - grouped navigation
 * - active row with left signal marker
 * - account menu pinned to the bottom
 * - content offset by ml-64
 *
 * Agent routes, nav counts, settings, sign-out, and active-route behavior are
 * preserved.
 */

import Link from 'next/link';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogOut } from 'lucide-react';
import { LogoTile } from '@/components/brand/Logo';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
  /**
   * Extra routes this item owns. Needed where the destination is not under
   * the href — Study points at a dashboard section but the guides live at
   * /knowledge/*, so without this the nav highlights nothing on the page an
   * agent actually reads.
   */
  matches?: (pathname: string) => boolean;
};

const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Learn',
    items: [
      { href: '/dashboard', label: 'My Plan', icon: PulseIcon },
      { href: '/study', label: 'Study', icon: BookIcon },
      { href: '/clips', label: 'Example Calls', icon: DiscIcon },
      { href: '/pronunciation', label: 'Pronunciation', icon: MicrophoneIcon },
    ],
  },
  {
    heading: 'Your progress',
    items: [
      { href: '/progress', label: 'My Progress', icon: ChartIcon },
      { href: '/scenarios', label: 'Assignments', icon: BriefcaseIcon },
      { href: '/reports', label: 'Call History', icon: FileIcon },
    ],
  },
];

function navActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ── nav count context ─────────────────────────────────────── */

type Counts = Partial<Record<string, number>>;

const NavCountContext = React.createContext<{
  counts: Counts;
  setCounts: (next: Counts) => void;
}>({
  counts: {},
  setCounts: () => {},
});

export function useNavCounts() {
  return React.useContext(NavCountContext);
}

/* ── shell ─────────────────────────────────────────────────── */

export default function TrainingFloorShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [counts, setCountsState] = useState<Counts>({});

  const setCounts = React.useCallback((next: Counts) => {
    setCountsState((current) => {
      const changed = Object.entries(next).some(
        ([key, value]) => current[key] !== value,
      );

      return changed ? { ...current, ...next } : current;
    });
  }, []);

  return (
    <NavCountContext.Provider value={{ counts, setCounts }}>
      <div className="air-scope min-h-screen bg-air-bg font-body text-air-text antialiased">
        <FloorSidebar />

        <div className="ml-64 min-h-screen min-w-0">
          {children}
        </div>
      </div>
    </NavCountContext.Provider>
  );
}

/* ── sidebar ───────────────────────────────────────────────── */

function FloorSidebar() {
  const pathname = usePathname();
  const { counts } = useNavCounts();

  return (
    <aside
      id="training-floor-sidebar"
      className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-white/10 bg-[#2E1B33] text-[#FFF9F2] shadow-[12px_0_40px_-28px_rgba(20,10,24,0.65)]"
    >
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex h-[74px] shrink-0 select-none items-center gap-3 border-b border-white/10 px-5"
      >
        <LogoTile className="h-10 w-10 shrink-0" radius={11} />

        <span className="min-w-0">
          <span className="block font-display text-[17px] font-extrabold leading-none tracking-[-0.02em] text-[#FFF9F2]">
            Poshnee
          </span>

          <span className="mt-1 block font-mono-ui text-[8.5px] uppercase tracking-[0.16em] text-[#AE9FAF]">
            Training Hub
          </span>
        </span>
      </Link>

      {/* Navigation */}
      <nav
        className="flex-1 space-y-6 overflow-y-auto px-3 py-4"
        aria-label="Training sections"
      >
        {NAV_GROUPS.map((group) => (
          <div
            key={group.heading}
            role="group"
            aria-labelledby={groupId(group.heading)}
          >
            <span
              id={groupId(group.heading)}
              className="block px-3 pb-2 font-mono-ui text-[10.5px] uppercase tracking-[0.12em] text-[#9F8FA2]"
            >
              {group.heading}
            </span>

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = navActive(pathname, item.href);
                const Icon = item.icon;
                const count = counts[item.href];

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-colors',
                      active
                        ? 'bg-white/[0.08] text-[#FFF9F2]'
                        : 'text-[#C8BAC9] hover:bg-white/[0.05] hover:text-[#FFF9F2]',
                    )}
                  >
                    {/* Same active indicator as admin sidebar */}
                    <span
                      className={cn(
                        'absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[#D8A44A] transition-opacity duration-200',
                        active ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden
                    />

                    <Icon
                      className={cn(
                        'h-[17px] w-[17px] shrink-0 stroke-current transition-colors',
                        active
                          ? 'text-[#D8A44A]'
                          : 'text-[#9F8FA2] group-hover:text-[#C8BAC9]',
                      )}
                    />

                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>

                    {count != null && count > 0 && (
                      <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono-ui text-[9.5px] font-bold text-[#C8BAC9]">
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Account */}
      <div className="shrink-0 border-t border-white/10 p-4">
        <AgentMenu />
      </div>
    </aside>
  );
}

const groupId = (heading: string) =>
  `nav-${heading.toLowerCase().replace(/\s+/g, '-')}`;

/* ── account menu ──────────────────────────────────────────── */

function AgentMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const signOut = () => {
    setOpen(false);
    logout();
    router.push('/login');
  };

  return (
    <div
      ref={menuRef}
      className="relative flex items-center gap-2"
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#D8A44A] to-[#B77A32] font-display text-[13px] font-bold text-white">
          {user?.firstName?.[0]?.toUpperCase() ?? '?'}
          {user?.lastName?.[0]?.toUpperCase() ?? ''}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[#FFF9F2]">
            {user?.firstName} {user?.lastName}
          </span>

          <span className="block truncate font-mono-ui text-[9px] uppercase tracking-[0.14em] text-[#AE9FAF]">
            {user?.role === 'AGENT'
              ? 'Agent'
              : user?.role ?? 'Agent'}
          </span>
        </span>

        <span
          className="shrink-0 transition-transform duration-200"
          style={{
            transform: open ? 'rotate(180deg)' : undefined,
          }}
        >
          <ChevronDown
            className="h-3.5 w-3.5 text-[#AE9FAF]"
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Agent account"
          className="absolute bottom-full left-0 z-50 mb-2 w-full rounded-xl border border-white/10 bg-[#35213B] p-1.5 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.65)]"
        >
          <Link
            href="/change-password"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 font-mono-ui text-[10px] font-bold uppercase tracking-[0.12em] text-[#BBAEBE] transition-colors hover:bg-white/[0.06] hover:text-[#E4B65F]"
          >
            <KeyIcon className="h-3.5 w-3.5 shrink-0 stroke-current" />
            Change password
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-mono-ui text-[10px] font-bold uppercase tracking-[0.12em] text-[#BBAEBE] transition-colors hover:bg-[#9E4750]/20 hover:text-[#F0A0A7]"
          >
            <LogOut
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ── icons ────────────────────────────────────────────────── */

const S = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function PulseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function DiscIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function MicrophoneIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg className={className} {...S}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 3 3 5-6" />
    </svg>
  );
}

function BriefcaseIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg className={className} {...S}>
      <path d="M9 11H5a2 2 0 0 0-2 2v7h18v-7a2 2 0 0 0-2-2h-4" />
      <path d="M9 11V4h6v7" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  );
}
