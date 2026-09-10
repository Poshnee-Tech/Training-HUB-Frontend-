'use client';

/**
 * First-login password change for admin-enrolled agents.
 *
 * Enrollment issues a temporary password and sets `mustChangePassword`. Login
 * routes here while that flag is set; clearing it is what releases the agent
 * into the rest of the app.
 *
 * Styled to match the Poshnee Training Hub auth theme (warm paper, plum) shared
 * with /login — the same scoped tokens and the same self-hosted fonts.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { auth } from '@/lib/api';

export default function ChangePasswordPage() {
  const { token } = useAuthStore();
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const goBack = () => {
    // Return to wherever the agent came from (usually the training floor);
    // if the page was opened directly there is no history to rewind, so fall
    // back to the dashboard.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (form.newPassword !== form.confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }
    if (form.newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await auth.changePassword(token!, form.currentPassword, form.newPassword);
      // Hard nav so the proxy re-reads auth state, matching the login flow.
      window.location.assign('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Could not change your password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell auth-shell--center">
      <style>{changePasswordStyles}</style>

      <div className="wrap">
        <button type="button" onClick={goBack} className="back-link">
          <svg viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>

        <div className="stack">
          {/* Same mark as /login. Per-shape fills beat the inherited
              `stroke:#fff; fill:none` that .jack svg sets. */}
          <div className="jack">
            <svg viewBox="0 0 32 32">
              <path d="M7.5 17.5V15a8.5 8.5 0 0 1 17 0v2.5" fill="none" stroke="#F6F1F7" strokeWidth="2.6" strokeLinecap="round" />
              <rect x="4.8" y="16.4" width="5.4" height="9" rx="2.7" fill="#F6F1F7" stroke="none" />
              <rect x="21.8" y="16.4" width="5.4" height="9" rx="2.7" fill="#DE8A24" stroke="none" />
            </svg>
          </div>
          <div className="eyebrow"><span className="dot"></span>First sign-in</div>
          <h1 className="title">Choose your password</h1>
          <p className="sub">
            You&apos;re signed in with a temporary password from your trainer. Pick your own to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} suppressHydrationWarning>
          <div className="field">
            <label htmlFor="current">Temporary password</label>
            <input
              id="current"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password your trainer set"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              suppressHydrationWarning
            />
          </div>

          <div className="field">
            <label htmlFor="next">New password</label>
            <input
              id="next"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Min. 8 characters"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              suppressHydrationWarning
            />
            <p className="hint">At least 8 characters.</p>
          </div>

          <div className="field">
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Repeat your new password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              suppressHydrationWarning
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" disabled={loading} className="btn-signin">
            {loading ? 'Saving…' : 'Save and continue'}
          </button>
        </form>

        <div className="security-note">
          <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
          Secured session · encrypted in transit
        </div>
      </div>
    </div>
  );
}

