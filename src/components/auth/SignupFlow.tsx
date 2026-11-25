'use client';

/**
 * Signing up, in one step (owner ruling 2026-11-25).
 *
 * Name, work email, role and password — the server creates the agent account
 * and signs them in, and they land on the dashboard. No emailed code and no
 * trainer approval any more.
 *
 * Shared by the landing page's modal and the sign-in page so there is one
 * implementation of the form rather than two that drift.
 *
 * WHAT THIS COMPONENT DOES NOT DECIDE
 * The server owns every rule: the role is always "agent", an address that
 * already has an account is refused, and the request is rate-limited. This is
 * a form, not a gate.
 */

import { FormEvent, useState } from 'react';
import { auth } from '@/lib/api';
import { TRACK_OPTIONS, type Track } from '@/lib/labels';
import { useAuthStore } from '@/store/auth.store';

export default function SignupFlow({ onCancel }: { onCancel?: () => void }) {
  const { login } = useAuthStore();
  const [form, setForm] = useState<{ firstName: string; lastName: string; email: string; password: string; track: Track | '' }>(
    { firstName: '', lastName: '', email: '', password: '', track: '' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!form.track) throw new Error('Choose your role.');
      const res = await auth.signup({
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        track: form.track,
      });
      login(res.data.user, res.data.token);
      // Hard navigation, as on the sign-in page: the proxy must see the
      // freshly-set auth cookie on the next request.
      window.location.assign('/dashboard');
    } catch (err: unknown) {
      setError((err as { message?: string }).message || 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="su">
      {error && <p className="su-error" role="alert">{error}</p>}

      <form onSubmit={submit}>
        <div className="su-two">
          <label>
            First name
            <input
              required
              autoFocus
              autoComplete="given-name"
              value={form.firstName}
              placeholder="Jane"
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </label>
          <label>
            Last name
            <input
              required
              autoComplete="family-name"
              value={form.lastName}
              placeholder="Diaz"
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </label>
        </div>
        <label>
          Work email
          <input
            type="email"
            required
            autoComplete="email"
            value={form.email}
            placeholder="agent@company.com"
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          Role
          <select
            required
            value={form.track}
            onChange={(e) => setForm({ ...form, track: e.target.value as Track | '' })}
          >
            <option value="" disabled>Choose your role</option>
            {TRACK_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            value={form.password}
            placeholder="Minimum 8 characters"
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <button type="submit" className="su-btn" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
        {onCancel && (
          <div className="su-links">
            <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        )}
      </form>
    </div>
  );
}
