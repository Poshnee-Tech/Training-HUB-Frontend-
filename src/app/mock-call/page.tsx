'use client';

/**
 * Practice call — the final gated stage.
 *
 * Previously this was the dashboard's headline action, available from
 * day one. It now sits behind the Grand Test, and the customers it offers are
 * exactly the ones an admin assigned to this agent — which is what ties the
 * customer-assignment feature to the training sequence.
 *
 * The call itself still runs on the existing /call page; this page is the gate
 * and the customer picker in front of it. Session-start dispatch mirrors
 * /scenarios so both entry points behave identically.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, PhoneCall, UserRound, Users } from 'lucide-react';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { calls, journey as journeyApi, sessions, type JourneyStage } from '@/lib/api';
import { difficultyLabel, productLabel } from '@/lib/labels';
import { getCampaignColor, getDifficultyColor } from '@/lib/utils';

export default function MockCallPage() {
  const router = useRouter();
  const { token, loadFromStorage } = useAuthStore();

  const [stage, setStage] = useState<JourneyStage | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await journeyApi.mockCall(token);
      setStage(res.data.stage);
      setCustomers(res.data.customers);
      setLockMessage(null);
    } catch (err: any) {
      // A 403 here is the gate doing its job, not a failure — the server's
      // message already explains which stage must be passed first.
      setLockMessage(err.message || 'This stage is locked');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function startCall(assignment: any) {
    if (!token) return;
    setStartingId(assignment.id);
    setError(null);
    try {
      if (assignment.flowType === 'DUAL' && assignment.agentRole === 'FRONTER') {
        const res = await calls.startFronter(token, assignment.id);
        router.push(`/call?sessionId=${res.data.session.id}&callId=${res.data.call.id}`);
      } else if (assignment.flowType === 'DUAL' && assignment.agentRole === 'VERIFIER') {
        if (!assignment.callId) {
          setError('No call is ready for verification yet. The fronter must complete and transfer their call first.');
          return;
        }
        const res = await calls.startVerifier(token, assignment.callId, assignment.id);
        router.push(`/call?sessionId=${res.data.session.id}&callId=${assignment.callId}`);
      } else {
        const res = await sessions.start(token, assignment.id);
        router.push(`/call?sessionId=${res.data.id}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStartingId(null);
    }
  }

  return (
    <TrainingFloorShell>
      <main className="mx-auto w-full max-w-[1600px] p-4 sm:px-8 lg:px-12 lg:py-8">
        <div className="mx-auto max-w-4xl">
          <header className="mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <PhoneCall className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Practice call</h1>
                <p className="mt-0.5 text-gray-500">Practise a real call with the customers your trainer picked for you.</p>
              </div>
            </div>
          </header>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            </div>
          ) : lockMessage ? (
            <div className="card py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <Lock className="h-5 w-5 text-gray-400" aria-hidden />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-gray-900">Not unlocked yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">{lockMessage}</p>
              <Link href="/dashboard" className="btn-primary mt-6 inline-flex">Back to my plan</Link>
            </div>
          ) : customers.length === 0 ? (
            <div className="card py-16 text-center">
              <Users className="mx-auto h-10 w-10 text-gray-300" aria-hidden />
              <h2 className="mt-4 font-semibold text-gray-900">No customers assigned yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                You&apos;ve unlocked practice calls, but your trainer hasn&apos;t assigned you any
                customers. Ask them to assign one and this page will fill in.
              </p>
              <button onClick={load} className="btn-secondary mt-6">Check again</button>
            </div>
          ) : (
            <>
              {stage?.status === 'PASSED' && (
                <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
                  You&apos;ve completed this stage — you can keep practising as often as you like.
                </p>
              )}

              {error && (
                <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
              )}

              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Your customers ({customers.length})
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                {customers.map((assignment) => {
                  const s = assignment.scenario;
                  return (
                    <article key={assignment.id} className="card flex flex-col">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                          <UserRound className="h-5 w-5" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate font-semibold text-gray-900">{s.personaName}</h2>
                          <p className="truncate text-sm text-gray-500">{s.name}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className={`badge ${getCampaignColor(s.campaign)}`}>{productLabel(s.campaign)}</span>
                        <span className={`badge ${getDifficultyColor(s.difficulty)}`}>{difficultyLabel(s.difficulty)}</span>
                        {s.personaAge && <span className="badge bg-gray-100 text-gray-700">Age {s.personaAge}</span>}
                      </div>

                      {s.description && (
                        <p className="mt-3 line-clamp-3 text-sm text-gray-600">{s.description}</p>
                      )}

                      <button
                        onClick={() => startCall(assignment)}
                        disabled={startingId !== null}
                        className="btn-primary mt-4 w-full"
                      >
                        {startingId === assignment.id ? 'Starting…' : 'Start practice call'}
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>
    </TrainingFloorShell>
  );
}
