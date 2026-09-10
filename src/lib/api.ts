const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const COOKIE_AUTH_MARKER = '__cookie_auth__';

/**
 * This portal's name, sent on EVERY request as `X-Portal`.
 *
 * The backend names the session cookie after it (`callsim_auth_agent`) so the
 * agent and admin portals can hold two sessions in one browser. A login also
 * CLEARS the legacy shared `callsim_auth`, so a request that omits this header
 * has no cookie the backend will look for: it 401s and the app logs itself out.
 * That is why this lives at the fetch boundary and not in one helper.
 */
const PORTAL = 'agent';

interface ApiOptions {
  method?: string;
  body?: any;
  /**
   * Bearer token for non-cookie clients (legacy paths, tests).
   * Browser clients should rely on the httpOnly auth cookie set at /api/auth/login.
   */
  token?: string;
}

// Guard so multiple simultaneous 401s only trigger one logout+redirect
let logoutInProgress = false;

function handleUnauthorized() {
  if (typeof window === 'undefined' || logoutInProgress) return;
  logoutInProgress = true;

  try { localStorage.removeItem('user'); localStorage.removeItem('token'); } catch {}

  if (!window.location.pathname.startsWith('/login')) {
    // Keep where they were so re-login drops them back on the same page (the
    // proxy already does this for full-page redirects; the in-app API
    // 401 path should behave the same instead of stranding them on a bare
    // /login).
    const returnTo = window.location.pathname + window.location.search;
    window.location.replace(`/login?next=${encodeURIComponent(returnTo)}`);
  }

  setTimeout(() => { logoutInProgress = false; }, 3000);
}

/**
 * The only place browser code may turn a token-shaped value into an auth
 * header. The normal browser session is the httpOnly cookie; the localStorage
 * value is only a truthy UI marker and must never leave the browser as a
 * bearer credential. Keeping this at the fetch boundary protects multipart,
 * blob and audio requests that cannot use the JSON request() helper.
 */
function sessionFetch(
  input: RequestInfo | URL,
  token: string | undefined,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  // Every request names its portal, or the backend falls back to the legacy
  // cookie name that login cleared and answers 401. Media, blob and multipart
  // callers reach the network here without going through request().
  headers.set('X-Portal', PORTAL);
  if (token === COOKIE_AUTH_MARKER) {
    // Defense in depth for callers migrating from the old raw-header pattern.
    headers.delete('Authorization');
  } else if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers, credentials: 'include' });
}

/** Cookie-aware fetch for protected non-JSON requests such as media and WAVs. */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  token: string | undefined,
  init: RequestInit = {},
): Promise<Response> {
  const res = await sessionFetch(input, token, init);
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Session expired. Please log in again.');
  }
  return res;
}

async function request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  // X-Portal is set for every request in sessionFetch, including the media and
  // multipart callers that never reach this helper.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const res = await sessionFetch(`${API_URL}${endpoint}`, token, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Login has no existing session to expire. Preserve the server's deliberate
  // pending/rejected/incorrect-credentials message instead of turning it into
  // the generic session-expired redirect used by protected API requests.
  if (res.status === 401 && endpoint === '/api/auth/login') {
    const failed = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(failed.error || 'Email or password is incorrect.');
  }

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Session expired. Please log in again.');
  }

  // 202 (registration) and 204 may have empty bodies — guard against parse failure.
  const text = await res.text();

  // Detect HTML / non-JSON responses (404 from Next.js, backend down, wrong
  // URL, proxy intercept). JSON.parse on these throws a useless
  // "Unexpected token '<'" that hides what actually went wrong; surface a
  // diagnostic message instead.
  const contentType = res.headers.get('content-type') || '';
  const looksLikeJson = contentType.includes('application/json') ||
    (text.length > 0 && (text[0] === '{' || text[0] === '['));
  if (text && !looksLikeJson) {
    const preview = text.slice(0, 80).replace(/\s+/g, ' ').trim();
    throw new Error(
      `API ${endpoint} returned ${res.status} non-JSON response (likely a 404 page or the backend is unreachable). First bytes: "${preview}"`,
    );
  }

  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`API ${endpoint} returned malformed JSON (${(err as Error).message})`);
  }

  if (!res.ok) {
    throw new Error(data.error || `API ${endpoint} failed with status ${res.status}`);
  }

  return data;
}

