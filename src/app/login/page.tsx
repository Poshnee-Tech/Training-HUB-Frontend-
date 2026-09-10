'use client';

import { useState } from 'react';
import { auth } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import SignupFlow from '@/components/auth/SignupFlow';

/**
 * Agent sign-in.
 *
 * The brand page — warm paper, plum, and a dark "switchboard" panel on
 * the left. Auth styling lives in this file's scoped <style> so nothing leaks
 * into the dashboard console or the light pages; the two fonts it uses are the
 * self-hosted next/font variables declared in src/app/layout.tsx.
 */

export default function LoginPage() {
  const { login } = useAuthStore();
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  });

  // Hard nav (not router.push) so the proxy sees the freshly-set
  // callsim_auth cookie on the next request, and to avoid the
  // OuterLayoutRouter invariant that fires when soft-routing during the
  // auth-state transition under React 19 strict mode. Same pattern as
  // src/app/page.tsx.
  const redirectAfterAuth = (mustChangePassword = false) => {
    // Agents enrolled by an admin arrive on a temporary password and are sent
    // to change it before anything else. `next` is preserved so they land where
    // they were heading once the change succeeds.
    if (mustChangePassword) {
      window.location.assign('/change-password');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
    window.location.assign(dest);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const res = await auth.login(form.email, form.password);
        login(res.data.user, res.data.token);
        redirectAfterAuth(Boolean(res.data.user?.mustChangePassword));
      } else {
        // Unreachable: the sign-up tab renders SignupFlow, which files an
        // approval request rather than creating an account. Kept as a guard
        // so this branch cannot quietly start creating sessions again.
        throw new Error('Use the sign-up form.');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError('');
  };

  return (
    <div className="auth-shell">
      <style>{authStyles}</style>
      <div className="split">
        <div className="brand-panel">
          <div className="patch-dots"><span></span><span></span><span></span></div>
          <div className="brand-row">
            {/* The brand mark. Fills and strokes are set per shape so they
                beat the inherited `stroke:#fff; fill:none` on .jack svg. */}
            <div className="jack">
              <svg viewBox="0 0 32 32">
                <path d="M7.5 17.5V15a8.5 8.5 0 0 1 17 0v2.5" fill="none" stroke="#F6F1F7" strokeWidth="2.6" strokeLinecap="round" />
                <rect x="4.8" y="16.4" width="5.4" height="9" rx="2.7" fill="#F6F1F7" stroke="none" />
                <rect x="21.8" y="16.4" width="5.4" height="9" rx="2.7" fill="#DE8A24" stroke="none" />
              </svg>
            </div>
            <div>
              <div className="name">Poshnee Training Hub</div>
              <div className="sub">Switchboard · Agent Portal</div>
            </div>
          </div>

          <div className="headline">AI-powered <em>call center</em> training</div>
          <div className="desc">
            Practice real-world conversations with AI customers. Get instant feedback and sharpen every line before it&apos;s live.
          </div>

          <div className="feature-list">
            <div className="feature">
              <div className="ic">
                <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.12.9.36 1.78.7 2.6a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.48-1.27a2 2 0 012.11-.45c.82.34 1.7.58 2.6.7A2 2 0 0122 16.92z" /></svg>
              </div>
              Realistic AI customer conversations
            </div>
            <div className="feature">
              <div className="ic">
                <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" /></svg>
              </div>
              Real-time voice interaction
            </div>
            <div className="feature">
              <div className="ic">
                <svg viewBox="0 0 24 24"><path d="M3 3v18h18M7 15l4-6 3 4 5-8" /></svg>
              </div>
              Detailed performance analytics
            </div>
          </div>

          <div className="panel-footer">
            <span className="live"><span className="dot"></span>Board live</span>
          </div>
        </div>

        <div className="form-panel">
          <div className="form-card">
            <div className="form-eyebrow"><span className="dot"></span>{isLogin ? 'Agent sign-in' : 'New agent'}</div>
            <h1 className="welcome-title">{isLogin ? 'Welcome back' : 'Create your account'}</h1>
            <div className="welcome-sub">{isLogin ? 'Sign in to continue training' : 'Get started with your training'}</div>

            {error && <div className="form-error">{error}</div>}

            {isLogin ? (
              <form onSubmit={handleSubmit} suppressHydrationWarning>
                {!isLogin && (
                  <div className="field-grid">
                    <div className="field">
                      <label>First Name</label>
                      <input
                        type="text"
                        required={!isLogin}
                        placeholder="Jane"
                        value={form.firstName}
                        onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                        suppressHydrationWarning
                      />
                    </div>
                    <div className="field">
                      <label>Last Name</label>
                      <input
                        type="text"
                        required={!isLogin}
                        placeholder="Doe"
                        value={form.lastName}
                        onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                        suppressHydrationWarning
                      />
                    </div>
                  </div>
                )}

                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    required
                    placeholder="agent@company.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    suppressHydrationWarning
                  />
                </div>

                <div className="field">
                  <div className="field-row-label">
                    <label>Password</label>
                    {isLogin && <a className="forgot" href="#">Forgot?</a>}
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Min. 8 characters"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    suppressHydrationWarning
                  />
                </div>

                <button type="submit" disabled={loading} className="btn-signin">
                  {loading ? 'Please wait…' : isLogin ? 'Sign In' : 'Create Account'}
                </button>
              </form>
            ) : (
              /* Signing up files a request for a trainer to approve, so it
                 cannot share the sign-in form — there is no session at the
                 end of it. Same component the landing page uses. */
              <SignupFlow />
            )}

            <div className="divider-row" style={{ marginTop: '20px' }}>
              <span className="line"></span>
              <span>{isLogin ? 'New here?' : 'Returning?'}</span>
              <span className="line"></span>
            </div>

            <div className="register-row">
              {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button type="button" onClick={toggleMode}>
                {isLogin ? 'Register' : 'Sign in'}
              </button>
            </div>

            <div className="security-note">
              <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              Secured session · encrypted in transit
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const authStyles = `
  .auth-shell {
    --paper:#FBF9F8; --paper-raised:#FFFFFF; --ink:#1E1520; --ink-mute:#6E6674;
    --line:#E4DCE6; --brass:#2E1B33; --brass-deep:#40284A; --brass-light:#DE8A24;
    --teal:#5A3A66; --gold:#DE8A24; --good:#406B4B;
    --shadow: 0 1px 2px rgba(46,27,51,0.06), 0 10px 30px rgba(46,27,51,0.10);
    box-sizing: border-box;
    color: var(--ink);
    font-family: var(--font-body), system-ui, sans-serif;
  }
  .auth-shell * { box-sizing: border-box; }
  .auth-shell .split { display: flex; min-height: 100vh; width: 100%; background: var(--paper); }

  /* ── LEFT PANEL ── */
  .auth-shell .brand-panel {
    width: 44%; flex-shrink: 0; min-width: 0; position: relative; overflow: hidden;
    background:
      radial-gradient(ellipse at 15% 10%, rgba(255,255,255,0.06), transparent 40%),
      radial-gradient(ellipse at 85% 90%, rgba(0,0,0,0.15), transparent 50%),
      linear-gradient(160deg, #5A3A66 0%, #40284A 60%, #2E1B33 100%);
    color: #F6F1F7; display: flex; flex-direction: column; justify-content: center;
    padding: 60px 64px;
  }
  .auth-shell .brand-panel::before {
    content: ""; position: absolute; inset: 0; opacity: .05; pointer-events: none;
    background-image: repeating-linear-gradient(0deg, transparent, transparent 27px, #fff 28px);
  }
  .auth-shell .patch-dots { position: absolute; top: 40px; right: 48px; display: flex; gap: 6px; }
  .auth-shell .patch-dots span { width: 6px; height: 6px; border-radius: 50%; background: rgba(246,241,247,0.25); }
  .auth-shell .patch-dots span:nth-child(1) { background: var(--brass-light); }

  .auth-shell .brand-row { display: flex; align-items: center; gap: 12px; margin-bottom: 38px; }
  .auth-shell .brand-row .jack {
    width: 40px; height: 40px; border-radius: 10px; background: var(--brass);
    display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(46,27,51,0.4);
  }
  .auth-shell .brand-row .jack svg { width: 19px; height: 19px; stroke: #fff; fill: none; stroke-width: 2; }
  .auth-shell .brand-row .name { font-family: var(--font-display), system-ui, sans-serif; font-weight: 600; font-size: 19px; }
  .auth-shell .brand-row .sub { font-family: var(--font-body), system-ui, sans-serif; font-size: 9px; letter-spacing: .14em; color: #C6B6CB; text-transform: uppercase; }

  .auth-shell .headline {
    font-family: var(--font-display), system-ui, sans-serif; font-weight: 600; font-size: 42px;
    line-height: 1.14; letter-spacing: -.01em; margin-bottom: 18px; max-width: 460px; color: inherit;
  }
  .auth-shell .headline em { font-style: italic; color: var(--brass-light); font-weight: 500; }
  .auth-shell .desc { font-size: 15px; line-height: 1.6; color: #C6B6CB; max-width: 420px; margin-bottom: 36px; }

  .auth-shell .feature-list { display: flex; flex-direction: column; gap: 14px; }
  .auth-shell .feature { display: flex; align-items: center; gap: 12px; font-size: 14px; color: #F4EFF4; }
  .auth-shell .feature .ic {
    width: 30px; height: 30px; border-radius: 8px; background: rgba(222,138,36,0.15); border: 1px solid rgba(222,138,36,0.35);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .auth-shell .feature .ic svg { width: 14px; height: 14px; stroke: var(--brass-light); fill: none; stroke-width: 2; }

  .auth-shell .panel-footer {
    position: absolute; bottom: 36px; left: 64px; display: flex;
    font-family: var(--font-body), system-ui, sans-serif; font-size: 10px; letter-spacing: .08em;
    color: #7A7080; text-transform: uppercase;
  }
  .auth-shell .panel-footer .live { display: flex; align-items: center; gap: 6px; }
  .auth-shell .panel-footer .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--good); animation: aes-pulse 2s ease-in-out infinite; }
  @keyframes aes-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

  /* ── RIGHT PANEL ── */
  .auth-shell .form-panel {
    flex: 1; min-width: 0; background: var(--paper); display: flex; align-items: center; justify-content: center;
    padding: 40px;
    backdrop-filter: blur(6px);
  }
  .auth-shell .form-card { width: 100%; max-width: 360px; animation: aes-fade-up .5s ease both; }
  @keyframes aes-fade-up {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .auth-shell .brand-panel .patch-dots,
  .auth-shell .brand-panel .brand-row,
  .auth-shell .brand-panel .headline,
  .auth-shell .brand-panel .desc,
  .auth-shell .brand-panel .feature-list,
  .auth-shell .brand-panel .panel-footer {
    animation: aes-fade-up .55s ease both;
  }
  .auth-shell .brand-panel .brand-row { animation-delay: .05s; }
  .auth-shell .brand-panel .headline { animation-delay: .12s; }
  .auth-shell .brand-panel .desc { animation-delay: .19s; }
  .auth-shell .brand-panel .feature-list { animation-delay: .26s; }
  .auth-shell .brand-panel .panel-footer { animation-delay: .36s; }
  .auth-shell .form-eyebrow {
    font-family: var(--font-body), system-ui, sans-serif; font-size: 10px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-mute); display: flex; align-items: center; gap: 7px; margin-bottom: 14px;
  }
  .auth-shell .form-eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brass); }
  .auth-shell .welcome-title { font-family: var(--font-display), system-ui, sans-serif; font-weight: 600; font-size: 29px; margin: 0 0 6px; letter-spacing: -.01em; color: var(--ink); }
  .auth-shell .welcome-sub { color: var(--ink-mute); font-size: 13.5px; margin-bottom: 26px; }

  .auth-shell .form-error {
    background: rgba(179,38,30,0.10); border: 1px solid rgba(179,38,30,0.28);
    color: #B3261E; border-radius: 9px; padding: 10px 14px; font-size: 13px; font-weight: 500; margin-bottom: 18px;
  }

  .auth-shell form { margin: 0; }
  .auth-shell .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .auth-shell .field { margin-bottom: 18px; }
  .auth-shell .field label {
    display: block; font-size: 12.5px; font-weight: 600; margin-bottom: 7px; color: var(--ink);
  }
  .auth-shell .field input {
    width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 9px;
    background: var(--paper-raised); font-size: 14px; font-family: var(--font-body), system-ui, sans-serif; color: var(--ink);
    transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
  }
  .auth-shell .field-grid .field input { padding: 12px 12px; font-size: 13.5px; }
  .auth-shell .field input::placeholder { color: #9C8CA3; }
  .auth-shell .field input:hover { border-color: #9C8CA3; }
  .auth-shell .field input:focus { outline: none; border-color: var(--brass); box-shadow: 0 0 0 3px rgba(46,27,51,0.12); }
  .auth-shell .field-row-label { display: flex; justify-content: space-between; align-items: center; }
  .auth-shell .field-row-label label { margin-bottom: 7px; }
  .auth-shell .forgot { font-size: 12px; color: var(--brass-deep); text-decoration: none; font-weight: 600; transition: opacity .15s ease; }
  .auth-shell .forgot:hover { opacity: .7; }

  .auth-shell .btn-signin {
    width: 100%; background: var(--brass); color: #fff; border: none; padding: 13px; border-radius: 9px;
    font-size: 14.5px; font-weight: 600; cursor: pointer; margin-top: 6px;
    box-shadow: 0 4px 12px rgba(46,27,51,0.28); transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
    font-family: var(--font-body), system-ui, sans-serif;
  }
  .auth-shell .btn-signin:hover { background: var(--brass-deep); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(46,27,51,0.35); }
  .auth-shell .btn-signin:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(46,27,51,0.3); }
  .auth-shell .btn-signin:disabled { opacity: .6; cursor: not-allowed; transform: none; box-shadow: none; }

  .auth-shell .divider-row { display: flex; align-items: center; gap: 12px; margin: 22px 0 18px; }
  .auth-shell .divider-row .line { flex: 1; height: 1px; background: var(--line); }
  .auth-shell .divider-row span:not(.line) {
    font-family: var(--font-body), system-ui, sans-serif; font-size: 10px; color: var(--ink-mute);
    letter-spacing: .06em; text-transform: uppercase;
  }

  .auth-shell .register-row { text-align: center; font-size: 13px; color: var(--ink-mute); }
  .auth-shell .register-row button { background: none; border: none; padding: 0; font: inherit; color: var(--brass-deep); font-weight: 600; cursor: pointer; transition: opacity .15s ease; }
  .auth-shell .register-row button:hover { opacity: .7; color: var(--brass); }

  .auth-shell .security-note {
    display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 26px;
    font-family: var(--font-body), system-ui, sans-serif; font-size: 10.5px; color: var(--ink-mute); letter-spacing: .03em;
  }
  .auth-shell .security-note svg { width: 12px; height: 12px; stroke: var(--ink-mute); fill: none; stroke-width: 2; }

  @media (max-width: 900px) {
    .auth-shell .form-panel { width: 100%; }
    .auth-shell .brand-panel { display: none; }
  }
`;
