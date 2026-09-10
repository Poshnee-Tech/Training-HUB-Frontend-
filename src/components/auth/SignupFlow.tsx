'use client';

/**
 * Signing up, in three steps.
 *
 *   1. email      ask for a code
 *   2. code       prove the address is yours
 *   3. details    name and password, then the request goes to a trainer
 *
 * Shared by the landing page's modal and the sign-in page so there is one
 * implementation of the flow rather than two that drift.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 * It does not decide anything. The code is minted and checked on the server,
 * and the account does not exist until a trainer approves the request — this
 * is a form, not a gate. Skipping a step here would only mean the server
 * refuses the next call.
 *
 * Ends on a message rather than a session, because there is nothing to sign in
 * with yet.
 */

import { FormEvent, useState } from 'react';
import { auth } from '@/lib/api';

type Step = 'email' | 'code' | 'details' | 'done';

export default function SignupFlow({ onCancel }: { onCancel?: () => void }) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err: unknown) {
      setError((err as { message?: string }).message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      await auth.requestSignupCode(email.trim());
      setNote('');
      setStep('code');
    });
  };

  const checkCode = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await auth.verifySignupCode(email.trim(), code.trim());
      setStep('details');
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await auth.signup({
        email: email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      });
      setStep('done');
    });
  };

  const resend = () =>
    run(async () => {
      await auth.requestSignupCode(email.trim());
      setNote('A new code is on its way.');
    });

  if (step === 'done') {
    return (
      <div className="su-done">
        <div className="su-tick" aria-hidden>✓</div>
        <h3>Request sent</h3>
        <p>
          Your request is with the trainers. We will email <b>{email}</b> as
          soon as it is decided — either way.
        </p>
        {onCancel && (
          <button type="button" className="su-btn" onClick={onCancel}>
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="su">
      <ol className="su-steps" aria-label="Progress">
        {(['email', 'code', 'details'] as Step[]).map((s, i) => (
          <li
            key={s}
            className={step === s ? 'on' : i < ['email', 'code', 'details'].indexOf(step) ? 'past' : ''}
          >
            <span>{i + 1}</span>
            {s === 'email' ? 'Email' : s === 'code' ? 'Code' : 'Details'}
          </li>
        ))}
      </ol>

      {error && <p className="su-error" role="alert">{error}</p>}
      {note && !error && <p className="su-note">{note}</p>}

      {step === 'email' && (
        <form onSubmit={sendCode}>
          <label>
            Work email
            <input
              type="email"
              required
              autoFocus
              value={email}
              placeholder="agent@company.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <p className="su-hint">We will send a six-digit code to confirm it is yours.</p>
          <button type="submit" className="su-btn" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={checkCode}>
          <label>
            Six-digit code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={6}
              value={code}
              placeholder="000000"
              className="su-code"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <p className="su-hint">
            Sent to {email}. It expires in 15 minutes.
          </p>
          <button type="submit" className="su-btn" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <div className="su-links">
            <button type="button" onClick={resend} disabled={busy}>Send another</button>
            <button type="button" onClick={() => { setStep('email'); setCode(''); }} disabled={busy}>
              Change email
            </button>
          </div>
        </form>
      )}

      {step === 'details' && (
        <form onSubmit={submit}>
          <div className="su-two">
            <label>
              First name
              <input
                required
                autoFocus
                value={form.firstName}
                placeholder="Jane"
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </label>
            <label>
              Last name
              <input
                required
                value={form.lastName}
                placeholder="Diaz"
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </label>
          </div>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              placeholder="Minimum 8 characters"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <p className="su-hint">
            A trainer approves new accounts, so you will not be able to sign in
            straight away.
          </p>
          <button type="submit" className="su-btn" disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </form>
      )}
    </div>
  );
}