// ── Auth ─────────────────────────────────────────────────────
/**
 * Probe the httpOnly cookie for an existing session, without the 401 redirect
 * `request()` performs. Cookies are shared across ports but localStorage is
 * not, so a browser can hold a valid `callsim_auth` cookie alongside an empty
 * localStorage for this origin — signing in on the admin app does exactly
 * that. This lets the auth store rebuild the session instead of leaving every
 * page gated on a token that never arrives.
 *
 * Returns the user, or null when there is no usable session. Never redirects:
 * callers use it to ask a question, not to assert the user is signed in.
 */
export async function recoverSessionFromCookie(): Promise<any | null> {
  try {
    const res = await sessionFetch(`${API_URL}/api/auth/me`, undefined);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

export const auth = {
  login: (email: string, password: string) =>
    request<{ success: boolean; data: { user: any; token: string } }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  /**
   * Signup is three steps now, and every one of them is decided by the
   * server: ask for a code, prove you received it, then file the request.
   *
   * None of these create an account. A trainer approving the request is what
   * does that, which is why `signup` resolves with a message rather than a
   * session — there is nothing to sign in with yet.
   */
  requestSignupCode: (email: string) =>
    request<{ success: boolean; message: string }>(
      '/api/auth/signup/request-otp',
      { method: 'POST', body: { email } },
    ),

  verifySignupCode: (email: string, code: string) =>
    request<{ success: boolean }>(
      '/api/auth/signup/verify-otp',
      { method: 'POST', body: { email, code } },
    ),

  signup: (data: { email: string; password: string; firstName: string; lastName: string }) =>
    request<{ success: boolean; data: { id: string }; message: string }>(
      '/api/auth/signup',
      { method: 'POST', body: data },
    ),

  logout: () =>
    request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  /** Clears mustChangePassword for agents still on an admin-issued temp password. */
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      token,
    }),

  /**
   * Mint a single-use WebSocket auth ticket. Browser calls this before
   * opening the WS so the JWT never appears in a URL.
   */
  wsTicket: (sessionId: string, token?: string) =>
    request<{ success: boolean; data: { ticket: string; expiresIn: number } }>(
      '/api/auth/ws-ticket',
      { method: 'POST', body: { sessionId }, token }
    ),
};

// ── Sessions ─────────────────────────────────────────────────
export const sessions = {
  list: (token: string, params?: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined));
    const query = new URLSearchParams(clean).toString();
    return request<{ success: boolean; data: any[]; pagination: any }>(
      `/api/sessions?${query}`,
      { token }
    );
  },

  get: (token: string, id: string) =>
    request<{ success: boolean; data: any }>(`/api/sessions/${id}`, { token }),

  start: (token: string, assignmentId: string) =>
    request<{ success: boolean; data: any }>('/api/sessions/start', {
      method: 'POST',
      body: { assignmentId },
      token,
    }),

  /**
   * `fronterDisposition` is the trainee's own answer for how the call ended.
   * It is graded, not trusted — the engine's terminal record stays
   * authoritative and the server stores this beside it for comparison.
   */
  end: (token: string, id: string, fronterDisposition?: string) =>
    request<{ success: boolean; data: any }>(`/api/sessions/${id}/end`, {
      method: 'POST',
      token,
      ...(fronterDisposition ? { body: { fronterDisposition } } : {}),
    }),

  transcript: (token: string, id: string) =>
    request<{ success: boolean; data: any[] }>(`/api/sessions/${id}/transcript`, { token }),

  clearAll: (token: string) =>
    request<{ success: boolean; data: { cleared: number } }>('/api/sessions/clear-all', {
      method: 'POST', token,
    }),
};


// ── Assignments (agent-facing) ───────────────────────────────
export const assignments = {
  my: (token: string) =>
    request<{ success: boolean; data: any[] }>('/api/agents/my-assignments', { token }),
};

// ── Evaluations ──────────────────────────────────────────────
const evaluationWordAudioCache = new Map<string, string>();

