import { create } from 'zustand';
import { auth, COOKIE_AUTH_MARKER, recoverSessionFromCookie } from '@/lib/api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  /**
   * True once the session has been settled either way — restored, or
   * confirmed absent. Pages need this to tell "still checking" apart from
   * "checked, nobody is signed in": without it a missing token leaves their
   * spinner running forever, because the load callback returns before it can
   * clear the loading flag.
   */
  authResolved: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

type SetState = (partial: Partial<AuthState>) => void;

/**
 * Guard so the several components that call loadFromStorage() on mount send
 * one recovery probe between them rather than one each.
 */
let cookieRecoveryStarted = false;

/**
 * Last resort when this origin has no usable localStorage session: the
 * httpOnly cookie may still be valid. The route guard in proxy.ts gates
 * on that cookie, so without this a browser holding a good cookie and an
 * empty localStorage gets waved onto a protected page whose data never loads.
 */
async function recoverFromCookie(set: SetState): Promise<void> {
  if (cookieRecoveryStarted) return;
  cookieRecoveryStarted = true;

  const user = await recoverSessionFromCookie();

  if (!user) {
    set({ user: null, token: null, isAuthenticated: false, authResolved: true });
    return;
  }

  // Store the marker rather than a JWT: the real credential stays in the
  // httpOnly cookie, and request() knows to send the cookie instead of an
  // Authorization header when it sees this value.
  try {
    localStorage.setItem('token', COOKIE_AUTH_MARKER);
    localStorage.setItem('user', JSON.stringify(user));
  } catch {}

  set({ user, token: COOKIE_AUTH_MARKER, isAuthenticated: true, authResolved: true });
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  authResolved: false,

  /**
   * ── THE JWT NEVER TOUCHES STORAGE (security review 2026-09-01, finding 8) ──
   *
   * This stored the raw token. The marker mechanism below already existed and
   * was used only on cookie RECOVERY, so an ordinary login still wrote a
   * readable seven-day credential into localStorage — where any script on the
   * origin can take it, and from where it replays anywhere.
   *
   * The login response sets the httpOnly `callsim_auth` cookie, so the marker
   * is now the only thing stored, on every path. `request()` already treats it
   * as "send the cookie, not an Authorization header".
   */
  login: (user, _token) => {
    localStorage.setItem('token', COOKIE_AUTH_MARKER);
    localStorage.setItem('user', JSON.stringify(user));
    cookieRecoveryStarted = false;
    set({ user, token: COOKIE_AUTH_MARKER, isAuthenticated: true, authResolved: true });
  },

  /**
   * SIGNING OUT HAS TO REACH THE SERVER.
   *
   * This cleared localStorage and nothing else, so `POST /api/auth/logout` was
   * never issued and the httpOnly `callsim_auth_agent` cookie survived the
   * sign-out. Two things then follow, both by design elsewhere: `proxy.ts`
   * admits any request carrying that cookie, so a "signed-out" user still
   * reaches every protected page; and `recoverFromCookie` below asks
   * `/api/auth/me`, which succeeds on the surviving cookie and signs them
   * straight back in. On a shared training machine, sign-out did not end the
   * session.
   *
   * The local state is cleared FIRST and unconditionally: a network failure
   * must still sign the trainee out of this browser, so the server call is
   * fire-and-forget behind it.
   */
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    cookieRecoveryStarted = false;
    set({ user: null, token: null, isAuthenticated: false, authResolved: true });
    void auth.logout().catch(() => { /* the cookie outlives us; local state is already gone */ });
  },

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (token && userStr) {
      // A marker is not a JWT — there is nothing to decode, and the cookie it
      // stands for carries the real expiry. Confirm it with the server rather
      // than trusting it, so a stale marker cannot strand the page.
      if (token === COOKIE_AUTH_MARKER) {
        try {
          set({ user: JSON.parse(userStr), token, isAuthenticated: true, authResolved: true });
          return;
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      } else {
        try {
          // JWTs use base64url (- and _ instead of + and /) with no padding.
          // atob() needs standard base64 with padding — convert before decoding.
          const base64url = token.split('.')[1];
          const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
          const payload = JSON.parse(atob(padded));

          if (!payload.exp || payload.exp * 1000 >= Date.now()) {
            const user = JSON.parse(userStr);
            set({ user, token, isAuthenticated: true, authResolved: true });
            return;
          }
          // Expired. Fall through — the cookie may still be good.
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
    }

    void recoverFromCookie(set);
  },
}));
