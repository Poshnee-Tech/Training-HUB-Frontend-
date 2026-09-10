# Training Simulator — Agent Portal

The trainee-facing half of **CallSim**, a training platform for insurance
call-center agents. This is the "training floor": where an agent studies, sits
assessments, practises calls against an AI customer, and watches their own
scores move.

Next.js 16 · React 19 · Tailwind CSS · Zustand

> 📘 **Screen-by-screen walkthrough:** [USER_MANUAL.md](./USER_MANUAL.md).
> **System reference** — architecture, call flow, QA evaluation, voice pipeline,
> deployment — lives in the backend repository's `README.md`.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local
npm run dev            # http://localhost:3001
```

The backend must be running on `http://localhost:4000` first — see the
[backend repository](https://github.com/Poshnee-Tech/Training-Simulator-Backend-).

### Environment

```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
```

`NEXT_PUBLIC_*` values are inlined at build time, so changing one means
rebuilding rather than just restarting.

### Development sign-in

Seeded by `npm run db:seed` in the backend:

| Email | Password |
|---|---|
| `agent@callsim.com` | `agent123456` |

---

## User manual

### Signing in

Go to `http://localhost:3001`. Signing in sets an httpOnly cookie named for
this portal (`callsim_auth_agent`); that cookie is the credential for both the
API and the route guard. Browser JavaScript never holds a token — `localStorage`
keeps only a marker saying the cookie is in use. If you are bounced back to
`/login` while apparently signed in, the cookie has expired: sign in again.

### The layout

Every page renders inside one shell: a left sidebar grouped into **Training**
(My track, Study, Best clips) and **Progress** (Learning, Assignments, Reports),
and a topbar with the current page, line status, a dark/bright toggle and the
account menu. Below `lg` the sidebar lies down into a scrollable rail.

### Your track to going live

The dashboard's main column is the route to taking live calls. Stations unlock
in order and **the server decides every lock** — the portal only renders it.

| State | Meaning |
|---|---|
| **Cleared** | Passed. Revisit it any time |
| **You are here** | The station to do now |
| **With your trainer** | Handed in; written answers are being marked. Not re-openable |
| **Did not pass** | Retake it if you have attempts left |
| **Locked** | The button says *why*, e.g. "Pass the Grand Test to unlock this stage" |

Each station shows **best score**, **attempts**, **to pass** and **retakes
left**. A station you have never attempted reads "None yet", not `0%` — never
attempted is not the same as scored zero.

The track ends at **The Floor**. It is not a stage and nothing is gated behind
it; it is the marker for having earned your headset.

### Product knowledge

The ACA and Medicare modules **never lock**. Use them before a station or after
a rough attempt. Each card is a book — hover it (or tab to it) and the cover
swings open. Everything you need to choose a module is on the cover already; the
open is a flourish, never a gate on information.

### Best clips

Real calls from the agents setting the bar, grouped into sections your trainer
curates. Open a section to play any clip in place. One section opens at a time
and one audio element serves the whole list, so two clips can never overlap.

### Recent calls

Your last five sessions: persona, campaign, date, outcome and duration. A call
the evaluator has not reached yet reads **Unscored** — that is a call waiting in
the queue, not a call that scored zero. "View all" opens the full report list
with filters.

### The right rail

Stays with you as you scroll:

- **Next stop** — the station to do now, its pass mark and attempts left
- **Headset progress** — a ring plus the station checklist
- **Your learning so far** — sessions, average, best, calls this week

Numbers you have not earned yet say so in words rather than showing a zero.

### Themes and motion

The dark/bright toggle in the topbar is remembered per browser and applies
app-wide. All entrance animation respects `prefers-reduced-motion`.

---

## Project layout

```
src/
  app/                    routes (dashboard, clips, knowledge, quiz, mock-call, reports…)
  components/
    layout/               TrainingFloorShell — sidebar, topbar, theme
    dashboard/            SignalLine, StudyModules, BestClips, RecentCalls, RailCards
    knowledge/            guide renderers and audio notes
  lib/api.ts              the single API client
  store/                  Zustand auth, call and queue stores
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server on `:3000` |
| `npm run build` | Production build |
| `npm run start` | Serve the build |
| `npm run lint` | Lint |

## Troubleshooting

**Every panel says "could not load".** The browser was blocked before the
request left. Add `http://localhost:3001` to `CORS_ORIGINS` in the backend
`.env` and restart the backend.

**Signed in but redirected to `/login`.** The route guard reads the httpOnly
cookie, not localStorage. Sign in again.

More in [USER_MANUAL.md](./USER_MANUAL.md#12-troubleshooting).