export const evaluations = {
  get: (token: string, sessionId: string) =>
    request<{ success: boolean; data: any }>(`/api/evaluations/session/${sessionId}`, { token }),

  myStats: (token: string) =>
    request<{ success: boolean; data: any }>('/api/evaluations/my-stats', { token }),

  status: (token: string, sessionId: string) =>
    request<{ success: boolean; data: any }>(`/api/evaluations/session/${sessionId}/status`, { token }),

  retry: (token: string, sessionId: string) =>
    request<{ success: boolean; message: string }>(`/api/evaluations/session/${sessionId}/retry`, {
      method: 'POST',
      token,
    }),

  /** The trainee-channel slice for one Azure-aligned word in a call report. */
  voiceWordAudio: async (
    token: string,
    sessionId: string,
    atMs: number,
    durationMs: number,
  ): Promise<string> => {
    const params = new URLSearchParams({
      atMs: String(Math.max(0, Math.round(atMs))),
      durationMs: String(Math.max(1, Math.round(durationMs))),
    });
    const key = `${sessionId}?${params}`;
    const cached = evaluationWordAudioCache.get(key);
    if (cached) return cached;

    const res = await authenticatedFetch(
      `${API_URL}/api/evaluations/session/${sessionId}/voice-word?${params}`,
      token,
    );
    if (!res.ok) throw new Error(`Could not load your word audio (${res.status}).`);

    const objectUrl = URL.createObjectURL(await res.blob());
    evaluationWordAudioCache.set(key, objectUrl);
    return objectUrl;
  },
};

// ── Training ─────────────────────────────────────────────────
/**
 * Runtime settings, read-only from this portal.
 *
 * `agentReportDetail` decides whether a trainee's report shows the full QA
 * breakdown or the score alone. The SERVER withholds the fields either way —
 * this read only tells the page which of the two to draw, and why.
 */
export const settings = {
  get: (token: string) =>
    request<{ success: boolean; data: { agentReportDetail: boolean } }>('/api/settings', { token }),
};

export const training = {
  coachingTips: (token: string, sessionId: string) =>
    request<{ success: boolean; data: any[] }>(`/api/training/coaching/${sessionId}`, { token }),

  enrichedReport: (token: string, sessionId: string) =>
    request<{ success: boolean; data: any }>(`/api/training/report/${sessionId}`, { token }),
};

// ── Training journey ────────────────────────────────────────
// Sequential onboarding path. Separate from `training` above, which drives the
// older call-score curriculum — the two do not share state.
export const journey = {
  /** The whole journey map: every stage with its status, lock reason, blockers. */
  me: (token: string) =>
    request<{ success: boolean; data: JourneyMap }>('/api/journey/me', { token }),

  /**
   * Articles plus the narration an admin has published for this campaign. The
   * guides call this on mount to mark the stage visited, so the recordings ride
   * along on that request rather than costing a second one.
   */
  knowledge: (token: string, campaign: 'ACA' | 'MEDICARE') =>
    request<{
      success: boolean;
      data: {
        campaign: string;
        /** Topics an admin added; the guide has no bespoke screen for these. */
        sections: { key: string; label: string; sortOrder: number }[];
        /** Built-in topics an admin has taken out of the guide. */
        hiddenSections: string[];
        /** Built-in topics an admin has renamed, keyed by section id. */
        renamedSections: Record<string, string>;
        articles: KnowledgeArticle[];
        recordings: KnowledgeRecording[];
        /**
         * The three-question Quick Check under each topic, keyed by topic.
         *
         * Correct answers are included, unlike the gated quiz endpoint: a Quick
         * Check is ungraded, marked in the browser, and records no attempt.
         * `correct` is -1 when an admin saved a question with no option marked.
         */
        quickChecks: Record<string, { q: string; opts: string[]; correct: number; why: string }[]>;
        /**
         * The topic list — label, listing blurb, icon name and order. Admin-owned,
         * so renaming or reordering a topic is no longer a code change.
         */
        topics: { key: string; label: string; blurb: string | null; icon: string | null; sortOrder: number }[];
        /**
         * The screens themselves: blocks[topicKey][kind] is that shape's items,
         * in admin order. See the backend's knowledge-blocks kind registry for
         * the fields each kind carries.
         */
        blocks: Record<string, Record<string, Record<string, unknown>[]>>;
      };
    }>(`/api/journey/knowledge/${campaign}?_=${Date.now()}`, { token }),

  /** Narration bytes, proxied by the API like clip media. */
  recordingMediaUrl: (recordingId: string) =>
    `${API_URL}/api/journey/knowledge/recordings/${recordingId}/media`,

  getQuiz: (token: string, slug: string) =>
    request<{ success: boolean; data: QuizPaper }>(`/api/journey/quiz/${slug}`, { token }),

  submitQuiz: (token: string, slug: string, answers: QuizSubmission[]) =>
    request<{ success: boolean; data: QuizResult }>(`/api/journey/quiz/${slug}/submit`, {
      method: 'POST',
      body: { answers },
      token,
    }),

  mockCall: (token: string, slug = 'mock-call') =>
    request<{ success: boolean; data: { stage: JourneyStage; customers: any[] } }>(
      `/api/journey/mock-call/${slug}`,
      { token },
    ),

  /** The sections an admin has published, in the order they arranged them. */
  clipCategories: (token: string) =>
    request<{ success: boolean; data: ClipCategory[] }>('/api/journey/clip-categories', { token }),

  /** `category` is a section SLUG. Omit it for every clip across all sections. */
  clips: (token: string, category?: string) => {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';
    return request<{ success: boolean; data: Clip[] }>(`/api/journey/clips${query}`, { token });
  },

  /** Clip bytes are proxied by the API, so this stays a same-origin-safe path. */
  clipMediaUrl: (clipId: string) => `${API_URL}/api/journey/clips/${clipId}/media`,
};