const changePasswordStyles = `
  .auth-shell {
    --paper:#FBF9F8; --paper-raised:#FFFFFF; --ink:#1E1520; --ink-mute:#6E6674;
    --line:#E4DCE6; --brass:#2E1B33; --brass-deep:#40284A; --brass-light:#DE8A24;
    --shadow: 0 1px 2px rgba(46,27,51,0.06), 0 10px 30px rgba(46,27,51,0.10);
    box-sizing: border-box;
    color: var(--ink);
    font-family: var(--font-body), system-ui, sans-serif;
  }
  .auth-shell * { box-sizing: border-box; }

  .auth-shell--center {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(800px 500px at 90% -10%, rgba(222,138,36,0.10), transparent 55%),
      radial-gradient(700px 480px at 0% 110%, rgba(46,27,51,0.08), transparent 55%),
      var(--paper);
    padding: 40px 20px;
  }

  .auth-shell .wrap {
    width: 100%; max-width: 420px;
    background: var(--paper); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: var(--shadow); padding: 44px 40px 36px;
    animation: aes-fade-up .5s ease both;
  }
  @keyframes aes-fade-up {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .auth-shell .back-link {
    display: flex; align-items: center; gap: 6px; background: none; border: none; cursor: pointer;
    padding: 4px 0; margin: 0 0 20px;
    font-family: var(--font-body), system-ui, sans-serif; font-size: 11px; letter-spacing: .08em;
    text-transform: uppercase; color: var(--ink-mute);
    transition: color .15s ease;
  }
  .auth-shell .back-link:hover { color: var(--brass); }
  .auth-shell .back-link svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

  .auth-shell .stack { text-align: center; margin-bottom: 26px; }
  .auth-shell .jack {
    width: 52px; height: 52px; border-radius: 13px; background: var(--brass);
    display: flex; align-items: center; justify-content: center; margin: 0 auto 18px;
    box-shadow: 0 4px 14px rgba(46,27,51,0.35);
  }
  .auth-shell .jack svg { width: 24px; height: 24px; stroke: #fff; fill: none; stroke-width: 2; }

  .auth-shell .eyebrow {
    font-family: var(--font-body), system-ui, sans-serif; font-size: 10px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-mute); display: flex; align-items: center;
    justify-content: center; gap: 7px; margin-bottom: 10px;
  }
  .auth-shell .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brass); }
  .auth-shell .title { font-family: var(--font-display), system-ui, sans-serif; font-weight: 600; font-size: 27px; margin: 0 0 8px; letter-spacing: -.01em; color: var(--ink); }
  .auth-shell .sub { color: var(--ink-mute); font-size: 13.5px; line-height: 1.5; margin: 0; }

  .auth-shell form { margin: 0; }
  .auth-shell .field { margin-bottom: 16px; }
  .auth-shell .field label {
    display: block; font-size: 12.5px; font-weight: 600; margin-bottom: 7px; color: var(--ink);
  }
  .auth-shell .field input {
    width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 9px;
    background: var(--paper-raised); font-size: 14px; font-family: var(--font-body), system-ui, sans-serif; color: var(--ink);
    transition: border-color .18s ease, box-shadow .18s ease;
  }
  .auth-shell .field input::placeholder { color: #9C8CA3; }
  .auth-shell .field input:hover { border-color: #9C8CA3; }
  .auth-shell .field input:focus { outline: none; border-color: var(--brass); box-shadow: 0 0 0 3px rgba(46,27,51,0.12); }
  .auth-shell .field .hint { margin: 6px 0 0; font-size: 12px; color: var(--ink-mute); }

  .auth-shell .form-error {
    background: rgba(179,38,30,0.10); border: 1px solid rgba(179,38,30,0.28);
    color: #B3261E; border-radius: 9px; padding: 10px 14px; font-size: 13px; font-weight: 500; margin-bottom: 16px;
  }

  .auth-shell .btn-signin {
    width: 100%; background: var(--brass); color: #fff; border: none; padding: 13px; border-radius: 9px;
    font-size: 14.5px; font-weight: 600; cursor: pointer; margin-top: 6px;
    box-shadow: 0 4px 12px rgba(46,27,51,0.28); transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
    font-family: var(--font-body), system-ui, sans-serif;
  }
  .auth-shell .btn-signin:hover { background: var(--brass-deep); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(46,27,51,0.35); }
  .auth-shell .btn-signin:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(46,27,51,0.3); }
  .auth-shell .btn-signin:disabled { opacity: .6; cursor: not-allowed; transform: none; box-shadow: none; }

  .auth-shell .security-note {
    display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 26px;
    font-family: var(--font-body), system-ui, sans-serif; font-size: 10.5px; color: var(--ink-mute); letter-spacing: .03em;
  }
  .auth-shell .security-note svg { width: 12px; height: 12px; stroke: var(--ink-mute); fill: none; stroke-width: 2; }
`;
