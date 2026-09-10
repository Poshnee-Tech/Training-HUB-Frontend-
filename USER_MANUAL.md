# CallSim — User Manual

Complete operating guide for the Call Center Training Simulator: what the system
is, who uses it, how to run it, and what every screen and endpoint does.

This manual covers the **whole system**. A copy ships in each of the three
repositories so it is available wherever you are working. This copy lives in the
**agent portal** repository; see [Repository map](#2-repository-map) for the others.

---

## Table of contents

1. [What the system is](#1-what-the-system-is)
2. [Repository map](#2-repository-map)
3. [Roles and accounts](#3-roles-and-accounts)
4. [Running the system locally](#4-running-the-system-locally)
5. [The agent experience](#5-the-agent-experience)
6. [The admin experience](#6-the-admin-experience)
7. [Scoring and analytics](#7-scoring-and-analytics)
8. [Voice pipelines](#8-voice-pipelines)
9. [API reference](#9-api-reference)
10. [Data model](#10-data-model)
11. [Configuration reference](#11-configuration-reference)
12. [Troubleshooting](#12-troubleshooting)
13. [Glossary](#13-glossary)

---

## 1. What the system is

CallSim is a training platform for insurance call-center agents. A trainee holds
a spoken conversation with an AI customer, the call is transcribed and scored,
and an administrator sees where the floor is strong and weak.

The training path is **gated**. An agent does not get to practise live calls on
day one: they clear a study module, pass a quiz, pass a combined assessment, and
only then unlock the mock call. The server owns that gating — every client
merely renders the lock state it is given.

Three campaigns are supported end to end: **ACA** (Affordable Care Act
marketplace), **MEDICARE**, and **MED_ALERT** (medical alert devices).

---

## 2. Repository map

| Repository | Runs on | What it is |
|---|---|---|
| [Training-Simulator-Backend-](https://github.com/Poshnee-Tech/Training-Simulator-Backend-) | `:4000` | Express + Prisma API, WebSocket voice pipeline, evaluation engine |
| [Training-Simulator-Frontend-](https://github.com/Poshnee-Tech/Training-Simulator-Frontend-) | `:3000` | Agent portal — the "training floor" |
| [Training-Simulator-Admin-](https://github.com/Poshnee-Tech/Training-Simulator-Admin-) | `:3001` | Admin console — the "switchboard" |

Both front ends are Next.js 15 + React 19 + Tailwind. They share one design
token set (`air-*`) so the two products read as one system, and both support a
dark and a bright theme from a single variable swap.

**The backend is the only component that talks to the database.** Neither front
end holds business rules: locks, thresholds, scores and access policy are all
resolved server-side and sent down already decided.

---

## 3. Roles and accounts

| Role | Signs into | Can do |
|---|---|---|
| `AGENT` | Agent portal `:3000` | Study, take quizzes, run mock calls, see own reports |
| `ADMIN` | Admin console `:3001` | Everything below except super-admin user management |
| `SUPER_ADMIN` | Admin console `:3001` | All admin functions |

Both portals authenticate against the same `POST /api/auth/login`. The API
returns a JWT **and** sets an httpOnly `callsim_auth` cookie; the agent portal's
proxy uses the cookie as its route guard, and both portals send the JWT as
a bearer token on API calls.

### Seeded development accounts

`npm run db:seed` in the backend creates two accounts:

| Role | Email | Password |
|---|---|---|
| Super admin | `admin@callsim.com` | `admin123456` |
| Agent | `agent@callsim.com` | `agent123456` |

> These are development credentials defined in `prisma/seed.ts`. Change them
> before any deployment that is reachable from outside your machine.

---

## 4. Running the system locally

### Prerequisites

- Node.js 20+ (the repos are developed against Node 22–24)
- PostgreSQL 14+
- API keys for whichever providers your voice pipeline uses (Anthropic / OpenAI / Deepgram)

### First run

```bash
# 1. Backend
cd Training-Simulator-Backend-
npm install
cp .env.example .env          # then fill in DATABASE_URL, JWT_SECRET, provider keys
npx prisma migrate dev        # create the schema
npm run db:seed               # accounts + scenarios
npm run db:seed:journey       # the gated training track
npm run dev                   # http://localhost:4000

# 2. Agent portal
cd ../Training-Simulator-Frontend-
npm install
cp .env.local.example .env.local
npm run dev                   # http://localhost:3000

# 3. Admin console
cd ../Training-Simulator-Admin-
npm install
cp .env.local.example .env.local
npm run dev                   # http://localhost:3001
```

### Ports are not arbitrary

`CORS_ORIGINS` in the backend `.env` defaults to
`http://localhost:3000,http://localhost:3001`. If you run a front end on any
other port, its API calls fail with a CORS error and every panel renders its
"could not load" state. Add the port to `CORS_ORIGINS` and restart the backend.

### Health check

```bash
curl http://localhost:4000/health
```

---

## 5. The agent experience

The agent portal is one persistent layout — a left sidebar, a slim topbar, and
a workspace — reached at `http://localhost:3000/dashboard` after signing in.

### The track

The dashboard's main column is the agent's route to going live. Each station is
a card carrying its status, its rules, and its numbers:

| Station state | What the agent sees |
|---|---|
| **Cleared** | Gold node with a tick, "Revisit station" |
| **You are here** | Pulsing blue node, "Begin station" |
| **With your trainer** | Quiz handed in, written answers awaiting marking. Not re-openable |
| **Did not pass** | Red node; retake if attempts remain |
| **Locked** | Grey node, and the *reason* as the button label — e.g. "Pass the Grand Test to unlock this stage" |

Four figures sit on every station: **best score**, **attempts**, **to pass**, and
**retakes left**. A station that has never been attempted reads "None yet"
rather than `0%` — an ungraded station is not a failed one.

The track ends at **The Floor**, which is not a stage. It is the marker for
"you have earned your headset"; nothing is gated behind it.

### Study modules

Product-knowledge modules for ACA and Medicare **never lock**. They are always
available, before a station or after a bad attempt. Each renders as a book whose
cover swings open on hover (and on keyboard focus), with the module's topics
listed on the cover.

### Best clips

Real calls from strong agents, grouped into sections an administrator curates.
Open a section to play any clip in place. One section is open at a time and one
audio element serves the whole list, so two clips can never overlap.

### Recent calls

The agent's last five practice sessions with persona, campaign, date, outcome
and duration. A call the evaluator has not scored yet reads "Unscored", not 0%.

### The right rail

Persistent while the agent scrolls:

- **Next stop** — the station to do now, its pass mark, and attempts left
- **Headset progress** — a ring plus the station checklist
- **Your learning so far** — sessions, average score, best score, calls this week

---

## 6. The admin experience

`http://localhost:3001` after signing in as an admin.

| Section | What it is for |
|---|---|
| **Dashboard** | Floor-wide command centre: agent counts, team average, weakest category, leaderboards, calls awaiting a verifier |
| **Agents** | Enroll agents, edit profiles, reset passwords, toggle active state, inspect and reset an individual's journey |
| **Assign Customers** | Give agents the scenarios they will practise against |
| **Product Knowledge** | Author ACA/Medicare articles and upload narration audio |
| **Quizzes** | Build question banks and set pass marks and attempt limits |
| **Best Practice Clips** | Upload clips, organise them into sections, add transcripts |
| **Call History** | Every session, filterable by agent, campaign and status |
| **Recordings** | Stereo call recordings (trainee left, customer right), streamed behind admin auth |
| **Scenarios** | The AI customer personas — campaign, difficulty, mood, agenda |
| **Analytics** | Performance over time; see below |

### Resetting a stuck agent

A single-attempt quiz that an agent fails leaves them blocked. Under
**Agents → (agent) → journey**, clearing that stage restores the attempt. This
is the intended recovery path — do not edit the database by hand.

---

## 7. Scoring and analytics

### How a call is scored

After a call completes, the evaluation engine scores the transcript on an
overall figure plus five categories:

| Category | Field |
|---|---|
| Opening | `openingScore` |
| Communication | `communicationScore` |
| Objection handling | `objectionScore` |
| Product knowledge | `knowledgeScore` |
| Closing | `closingScore` |

Every score is 0–100. **80 is the target** across the product — the trend chart's
reference line, the tick on each category bar, and the "hitting the 80 target"
tile all use the same number.

Scoring is asynchronous. A completed call appears immediately with an "Unscored"
outcome and gains a score when the evaluation job finishes.

### The analytics page

All panels answer the same question for whatever slice the filter bar names.

**Filters** (one row, scoping everything below):

- **Campaign** — All / ACA / Medicare / Med alert
- **Agent** — a searchable picker; type any part of a first name, last name or
  email. Clear it with the × to return to the whole floor.

The two combine, so you can ask for "the whole floor", "ACA only", "one agent",
or "one agent on ACA". Changing scope holds the previous render at reduced
opacity rather than blanking the page.

**Panels:**

| Panel | Reads |
|---|---|
| Four tiles | Completed calls (all time), calls in the last 30 days, evaluations, share hitting 80 |
| Score trend | Daily average over 30 days, with a 7-day trailing line to follow |
| Strong and weak | The five categories as ranked bars, weakest first, with a 15-day-vs-15-day change |
| Call volume | Completed calls per day, so a score dip can be read against that day's workload |
| Campaign breakdown | Per campaign: weighted average and the practice mix across difficulty |

**Reading the charts honestly:**

- A day with no evaluations draws a **gap**, not a zero. Nobody was scored that
  day; that is not the same as everyone scoring nothing.
- A change figure stays blank ("Not enough data") unless both halves of the
  window carry at least three evaluations. A "+18 pts" built from one call
  either side is a coin flip wearing a trend's clothes.
- Days are bucketed in **UTC** across every panel, so the score trend and the
  volume chart line up.
- Every chart has a **Table** toggle. No number is reachable only by hovering.

---

## 8. Voice pipelines

The backend supports four voice architectures, selected with the
`VOICE_PIPELINE` environment variable. See the backend README for the full
comparison table.

| Value | Shape |
|---|---|
| `legacy` | Browser/Deepgram STT → your LLM → TTS. Cheapest, slowest |
| `deepgram_agent` | Deepgram's managed agent, Flux turn-taking |
| `custom_realtime` | In-house orchestration: pluggable STT, LLM and TTS |
| `custom_flux` | `custom_realtime` with Deepgram Flux for end-of-turn detection |

Changing pipeline requires a backend restart. Nothing in either front end
changes.

---

## 9. API reference

Base URL `http://localhost:4000`. Every route below `/api` except
`/api/auth/login` requires `Authorization: Bearer <jwt>`. Admin routes
additionally require the `ADMIN` or `SUPER_ADMIN` role.

### Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Returns `{ user, token }` and sets the `callsim_auth` cookie |

### Agent — journey

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/journey/me` | The agent's resolved track: stages, statuses, locks, `nextStageSlug` |
| GET | `/api/journey/knowledge/:campaign` | Articles plus published narration |
| GET | `/api/journey/quiz/:slug` | The quiz paper |
| POST | `/api/journey/quiz/:slug/submit` | Submit answers, get a result |
| GET | `/api/journey/clip-categories` | Clip sections |
| GET | `/api/journey/clips?category=` | Clips, optionally one section |

### Agent — sessions and results

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sessions` | The agent's own sessions; supports `campaign`, `status`, `search`, date and score filters, paginated |
| GET | `/api/evaluations/my-stats` | Totals, average, best, this week |
| GET | `/api/evaluations/session/:id` | One evaluation |

### Admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/dashboard` | Command-centre figures |
| GET | `/api/admin/agents` | List agents; `search`, `page`, `limit` |
| POST | `/api/admin/agents` | Enroll an agent |
| GET | `/api/admin/agents/:id/performance` | One agent's evaluations and per-campaign averages |
| GET | `/api/admin/agents/:id/journey` | Their resolved journey and attempts |
| POST | `/api/admin/agents/:id/journey/:stageId/reset` | Clear one stage result |
| GET | `/api/admin/calls` | Call history; `agentId`, `campaign`, `status` |
| GET | `/api/admin/recordings` | Recording index |
| GET | `/api/admin/recordings/:sessionId/audio` | Stream a recording |

### Admin — analytics

All three accept the same optional scope. Omit both parameters for floor-wide
numbers.

| Method | Path | Query |
|---|---|---|
| GET | `/api/admin/analytics/overview` | `campaign`, `agentId` |
| GET | `/api/admin/analytics/trends` | `campaign`, `agentId` |
| GET | `/api/admin/analytics/campaign/:campaign` | `agentId` |

`campaign` must be `ACA`, `MEDICARE` or `MED_ALERT`; `agentId` must be a UUID.
Anything else is rejected with a 400.

```bash
# The whole floor
curl -H "Authorization: Bearer $TOKEN" \
  localhost:4000/api/admin/analytics/overview

# One agent, on Medicare only
curl -H "Authorization: Bearer $TOKEN" \
  "localhost:4000/api/admin/analytics/overview?agentId=<uuid>&campaign=MEDICARE"
```

**Why the filters are server-side:** the completed-call count, category averages
and daily buckets are aggregated in SQL and never ship the rows they were
computed from. Filtering in the browser would have narrowed the evaluation list
and nothing else — a filter that silently applies to two panels out of five is
worse than no filter at all.

---

## 10. Data model

The Prisma schema (`prisma/schema.prisma`) is the source of truth. The tables
that matter day to day:

| Model | Holds |
|---|---|
| `User` | Accounts and roles |
| `AgentProfile` | Employee id, department, rolled-up totals |
| `Scenario` | An AI customer: campaign, difficulty, persona, mood, agenda |
| `Assignment` | Which scenarios an agent may practise |
| `Session` | One practice call: status, timings, `durationSeconds`, recording keys |
| `Message` | The turn-by-turn transcript |
| `Evaluation` | Overall plus the five category scores |
| `TrainingJourney` / `JourneyStage` | The gated track and its stations |
| `AgentJourneyProgress` / `AgentJourneyStageProgress` | Where each agent has got to |
| `Call` | Fronter/verifier pairing for dual-agent calls |

Enums: `Campaign` (ACA, MEDICARE, MED_ALERT), `Difficulty` (EASY, MEDIUM, HARD),
`SessionStatus` (WAITING, ACTIVE, COMPLETED, FAILED, CANCELLED), `StageStatus`
(LOCKED, AVAILABLE, IN_PROGRESS, AWAITING_REVIEW, PASSED, FAILED).

---

## 11. Configuration reference

### Backend `.env`

| Variable | Notes |
|---|---|
| `PORT` | Default 4000 |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Required. Change per environment |
| `JWT_EXPIRES_IN` | Token lifetime |
| `CORS_ORIGINS` | Comma-separated. Must list every front-end origin |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPGRAM_API_KEY` | Whichever your pipeline uses |
| `VOICE_PIPELINE` | `legacy` \| `deepgram_agent` \| `custom_realtime` \| `custom_flux` |
| `S3_*` | Recording storage; local disk is used when unset |

Pipeline-specific `CUSTOM_REALTIME_*`, `CUSTOM_FLUX_*` and `DEEPGRAM_AGENT_*`
variables are documented in `.env.example` and the backend README.

### Agent portal `.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
```

### Admin console `.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

> `NEXT_PUBLIC_*` values are inlined at **build** time. Changing one means
> rebuilding, not just restarting.

---

## 12. Troubleshooting

**"Could not load…" on every panel, nothing in the server log.**
A CORS rejection — the browser never sent the request. Check the front-end port
is listed in `CORS_ORIGINS` and restart the backend.

**`EADDRINUSE: address already in use :::4000`.**
Another backend is already running. Stop it, or change `PORT`.

**Agent is signed in but the page redirects to `/login`.**
The agent portal's route guard reads the httpOnly `callsim_auth` cookie, which
is separate from the JWT in localStorage. Signing in again restores both.

**A quiz is stuck on "With your trainer".**
Written answers await marking. The stage reopens once marked; that is by design,
not a lock to clear.

**Calls complete but never score.**
The evaluation worker is separate from the request path. Check the backend log
for the evaluation queue, and the dashboard's "Failed evaluations" tile.

**Analytics shows nothing for an agent you know has calls.**
Check the campaign filter — an agent with only Medicare calls shows nothing
under ACA. The footer line under the panels always states the active scope.

**Numbers differ between the admin dashboard and analytics.**
The dashboard is all-time and floor-wide; analytics is a rolling 30-day window
and obeys the filter bar.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Campaign** | Product line: ACA, Medicare, or Med alert |
| **Station** | One gated step on the agent's track |
| **The Floor** | Live calls — the end of the track, not a stage |
| **Fronter / verifier** | The two roles in a dual-agent call |
| **Persona** | The AI customer a scenario describes |
| **Scored / unscored** | Whether the evaluation job has run for a session |
| **Target** | 80 points — the pass line used across the product |
| **Window** | The rolling 30 days analytics reports on |