export type StageStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  /** Submitted, but written answers are still with a marker. */
  | 'AWAITING_REVIEW'
  | 'PASSED'
  | 'FAILED';
export type StageKind = 'KNOWLEDGE' | 'QUIZ' | 'MOCK_CALL' | 'CLIPS_LIBRARY';

export interface JourneyStage {
  id: string;
  slug: string;
  kind: StageKind;
  title: string;
  description: string;
  sortOrder: number;
  alwaysAvailable: boolean;
  knowledgeCampaign: 'ACA' | 'MEDICARE' | null;
  quizId: string | null;
  status: StageStatus;
  locked: boolean;
  lockReason: string | null;
  blockers: string[];
  attemptsUsed: number;
  attemptsAllowed: number | null;
  attemptsRemaining: number | null;
  bestScorePct: number | null;
  passThresholdPct: number | null;
  completedAt: string | null;
}

export interface JourneyMap {
  journeyId: string;
  journeyName: string;
  stages: JourneyStage[];
  nextStageSlug: string | null;
  completedCount: number;
  gatedCount: number;
}

export interface KnowledgeArticle {
  id: string;
  slug: string;
  /** Guide topic this reads under, or null for the campaign's general list. */
  sectionKey: string | null;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  sortOrder: number;
  updatedAt: string;
}

/**
 * Narration attached to a knowledge guide, uploaded from the admin portal.
 * There is no URL on it — bytes come from `recordingMediaUrl(id)`, so the
 * storage key never reaches the client.
 */
export interface KnowledgeRecording {
  id: string;
  /** Guide section this plays on, or null to appear in the campaign's list. */
  sectionKey: string | null;
  title: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  sortOrder: number;
  updatedAt: string;
}

export interface QuizPaper {
  stageSlug: string;
  quizId: string;
  title: string;
  description: string;
  passThresholdPct: number;
  attemptsUsed: number;
  attemptsAllowed: number | null;
  attemptsRemaining: number | null;
  /**
   * The paper's labeled parts, in order. A Grand Test is typically
   * multiple choice, written questions, then one or more mock call
   * scenarios; quizzes without a scenario pool just get one section.
   */
  sections: Array<{
    key: 'multiple-choice' | 'written' | 'scenario';
    title: string;
    /** On scenario sections: the call script the agent must read first. */
    scenarioTag?: string;
    scenarioTitle?: string;
    scenarioNarrative?: string;
  }>;
  questions: Array<{
    id: string;
    /** MULTIPLE_CHOICE carries options; WRITTEN carries line counts instead. */
    kind: QuizQuestionKind;
    prompt: string;
    points: number;
    sortOrder: number;
    minLines: number | null;
    maxLines: number | null;
    /** Which of `sections` this question belongs to. */
    sectionKey: 'multiple-choice' | 'written' | 'scenario';
    scenarioTag?: string | null;
    /** Set on scenario questions — the set's title and call script. */
    scenarioTitle?: string | null;
    scenarioNarrative?: string | null;
    /**
     * Custom paper heading. A change of heading starts a new section, so the
     * runner compares this between adjacent questions to know when to print
     * the next `sections` header (the Grand Test labels its Medicare MCQs and
     * the block of written questions this way).
     */
    heading?: string | null;
    options: Array<{ id: string; text: string }>;
  }>;
}

export type QuizQuestionKind = 'MULTIPLE_CHOICE' | 'WRITTEN';

export interface QuizSubmission {
  questionId: string;
  selectedOptionId?: string | null;
  /** The agent's prose on a written question. */
  answerText?: string | null;
}

/**
 * The outcome of a submission.
 *
 * Every score field is nullable because a paper with written questions has no
 * score at submission — a person has to read it first. `pendingReview` is the
 * flag to branch on; the numbers are only meaningful once it is false.
 */
export interface QuizResult {
  attemptId: string;
  pendingReview: boolean;
  /** How many written answers are queued for marking. */
  awaitingMarks: number;
  scorePct: number | null;
  pointsEarned: number | null;
  pointsPossible: number | null;
  passed: boolean | null;
  passThresholdPct: number;
  journey: JourneyMap;
}

/**
 * A clip section, as configured by an admin.
 *
 * There is no union of known section names here on purpose: sections are rows
 * in the database that admins create and rename, so the frontend renders
 * whatever the API returns rather than a list baked in at build time.
 */
export interface ClipCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  _count?: { clips: number };
}

export interface Clip {
  id: string;
  title: string;
  description: string | null;
  transcript: string | null;
  category: { id: string; slug: string; name: string };
  mimeType: string;
  durationSeconds: number | null;
  sizeBytes: number;
  createdAt: string;
}

// ── Calls (dual-agent flow) ─────────────────────────────────
export const calls = {
  startFronter: (token: string, assignmentId: string) =>
    request<{ success: boolean; data: any }>('/api/calls/start-fronter', {
      method: 'POST', body: { assignmentId }, token,
    }),
  transfer: (token: string, callId: string) =>
    request<{ success: boolean; data: any }>(`/api/calls/${callId}/transfer`, {
      method: 'POST', token,
    }),
  startVerifier: (token: string, callId: string, assignmentId: string) =>
    request<{ success: boolean; data: any }>(`/api/calls/${callId}/start-verifier`, {
      method: 'POST', body: { assignmentId }, token,
    }),
  closeSale: (token: string, callId: string) =>
    request<{ success: boolean; data: any }>(`/api/calls/${callId}/close-sale`, {
      method: 'POST', token,
    }),
  saleLost: (token: string, callId: string) =>
    request<{ success: boolean; data: any }>(`/api/calls/${callId}/sale-lost`, {
      method: 'POST', token,
    }),
  getChecklist: (token: string, callId: string) =>
    request<{ success: boolean; data: any }>(`/api/calls/${callId}/checklist`, { token }),
  updateChecklist: (token: string, callId: string, fields: Record<string, boolean>) =>
    request<{ success: boolean; data: any }>(`/api/calls/${callId}/checklist`, {
      method: 'PUT', body: { fields }, token,
    }),
};

// ── Pronunciation practice ───────────────────────────────────

export interface PracticeSentence {
  id: string;
  slug: string;
  text: string;
  hint: string | null;
  campaign: string | null;
}

/** One sound inside a word, as Azure scored it. */
export interface PracticePhoneme {
  Phoneme: string;
  PronunciationAssessment: { AccuracyScore: number; NBestPhonemes?: { Phoneme: string; Score: number }[] };
}

export interface PracticeWord {
  Word: string;
  /** 100-nanosecond ticks from the start of the recording — used to cut this
   *  word out of the agent's own audio for playback. */
  Offset: number;
  Duration: number;
  PronunciationAssessment: { AccuracyScore: number; ErrorType: string };
  Syllables?: { Syllable: string; Grapheme?: string; PronunciationAssessment: { AccuracyScore: number } }[];
  Phonemes?: PracticePhoneme[];
  /** Score after the marking curve, plus the weakest sound in the word. */
  marked: { strict: number; raw: number; hiddenError: boolean; worstPhoneme: { phoneme: string; score: number } | null } | null;
}

export interface PracticeScores {
  pronunciation: number;
  accuracy: number;
  fluency: number;
  prosody: number;
  completeness: number;
}

export interface PracticeResult {
  attemptId: string;
  sentence: { id: string; text: string };
  overall: PracticeScores;
  recognizedText: string;
  words: PracticeWord[];
  attemptsToday: number;
  /**
   * Null when no daily attempt cap is set at any scope — the backend's own
   * contract (`Backend/src/services/pronunciation/index.ts`). Typed `number`
   * here, the uncapped case rendered as "3/ attempts today".
   */
  dailyLimit: number | null;
}

export interface PracticeAttempt {
  id: string;
  sentenceId: string;
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  prosodyScore: number;
  completenessScore: number;
  recognizedText: string;
  createdAt: string;
  sentence: { text: string; slug: string };
}

/** IPA symbol -> plain-English respelling, e.g. dʒ -> { say: "j", as: "jump" }. */
export type PhonemeGuide = Record<string, { say: string; as: string; kind: string }>;

/** Object URLs by query string — a clip never changes, so it is fetched once. */
const audioCache = new Map<string, string>();

/**
 * How much practice this agent has left.
 *
 * `null` on a field means that cap is not set — there is no limit of that
 * kind, which is different from a limit of zero.
 */
export interface PracticeAllowance {
  allowed: boolean;
  /** Present only when blocked; safe to show verbatim. */
  message: string | null;
  blockedBy: { period: 'day' | 'month' | 'total'; measure: 'attempts' | 'minutes'; limit: number } | null;
  limits: {
    dailyAttemptLimit: number | null; dailyMinutesLimit: number | null;
    monthlyAttemptLimit: number | null; monthlyMinutesLimit: number | null;
    totalAttemptLimit: number | null; totalMinutesLimit: number | null;
  };
  usage: {
    day: { attempts: number; minutes: number; seconds: number };
    month: { attempts: number; minutes: number; seconds: number };
    total: { attempts: number; minutes: number; seconds: number };
  };
  remaining: {
    dailyAttempts: number | null; dailyMinutes: number | null;
    monthlyAttempts: number | null; monthlyMinutes: number | null;
    totalAttempts: number | null; totalMinutes: number | null;
  };
}

/** Pronunciation practice. Mirrors src/routes/pronunciation on the backend. */
export const pronunciation = {
  /**
   * This agent's own allowance. Computed by the same function that ENFORCES
   * the limit, so what is shown and what is applied cannot disagree.
   */
  allowance: (token: string) =>
    request<{ success: boolean; data: PracticeAllowance }>('/api/pronunciation/allowance', { token }),

  sentences: (token: string, campaign?: string) =>
    request<{ success: boolean; data: PracticeSentence[] }>(
      `/api/pronunciation/sentences${campaign ? `?campaign=${campaign}` : ''}`,
      { token },
    ),

  phonemes: (token: string) =>
    request<{ success: boolean; data: PhonemeGuide }>('/api/pronunciation/phonemes', { token }),

  attempts: (token: string, sentenceId?: string) =>
    request<{ success: boolean; data: PracticeAttempt[] }>(
      `/api/pronunciation/attempts${sentenceId ? `?sentenceId=${sentenceId}` : ''}`,
      { token },
    ),

  /**
   * One past take, with the same word / phoneme breakdown a fresh score
   * returns — the list endpoint leaves it out because it is ~7 KB per attempt
   * and only one is ever opened.
   */
  attempt: (token: string, id: string) =>
    request<{ success: boolean; data: PracticeResult & { createdAt: string } }>(
      `/api/pronunciation/attempts/${id}`,
      { token },
    ),

  /**
   * Upload one take for scoring. The shared request() helper is JSON-only, so
   * this posts the WAV as a raw body itself — the backend reads it straight
   * off the request rather than parsing multipart for a single file.
   */
  score: async (token: string, sentenceId: string, wav: Blob): Promise<PracticeResult> => {
    const res = await authenticatedFetch(`${API_URL}/api/pronunciation/sentences/${sentenceId}/attempts`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error || `Scoring failed (${res.status})`);
    return (data as any).data as PracticeResult;
  },

  /**
   * Reference audio, fetched with the session token and handed back as an
   * object URL.
   *
   * An <audio src> pointing straight at the endpoint cannot work: media
   * elements send no Authorization header, and the auth cookie is sameSite
   * lax so it does not ride along on a cross-origin subresource either — the
   * request arrives unauthenticated and 401s. Fetching it here also means a
   * clip is downloaded once per session however many times it is replayed.
   */
  audio: async (
    token: string,
    text: string,
    opts: { ipa?: string; rate?: number; voice?: 'female' | 'male' } = {},
  ): Promise<string> => {
    const params = new URLSearchParams({ text });
    if (opts.ipa) params.set('ipa', opts.ipa);
    if (opts.rate && opts.rate !== 1) params.set('rate', String(opts.rate));
    if (opts.voice) params.set('voice', opts.voice);

    const key = params.toString();
    const cached = audioCache.get(key);
    if (cached) return cached;

    const res = await authenticatedFetch(`${API_URL}/api/pronunciation/tts?${key}`, token);
    if (!res.ok) throw new Error(`Could not load the reference audio (${res.status}).`);

    const objectUrl = URL.createObjectURL(await res.blob());
    audioCache.set(key, objectUrl);
    return objectUrl;
  },
};
