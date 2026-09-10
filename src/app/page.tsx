'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SignupFlow from '@/components/auth/SignupFlow';

/* =========================================================
   PAGE CONTENT

   Kept above the component so the words can be edited without
   reading a line of layout.
========================================================= */

/**
 * The gated track, exactly as the journey is configured.
 *
 * Three locked stages — ACA Quiz, Grand Test, Mock Call — both quizzes at an
 * 80% pass mark. The study material and the clip library are marked
 * always-available in the same journey, so they are listed separately below
 * rather than counted as steps: an agent can open them at any point, including
 * before they start and after a failed attempt.
 */
const TRACK = [
  {
    kicker: 'Step one',
    title: 'ACA Quiz',
    body: 'A scored knowledge check on the ACA material. Pass mark is 80%. Nothing else opens until it is cleared.',
  },
  {
    kicker: 'Step two',
    title: 'Grand Test',
    body: 'ACA and Medicare together, also gated at 80%. Written answers go to a human marker, so a result can sit with your trainer before it counts.',
  },
  {
    kicker: 'Step three',
    title: 'Mock Call',
    body: 'A live call against the customers your trainer assigned you. Scored on the same five skills as everything that follows it.',
  },
];

/** Open the whole way through — not steps, and never locked. */
const ALWAYS_OPEN = [
  { title: 'ACA product knowledge', body: 'Plans, tiers, the ten essential benefits, eligibility.' },
  { title: 'Medicare product knowledge', body: 'Parts A to D, Advantage and Supplement, enrollment windows.' },
  { title: 'Best-practice clips', body: 'Recordings of real calls, sorted by what they demonstrate.' },
];

const AGENT_VALUE = [
  {
    icon: <PeopleIcon />,
    title: 'Customers, not scripts',
    body: 'Every scenario is a persona with a mood, a history and a reason to say no. Agents rehearse the call they are going to get, not a tidy version of it.',
  },
  {
    icon: <TargetIcon />,
    title: 'One scale, every call',
    body: 'Opening, communication, objection handling, product knowledge, closing. The same five skills scored the same way, so progress is comparable week to week.',
  },
  {
    icon: <FeedbackIcon />,
    title: 'Feedback on the transcript',
    body: 'Coaching lands against the words that were said, so an agent sees the moment a call turned — not a number at the end they cannot act on.',
  },
];

const HOW = [
  {
    title: 'Assign the customers',
    body: 'Pick which personas each agent practises against. New starters get the gentle ones; the ones close to going live get the difficult ones.',
  },
  {
    title: 'Let them run',
    body: 'Agents work the track on their own time. Nothing needs booking, and nobody sits in on a practice call.',
  },
  {
    title: 'Read the scores',
    body: 'Every finished call is scored across the five skills and lands in the trainer portal with the transcript attached.',
  },
  {
    title: 'Coach the weak spot',
    body: 'The portal shows the floor average per skill, so you can see whether it is one agent struggling or the whole team missing the same thing.',
  },
];

export default function LandingPage() {
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen]);


  return (
    <div className="landing-page">
      <style>{styles}</style>

      {/* ================= NAVBAR ================= */}

      <header className="navbar">
        <div className="nav-inner">
          <Link href="/" className="brand">
            <LogoMark />

            <div className="brand-text">
              <strong>Poshnee</strong>
              <span>TRAINING HUB</span>
            </div>
          </Link>

          <nav className="nav-links">
            <a href="#track">The track</a>
            <a href="#agents">What agents get</a>
            <a href="#how">How it works</a>
          </nav>

          <div className="nav-actions">
            <Link href="/login" className="signin">
              Sign in
            </Link>

            <button
              className="create-btn"
              onClick={() => setModalOpen(true)}
            >
              Create account
            </button>
          </div>
        </div>
      </header>

      {/* ================= HERO ================= */}

      <main>
        <section className="hero">
          <div className="hero-inner">

            {/* LEFT */}

            <div className="hero-copy">

              <div className="eyebrow-pill">
                <span className="spark">✦</span>
                The training floor for Poshnee agents
              </div>

              <h1>
                Nobody gets
                <br />
                on the phone
                <br />
                <span>before they’re ready.</span>
              </h1>

              <p className="hero-description">
                Agents practice realistic customer conversations,
                build five core skills, and earn their way to live calls.
              </p>

              <div className="hero-buttons">

                <button
                  className="primary-button"
                  onClick={() => setModalOpen(true)}
                >
                  Start training
                  <span>→</span>
                </button>

                <a href="#track" className="secondary-button">
                  <span className="play-button">▶</span>
                  See how it works
                </a>

              </div>

              <div className="hero-trust">

                <div className="trust-item">
                  <div className="trust-icon">
                    <ShieldIcon />
                  </div>

                  <div>
                    <strong>No installation</strong>
                    <span>Runs in your browser</span>
                  </div>
                </div>

                <div className="trust-item">
                  <div className="trust-icon">
                    <LockIcon />
                  </div>

                  <div>
                    <strong>Three products</strong>
                    <span>ACA, Medicare, Medical Alert</span>
                  </div>
                </div>

                <div className="trust-item">
                  <div className="trust-icon">
                    <ChartIcon />
                  </div>

                  <div>
                    <strong>Five skills</strong>
                    <span>Scored on every practice call</span>
                  </div>
                </div>

              </div>
            </div>

            {/* RIGHT DASHBOARD */}

            <div className="dashboard-wrap">

              <div className="dashboard">

                {/* SIDEBAR */}

                <aside className="dashboard-sidebar">

                  <div className="dashboard-brand">
                    <LogoMark />

                    <div>
                      <strong>Poshnee</strong>
                      <span>TRAINING HUB</span>
                    </div>
                  </div>

                  <div className="sidebar-section">
                    <small>LEARN</small>

                    <SidebarItem
                      icon={<WaveIcon />}
                      label="My plan"
                      active
                    />

                    <SidebarItem
                      icon={<BookIcon />}
                      label="Study"
                    />

                    <SidebarItem
                      icon={<MusicIcon />}
                      label="Example calls"
                    />
                  </div>

                  <div className="sidebar-section progress-section">
                    <small>YOUR PROGRESS</small>

                    <SidebarItem
                      icon={<ProgressIcon />}
                      label="My progress"
                    />

                    <SidebarItem
                      icon={<AssignmentIcon />}
                      label="Assignments"
                    />

                    <SidebarItem
                      icon={<HistoryIcon />}
                      label="Call history"
                    />
                  </div>

                  <div className="sidebar-user">
                    <div className="user-avatar">J</div>

                    <div>
                      <strong>John</strong>
                      <span>AGENT</span>
                    </div>

                    <span className="chevron">⌄</span>
                  </div>

                </aside>

                {/* MAIN DASHBOARD */}

                <div className="dashboard-content">

                  {/* DASHBOARD HEADER */}

                  <div className="dashboard-header">

                    <strong>My plan</strong>

                    <div className="profile-circle">
                      J
                      <span>⌄</span>
                    </div>

                  </div>

                  {/* WELCOME */}

                  <div className="dashboard-body">

                    <div className="dashboard-main">

                      <h2>
                        Welcome back, John.
                      </h2>

                      <h3>
                        <span>3 steps</span> left before you take real calls.
                      </h3>

                      <p className="dashboard-description">
                        Work through the list below. Finish a step and the
                        next one opens up.
                      </p>

                      <div className="training-title">
                        <div>
                          <strong>Your training plan</strong>
                          <span>
                            Finish each step to open the next one.
                            Study material stays open the whole way.
                          </span>
                        </div>

                        <small>3 STEPS TO FINISH</small>
                      </div>

                      {/* ACA */}

                      <TrainingCard
                        number="01"
                        title="ACA Quiz"
                        subtitle="Pass this to unlock the Grand Test."
                        active
                        badge="DO THIS NEXT"
                        score="None yet"
                        attempts="0"
                        pass="80%"
                        remaining="1"
                      />

                      {/* GRAND TEST */}

                      <TrainingCard
                        number="GT"
                        title="Grand Test"
                        subtitle="Combined ACA and Medicare assessment."
                        locked
                        badge="LOCKED"
                        score="None yet"
                        attempts="0"
                        pass="80%"
                        remaining="1"
                      />

                      {/* MOCK CALL */}

                      <TrainingCard
                        number="MC"
                        title="Mock Call"
                        subtitle="Practise a live call against the customers assigned to you."
                        locked
                        badge="LOCKED"
                        finalStep
                        score="None yet"
                        attempts="0"
                      />

                      {/* LIVE */}

                      <div className="live-card">

                        <div className="live-head">
                          <div className="headphone-circle">
                            <HeadphoneIcon />
                          </div>

                          <div>
                            <strong>Taking live calls</strong>
                            <span>Finish every step above and you’re ready to take real calls.</span>
                          </div>

                          <div className="not-yet">
                            NOT YET
                          </div>
                        </div>

                      </div>

                    </div>

                    {/* RIGHT SIDE */}

                    <aside className="dashboard-right">

                      <div className="next-card">

                        <span className="orange-label">
                          DO THIS NEXT
                        </span>

                        <h4>ACA Quiz</h4>

                        <p>
                          Pass this to unlock the Grand Test.
                        </p>

                        <div className="next-stat">
                          <span>Pass mark</span>
                          <strong>80%</strong>
                        </div>

                        <div className="next-stat">
                          <span>Attempts left</span>
                          <strong>1 of 1</strong>
                        </div>

                        <button>
                          Start the test
                          <span>→</span>
                        </button>

                        <div className="waveform">
                          {Array.from({ length: 28 }).map((_, i) => (
                            <i
                              key={i}
                              style={{
                                height: `${10 + ((i * 13) % 25)}px`,
                              }}
                            />
                          ))}
                        </div>

                      </div>

                      {/* PROGRESS */}

                      <div className="progress-card">

                        <div className="progress-top">

                          <div className="progress-ring">
                            <span>0%</span>
                          </div>

                          <div>
                            <strong>Your progress</strong>
                            <span>0 OF 3 STEPS DONE</span>
                          </div>

                        </div>

                        <div className="progress-list">

                          <ProgressRow
                            label="ACA Quiz"
                            active
                          />

                          <ProgressRow label="Grand Test" />

                          <ProgressRow label="Mock Call" />

                          <ProgressRow label="Taking live calls" />

                        </div>

                      </div>

                      {/* LEARNING */}

                      <div className="learning-card">

                        <h4>Your learning so far</h4>

                        <LearningStat
                          label="PRACTICE CALLS"
                          value="198"
                        />

                        <LearningStat
                          label="AVERAGE SCORE"
                          value="No scored calls yet"
                        />

                        <LearningStat
                          label="BEST SCORE"
                          value="No scored calls yet"
                        />

                        <LearningStat
                          label="THIS WEEK"
                          value="0 calls"
                        />

                      </div>

                    </aside>

                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* ================= FEATURES ================= */}

          <div className="feature-strip">

            <Feature
              icon={<PeopleIcon />}
              title="Realistic customers"
              text="AI customers with real objections, moods, and history."
            />

            <Feature
              icon={<TargetIcon />}
              title="5 core skills"
              text="Measured on every call the same way."
            />

            <Feature
              icon={<FeedbackIcon />}
              title="Feedback that sticks"
              text="Coaching on the exact moments that change the call."
            />

            <Feature
              icon={<CrownIcon />}
              title="Earn your calls"
              text="Prove it in 4 steps. Get on the phones with confidence."
            />

          </div>
        </section>

        {/* ================= THE TRACK ================= */}

        <section id="track" className="section section-alt">
          <div className="section-inner">

            <header className="section-head">
              <span className="section-eyebrow">THE TRACK</span>
              <h2>Three gates, in order.<br />Each one opens the next.</h2>
              <p>
                An agent cannot skip ahead. That is the whole point —
                the floor only ever sees people who have already done the work.
              </p>
            </header>

            <ol className="track-grid">
              {TRACK.map((step, i) => (
                <li key={step.title}>
                  <span className="track-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="track-kicker">{step.kicker}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="always-open">
              <h3>And these never lock</h3>

              <div className="always-grid">
                {ALWAYS_OPEN.map((item) => (
                  <div key={item.title}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* ================= WHAT AGENTS GET ================= */}

        <section id="agents" className="section">
          <div className="section-inner">

            <header className="section-head">
              <span className="section-eyebrow">WHAT AGENTS GET</span>
              <h2>Practice that resembles the job.</h2>
              <p>
                Not a quiz about calls. The call itself, with someone
                on the other end who has a reason to say no.
              </p>
            </header>

            <div className="agent-grid">
              {AGENT_VALUE.map((item) => (
                <article key={item.title}>
                  <div className="agent-icon">{item.icon}</div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>

          </div>
        </section>

        {/* ================= HOW IT WORKS ================= */}

        <section id="how" className="section section-dark">
          <div className="section-inner">

            <header className="section-head">
              <span className="section-eyebrow">HOW IT WORKS</span>
              <h2>What a trainer does all week.</h2>
              <p>
                Four things, and none of them is listening to recordings
                hoping to catch something.
              </p>
            </header>

            <div className="how-grid">
              {HOW.map((item, i) => (
                <article key={item.title}>
                  <span className="how-num">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>

          </div>
        </section>

        {/* ================= CLOSING ================= */}

        <section className="section closing">
          <div className="section-inner">
            <h2>Everything an agent needs before their first real call.</h2>
            <p>
              Study material, two scored assessments and as many practice
              calls as it takes — all in one place.
            </p>

            <div className="closing-buttons">
              <button className="primary-button" onClick={() => setModalOpen(true)}>
                Start training
                <span>→</span>
              </button>

              <Link href="/login" className="secondary-button">
                Sign in
              </Link>
            </div>
          </div>
        </section>

      </main>

      {/* ================= FOOTER ================= */}

      <footer className="site-footer">
        <div className="footer-inner">

          <div className="footer-brand">
            <Link href="/" className="brand">
              <LogoMark />

              <div className="brand-text">
                <strong>Poshnee</strong>
                <span>TRAINING HUB</span>
              </div>
            </Link>

            <p>
              Call training for insurance floors. Agents practise against
              simulated customers and earn their way to live calls.
            </p>
          </div>

          <nav className="footer-links">
            <div>
              <h4>Product</h4>
              <a href="#track">The track</a>
              <a href="#agents">What agents get</a>
              <a href="#how">How it works</a>
            </div>

            <div>
              <h4>Access</h4>
              <Link href="/login">Sign in</Link>
              <Link href="/change-password">Change password</Link>
            </div>
          </nav>

        </div>

        <div className="footer-legal">
          <span>&copy; 2026 Poshnee. All rights reserved.</span>
          <span>ACA, Medicare and Medical Alert.</span>
        </div>
      </footer>

      {/* ================= MODAL ================= */}

      {modalOpen && (
        <div
          className="modal-overlay"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >

            <button
              className="modal-close"
              onClick={() => setModalOpen(false)}
            >
              ×
            </button>

            <span className="modal-eyebrow">
              GET STARTED
            </span>

            <h2>Create your account</h2>

            <p>
              Confirm your email, then a trainer approves the account.
            </p>


            <SignupFlow onCancel={() => setModalOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}


/* =========================================================
   COMPONENTS
========================================================= */

function LogoMark() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 32 32"
      fill="none"
    >
      <path
        d="M7.5 17.5V15a8.5 8.5 0 0 1 17 0v2.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />

      <rect
        x="4.8"
        y="16.4"
        width="5.4"
        height="9"
        rx="2.7"
        fill="currentColor"
      />

      <rect
        x="21.8"
        y="16.4"
        width="5.4"
        height="9"
        rx="2.7"
        fill="#F79314"
      />
    </svg>
  );
}


function SidebarItem({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div className={`sidebar-item ${active ? 'active' : ''}`}>
      <span>{icon}</span>
      <strong>{label}</strong>
    </div>
  );
}


function TrainingCard({
  number,
  title,
  subtitle,
  active,
  locked,
  badge,
  finalStep,
  score,
  attempts,
  pass,
  remaining,
}: {
  number: string;
  title: string;
  subtitle: string;
  active?: boolean;
  locked?: boolean;
  badge?: string;
  finalStep?: boolean;
  score: string;
  attempts: string;
  pass?: string;
  remaining?: string;
}) {
  return (
    <div className={`training-card ${active ? 'training-active' : ''}`}>

      <div
        className={`training-number ${
          locked ? 'number-locked' : ''
        }`}
      >
        {number}
      </div>

      <div className="training-info">

        <div className="training-title-row">
          <strong>{title}</strong>

          {badge && (
            <span
              className={`training-badge ${
                active ? 'next-badge' : ''
              }`}
            >
              {badge}
            </span>
          )}

          {finalStep && (
            <span className="final-badge">
              FINAL STEP
            </span>
          )}
        </div>

        <p>{subtitle}</p>

        {active ? (
          <button className="step-button">
            Start this step
            <span>→</span>
          </button>
        ) : (
          <span className="locked-message">
            {title === 'Grand Test'
              ? 'Pass ACA Quiz to unlock this stage'
              : 'Pass Grand Test to unlock this stage'}
          </span>
        )}

      </div>

      <div className="training-stats">

        <div>
          <span>BEST SCORE</span>
          <strong>{score}</strong>
        </div>

        <div>
          <span>ATTEMPTS</span>
          <strong>{attempts}</strong>
        </div>

        {pass && (
          <div>
            <span>PASS MARK</span>
            <strong>{pass}</strong>
          </div>
        )}

        {remaining && (
          <div>
            <span>RETAKES LEFT</span>
            <strong>{remaining}</strong>
          </div>
        )}

      </div>
    </div>
  );
}


function ProgressRow({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <div className="progress-row">
      <span className={`progress-dot ${active ? 'active' : ''}`} />
      <span>{label}</span>
    </div>
  );
}


function LearningStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="learning-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="feature">

      <div className="feature-icon">
        {icon}
      </div>

      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>

    </div>
  );
}


/* =========================================================
   ICONS
========================================================= */

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l7 3v5c0 4.5-2.8 8.2-7 10-4.2-1.8-7-5.5-7-10V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}


function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 10V7a4 4 0 018 0v3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}


function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M5 19V9M12 19V5M19 19V2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}


function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12h3l2-6 4 12 2-7 2 4h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 15.5v-10z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M4 15.5A2.5 2.5 0 016.5 13H20"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}


function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M9 18V5l10-2v13"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="6.5"
        cy="18"
        r="3"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="16.5"
        cy="16"
        r="3"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}


function ProgressIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M4 19V5M4 19h17"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M7 15l4-4 3 2 5-7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


function AssignmentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="5"
        y="3"
        width="14"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M8 8h8M8 12h8M8 16h5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}


function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M4 12a8 8 0 108-8c-2.2 0-4.2.9-5.7 2.3L4 8.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M4 4v4.5h4.5M12 8v4l2.5 2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}


function HeadphoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M4 14v-2a8 8 0 0116 0v2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect
        x="3"
        y="13"
        width="4"
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect
        x="17"
        y="13"
        width="4"
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}


function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle
        cx="9"
        cy="8"
        r="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16 5.5a3 3 0 010 5.5M16 14c2.5.3 4 2 4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}


function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="8"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle
        cx="12"
        cy="12"
        r="4"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle
        cx="12"
        cy="12"
        r="1.5"
        fill="currentColor"
      />
      <path
        d="M18 6l3-3M18 6h-3M18 6v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}


function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="5"
        y="3"
        width="14"
        height="17"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 8h8M8 12h5M8 16h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M15 15l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M4 8l4 3 4-7 4 7 4-3-2 10H6L4 8z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7 21h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}


/* =========================================================
   CSS
========================================================= */

const styles = `

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
}

.landing-page {
  --plum: #24132d;
  --plum-dark: #1b1022;
  --purple: #654078;
  --purple-light: #744b87;
  --orange: #f79314;
  --orange-dark: #e8890d;
  --paper: #fcfaf9;
  --text: #17121a;
  --muted: #6e6471;
  --line: #e8e1e9;

  min-height: 100vh;
  background: var(--paper);
  color: var(--text);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  -webkit-font-smoothing: antialiased;
}

button,
input {
  font: inherit;
}

/* =========================================================
   NAV
========================================================= */

.navbar {
  height: 72px;
  background: var(--plum);
  color: white;
  border-bottom: 1px solid rgba(255,255,255,.08);
}

.nav-inner {
  max-width: 1536px;
  height: 100%;
  margin: auto;
  padding: 0 42px;

  display: flex;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;

  color: white;
  text-decoration: none;
}

.brand svg {
  width: 30px;
  height: 30px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1;
}

.brand-text strong {
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -.04em;
}

.brand-text span {
  margin-top: 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .13em;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 43px;

  margin-left: auto;
  margin-right: 34px;
}

.nav-links a {
  color: rgba(255,255,255,.92);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;

  transition: opacity .2s ease;
}

.nav-links a:hover {
  opacity: .7;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 11px;
}

.signin {
  height: 45px;
  padding: 0 25px;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid rgba(255,255,255,.5);
  border-radius: 999px;

  color: white;
  text-decoration: none;

  font-size: 14px;
  font-weight: 650;
}

.create-btn {
  height: 45px;
  padding: 0 27px;

  border: none;
  border-radius: 999px;

  background: var(--orange);
  color: var(--plum-dark);

  font-size: 14px;
  font-weight: 700;

  cursor: pointer;

  transition:
    transform .2s ease,
    background .2s ease;
}

.create-btn:hover {
  background: var(--orange-dark);
  transform: translateY(-1px);
}

/* =========================================================
   HERO
========================================================= */

.hero {
  padding: 38px 0 42px;
  background:
    radial-gradient(
      circle at 90% 18%,
      rgba(103,64,120,.08),
      transparent 35%
    ),
    var(--paper);
}

.hero-inner {
  max-width: 1450px;
  min-height: 690px;

  margin: 0 auto;
  padding: 0 44px;

  display: grid;
  grid-template-columns: 450px minmax(0, 1fr);
  align-items: center;

  gap: 34px;
}

/* =========================================================
   HERO COPY
========================================================= */

.hero-copy {
  position: relative;
  z-index: 3;
}

.eyebrow-pill {
  width: fit-content;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 9px 15px;

  border: 1px solid #e8e0e8;
  border-radius: 999px;

  background: white;

  color: #443a47;

  font-size: 13px;
  font-weight: 500;

  box-shadow: 0 5px 20px rgba(38,20,45,.035);
}

.spark {
  color: var(--orange);
  font-size: 18px;
  line-height: 1;
}

.hero h1 {
  margin: 39px 0 0;

  font-size: clamp(53px, 4.4vw, 70px);
  line-height: .99;

  letter-spacing: -.055em;
  font-weight: 800;
}

.hero h1 span {
  color: var(--purple);
}

.hero-description {
  max-width: 450px;

  margin-top: 29px;

  color: #6a606d;

  font-size: 17px;
  line-height: 1.58;
}

.hero-buttons {
  display: flex;
  align-items: center;
  gap: 14px;

  margin-top: 29px;
}

.primary-button,
.secondary-button {
  height: 49px;
  padding: 0 23px;

  border-radius: 999px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;

  font-size: 14px;
  font-weight: 700;

  cursor: pointer;
  text-decoration: none;

  transition:
    transform .2s ease,
    box-shadow .2s ease;
}

.primary-button {
  border: none;
  background: var(--orange);
  color: white;

  box-shadow:
    0 12px 25px rgba(247,147,20,.25);
}

.primary-button:hover {
  transform: translateY(-2px);
  box-shadow:
    0 16px 30px rgba(247,147,20,.3);
}

.primary-button span {
  font-size: 20px;
  line-height: 1;
}

.secondary-button {
  border: 1px solid #ded7df;
  background: white;
  color: #211a24;
}

.secondary-button:hover {
  transform: translateY(-2px);
}

.play-button {
  width: 22px;
  height: 22px;

  border: 1.5px solid #211a24;
  border-radius: 50%;

  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 7px;
  padding-left: 1px;
}

.hero-trust {
  display: flex;
  align-items: center;
  gap: 27px;

  margin-top: 62px;
}

.trust-item {
  display: flex;
  align-items: center;
  gap: 9px;
}

.trust-icon {
  width: 26px;
  height: 26px;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--plum);
}

.trust-icon svg {
  width: 24px;
  height: 24px;
}

.trust-item strong,
.trust-item span {
  display: block;
}

.trust-item strong {
  font-size: 10px;
  font-weight: 750;
}

.trust-item span {
  margin-top: 2px;
  color: #756b78;
  font-size: 9px;
}

/* =========================================================
   DASHBOARD
========================================================= */

.dashboard-wrap {
  min-width: 0;
  position: relative;
}

.dashboard {
  width: 100%;
  min-height: 655px;

  display: grid;
  grid-template-columns: 156px minmax(0, 1fr);

  overflow: hidden;

  border: 1px solid #ebe5ed;
  border-radius: 25px;

  background: white;

  box-shadow:
    0 28px 65px rgba(39,20,47,.13),
    0 3px 10px rgba(39,20,47,.04);
}

/* =========================================================
   SIDEBAR
========================================================= */

.dashboard-sidebar {
  position: relative;

  display: flex;
  flex-direction: column;

  padding: 22px 11px 14px;

  background:
    linear-gradient(
      180deg,
      #21132c 0%,
      #2c1839 100%
    );

  color: white;
}

.dashboard-brand {
  display: flex;
  align-items: center;
  gap: 7px;

  padding: 0 8px 27px;
}

.dashboard-brand svg {
  width: 29px;
  height: 29px;
}

.dashboard-brand div {
  display: flex;
  flex-direction: column;
  line-height: 1;
}

.dashboard-brand strong {
  font-size: 13px;
  font-weight: 800;
}

.dashboard-brand span {
  margin-top: 4px;
  font-size: 6.5px;
  letter-spacing: .13em;
  font-weight: 700;
}

.sidebar-section {
  margin-top: 1px;
}

.sidebar-section small {
  display: block;

  padding: 0 9px;
  margin-bottom: 8px;

  color: rgba(255,255,255,.45);

  font-size: 8px;
  font-weight: 600;
  letter-spacing: .13em;
}

.sidebar-item {
  height: 37px;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 0 10px;

  border-radius: 9px;

  color: rgba(255,255,255,.72);

  font-size: 10px;

  transition: background .2s ease;
}

.sidebar-item span {
  width: 17px;
  height: 17px;

  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-item svg {
  width: 16px;
  height: 16px;
}

.sidebar-item strong {
  font-size: 10px;
  font-weight: 550;
}

.sidebar-item.active {
  background: #573363;
  color: white;
}

.progress-section {
  margin-top: 26px;
}

.sidebar-user {
  margin-top: auto;

  min-height: 52px;

  display: flex;
  align-items: center;
  gap: 8px;

  padding: 8px 9px;

  border-radius: 11px;

  background: rgba(255,255,255,.1);
}

.user-avatar {
  width: 28px;
  height: 28px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;

  background: var(--orange);
  color: white;

  font-size: 12px;
  font-weight: 800;
}

.sidebar-user div:nth-child(2) {
  flex: 1;
}

.sidebar-user strong,
.sidebar-user span {
  display: block;
}

.sidebar-user strong {
  font-size: 10px;
}

.sidebar-user div span {
  color: rgba(255,255,255,.55);
  font-size: 7px;
  letter-spacing: .08em;
}

.chevron {
  font-size: 13px;
  color: rgba(255,255,255,.7);
}

/* =========================================================
   DASHBOARD MAIN
========================================================= */

.dashboard-content {
  min-width: 0;
  background: #fff;
}

.dashboard-header {
  height: 48px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: 0 23px;

  border-bottom: 1px solid #eee9ef;

  font-size: 10px;
}

.profile-circle {
  position: relative;

  width: 23px;
  height: 23px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;

  background: #21132c;
  color: white;

  font-size: 9px;
  font-weight: 700;
}

.profile-circle span {
  position: absolute;
  left: 28px;
  color: #201824;
}

.dashboard-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 205px;

  gap: 23px;

  padding: 27px 21px 21px 26px;
}

.dashboard-main {
  min-width: 0;
}

.dashboard-main h2 {
  margin: 0;

  font-size: 22px;
  line-height: 1.1;
  letter-spacing: -.04em;
}

.dashboard-main h3 {
  margin: 5px 0 0;

  font-size: 16px;
  line-height: 1.2;
  letter-spacing: -.03em;
}

.dashboard-main h3 span {
  color: var(--orange);
}

.dashboard-description {
  margin-top: 7px;

  color: #6d6470;

  font-size: 9.5px;
}

.training-title {
  margin-top: 25px;

  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.training-title strong,
.training-title span {
  display: block;
}

.training-title strong {
  font-size: 13px;
}

.training-title span {
  margin-top: 2px;
  color: #736a76;
  font-size: 8.5px;
}

.training-title small {
  color: #817683;
  font-size: 7px;
  font-weight: 650;
}

/* =========================================================
   TRAINING CARDS
========================================================= */

.training-card {
  position: relative;

  min-height: 76px;

  margin-top: 11px;
  padding: 13px 13px;

  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 173px;

  align-items: center;
  gap: 11px;

  border: 1px solid #e6e0e7;
  border-radius: 11px;

  background: #faf9fa;
}

.training-active {
  border-color: #ef9b37;
  background: white;

  box-shadow:
    0 4px 13px rgba(247,147,20,.06);
}

.training-number {
  width: 31px;
  height: 31px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;

  background: #24132d;
  color: white;

  font-size: 9px;
  font-weight: 750;
}

.number-locked {
  background: #e4dfe5;
  color: #8b818d;
}

.training-info {
  min-width: 0;
}

.training-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.training-title-row > strong {
  font-size: 11px;
}

.training-badge,
.final-badge {
  padding: 2px 6px;

  border: 1px solid #ddd4df;
  border-radius: 5px;

  color: #746b77;

  font-size: 6px;
  font-weight: 700;
  letter-spacing: .03em;
}

.next-badge {
  color: #756c76;
  background: #fff;
}

.final-badge {
  color: #716873;
}

.training-info p {
  max-width: 330px;

  margin: 2px 0 0;

  color: #6d6470;

  font-size: 8px;
  line-height: 1.35;
}

.step-button {
  height: 27px;

  margin-top: 8px;
  padding: 0 14px;

  border: none;
  border-radius: 999px;

  background: #29152f;
  color: white;

  font-size: 8px;
  font-weight: 700;

  cursor: pointer;
}

.step-button span {
  margin-left: 5px;
  font-size: 12px;
}

.locked-message {
  display: inline-block;

  margin-top: 7px;
  padding: 5px 9px;

  border: 1px solid #ddd6df;
  border-radius: 999px;

  color: #7a707d;

  font-size: 7px;
}

.training-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.training-stats div {
  min-width: 0;
}

.training-stats span,
.training-stats strong {
  display: block;
}

.training-stats span {
  color: #817783;
  font-size: 6px;
  white-space: nowrap;
}

.training-stats strong {
  margin-top: 3px;

  font-size: 8px;
  font-weight: 700;

  white-space: nowrap;
}

.live-card {
  margin-top: 11px;

  min-height: 54px;

  border: 1px dashed #dcd4df;
  border-radius: 10px;

  background: #fff;
}

.live-head {
  height: 54px;

  display: flex;
  align-items: center;
  gap: 9px;

  padding: 9px 13px;
}

.headphone-circle {
  width: 31px;
  height: 31px;

  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;

  background: #e7e2e8;
  color: #817883;
}

.headphone-circle svg {
  width: 17px;
  height: 17px;
}

.live-head strong,
.live-head span {
  display: block;
}

.live-head strong {
  font-size: 10px;
}

.live-head div:nth-child(2) span {
  margin-top: 2px;
  color: #817782;
  font-size: 7.5px;
}

.not-yet {
  margin-left: auto;

  color: #8b818d;

  font-size: 6.5px;
  font-weight: 700;
}

/* =========================================================
   RIGHT CARDS
========================================================= */

.dashboard-right {
  min-width: 0;
}

.next-card,
.progress-card,
.learning-card {
  border: 1px solid #e7e1e8;
  border-radius: 11px;

  background: white;

  box-shadow: 0 4px 13px rgba(38,20,45,.035);
}

.next-card {
  overflow: hidden;
}

.next-card > *:not(.waveform) {
  margin-left: 13px;
  margin-right: 13px;
}

.orange-label {
  display: block;

  padding-top: 14px;

  color: #d7770b;

  font-size: 6.5px;
  font-weight: 800;
  letter-spacing: .07em;
}

.next-card h4 {
  margin-top: 7px;
  margin-bottom: 0;

  font-size: 12px;
}

.next-card p {
  margin-top: 10px;

  color: #776d78;

  font-size: 7.5px;
  line-height: 1.4;
}

.next-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin-top: 9px;

  color: #766c78;

  font-size: 7px;
}

.next-stat strong {
  color: #27202a;
  font-size: 7px;
}

.next-card button {
  width: calc(100% - 26px);
  height: 28px;

  margin-top: 12px;

  border: none;
  border-radius: 999px;

  background: #29152f;
  color: white;

  font-size: 7.5px;
  font-weight: 700;

  cursor: pointer;
}

.next-card button span {
  margin-left: 8px;
  font-size: 11px;
}

.waveform {
  height: 54px;

  margin-top: 14px;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;

  border-top: 1px solid #eee8ef;

  background: #faf8fb;
}

.waveform i {
  width: 2px;

  border-radius: 4px;

  background: #714585;
}

/* PROGRESS */

.progress-card {
  margin-top: 13px;
  padding: 13px;
}

.progress-top {
  display: flex;
  align-items: center;
  gap: 10px;

  padding-bottom: 12px;

  border-bottom: 1px solid #eee8ef;
}

.progress-ring {
  width: 43px;
  height: 43px;

  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 4px solid #e8e2e9;
  border-radius: 50%;
}

.progress-ring span {
  font-size: 8px;
  font-weight: 650;
}

.progress-top strong,
.progress-top span {
  display: block;
}

.progress-top strong {
  font-size: 9px;
}

.progress-top span {
  margin-top: 3px;
  color: #837984;
  font-size: 6px;
  letter-spacing: .03em;
}

.progress-list {
  padding-top: 10px;
}

.progress-row {
  height: 23px;

  display: flex;
  align-items: center;
  gap: 8px;

  color: #6e6470;

  font-size: 7.5px;
}

.progress-dot {
  width: 10px;
  height: 10px;

  border: 1px solid #d9d1db;
  border-radius: 50%;
}

.progress-dot.active {
  position: relative;
  border-color: #2d1b34;
}

.progress-dot.active::after {
  content: "";

  position: absolute;
  inset: 2px;

  border-radius: 50%;

  background: #2d1b34;
}

/* LEARNING */

.learning-card {
  margin-top: 13px;
  padding: 13px;
}

.learning-card h4 {
  margin: 0 0 10px;

  font-size: 9px;
}

.learning-stat {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;

  padding: 8px 0;

  border-top: 1px solid #eee8ef;
}

.learning-stat span {
  color: #827884;
  font-size: 5.8px;
  font-weight: 600;
}

.learning-stat strong {
  max-width: 80px;

  text-align: right;

  color: #2a232d;

  font-size: 7px;
}

/* =========================================================
   FEATURE STRIP
========================================================= */

.feature-strip {
  max-width: 1370px;

  min-height: 94px;

  margin: 8px auto 0;
  padding: 0 18px;

  display: grid;
  grid-template-columns: repeat(4, 1fr);
  align-items: center;

  background: white;

  border: 1px solid #eee8ef;
  border-radius: 18px;

  box-shadow:
    0 10px 26px rgba(38,20,45,.05);
}

.feature {
  min-height: 58px;

  display: flex;
  align-items: center;
  gap: 17px;

  padding: 0 20px;

  border-right: 1px solid #e7e0e8;
}

.feature:last-child {
  border-right: none;
}

.feature-icon {
  width: 52px;
  height: 52px;

  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 14px;

  color: #643b82;
  background: #f2eafa;
}

.feature:nth-child(2) .feature-icon {
  color: #e14414;
  background: #fff0e7;
}

.feature:nth-child(3) .feature-icon {
  color: #338244;
  background: #eaf6eb;
}

.feature:nth-child(4) .feature-icon {
  color: #e29a00;
  background: #fff4d8;
}

.feature-icon svg {
  width: 23px;
  height: 23px;
}

.feature h3 {
  margin: 0;

  font-size: 13.5px;
  line-height: 1.2;
  letter-spacing: -.025em;
}

.feature p {
  max-width: 195px;

  margin: 4px 0 0;

  color: #716775;

  font-size: 11.5px;
  line-height: 1.5;
}

/* =========================================================
   ANCHORS
========================================================= */


/* =========================================================
   MODAL
========================================================= */

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;

  display: grid;
  place-items: center;

  padding: 20px;

  background: rgba(32,17,38,.64);

  backdrop-filter: blur(8px);
}

.modal-card {
  position: relative;

  width: 100%;
  max-width: 470px;

  padding: 34px;

  border: 1px solid #e5dfe7;
  border-radius: 20px;

  background: white;

  box-shadow: 0 35px 90px rgba(20,10,25,.3);
}

.modal-close {
  position: absolute;
  top: 13px;
  right: 13px;

  width: 34px;
  height: 34px;

  border: none;
  border-radius: 50%;

  background: transparent;

  color: #766d79;

  font-size: 21px;

  cursor: pointer;
}

.modal-close:hover {
  background: #f5f1f6;
}

.modal-eyebrow {
  color: #9a5b0b;

  font-size: 10px;
  font-weight: 800;
  letter-spacing: .15em;
}

.modal-card h2 {
  margin: 9px 0 0;

  font-size: 28px;
  letter-spacing: -.04em;
}

.modal-card > p {
  margin-top: 7px;

  color: #756b78;

  font-size: 14px;
}

.modal-error {
  margin-top: 17px;
  padding: 11px 13px;

  border: 1px solid #efc5c2;
  border-radius: 10px;

  background: #fff3f2;
  color: #a52821;

  font-size: 13px;
}

.modal-card form {
  margin-top: 22px;

  display: grid;
  gap: 14px;
}

.modal-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.modal-card label {
  display: grid;
  gap: 6px;

  color: #514752;

  font-size: 12px;
  font-weight: 650;
}

.modal-card input {
  width: 100%;
  height: 45px;

  padding: 0 13px;

  border: 1px solid #ded6e0;
  border-radius: 10px;

  outline: none;

  color: #241d27;
  background: white;

  font-size: 14px;
}

.modal-card input:focus {
  border-color: #704584;
  box-shadow: 0 0 0 3px rgba(112,69,132,.1);
}

.modal-submit {
  height: 48px;

  margin-top: 5px;

  border: none;
  border-radius: 999px;

  background: var(--orange);
  color: white;

  font-size: 14px;
  font-weight: 750;

  cursor: pointer;
}

.modal-submit:disabled {
  opacity: .55;
  cursor: not-allowed;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media (max-width: 1250px) {

  .nav-inner {
    padding: 0 25px;
  }

  .hero-inner {
    grid-template-columns: 390px minmax(0, 1fr);
    padding: 0 25px;
  }

  .hero h1 {
    font-size: 52px;
  }

  .dashboard {
    grid-template-columns: 125px minmax(0, 1fr);
  }

  .dashboard-body {
    grid-template-columns: minmax(0, 1fr) 175px;
    gap: 13px;
  }

  .feature {
    padding: 0 14px;
    gap: 13px;
  }

  .feature-icon {
    width: 46px;
    height: 46px;
  }

  .feature p {
    font-size: 11px;
  }
}

@media (max-width: 1050px) {

  .nav-links {
    gap: 20px;
  }

  .hero-inner {
    grid-template-columns: 1fr;
    padding: 35px 25px 0;
  }

  .hero-copy {
    max-width: 700px;
    margin: auto;
    text-align: center;
  }

  .eyebrow-pill {
    margin: auto;
  }

  .hero h1 {
    font-size: 60px;
  }

  .hero-description {
    margin-left: auto;
    margin-right: auto;
  }

  .hero-buttons {
    justify-content: center;
  }

  .hero-trust {
    justify-content: center;
  }

  .dashboard {
    max-width: 900px;
    margin: auto;
  }

  .feature-strip {
    margin-left: 20px;
    margin-right: 20px;
  }
}

@media (max-width: 800px) {

  .navbar {
    height: 65px;
  }

  .nav-inner {
    padding: 0 18px;
  }

  .nav-links {
    display: none;
  }

  .nav-actions {
    margin-left: auto;
  }

  .signin {
    display: none;
  }

  .create-btn {
    height: 40px;
    padding: 0 18px;
    font-size: 12px;
  }

  .hero {
    padding-top: 28px;
  }

  .hero-inner {
    padding: 0 15px;
  }

  .hero h1 {
    font-size: 47px;
  }

  .hero-trust {
    flex-wrap: wrap;
    gap: 15px;
    margin-top: 38px;
  }

  .dashboard {
    grid-template-columns: 1fr;
    border-radius: 18px;
  }

  .dashboard-sidebar {
    display: none;
  }

  .dashboard-body {
    grid-template-columns: 1fr;
  }

  .dashboard-right {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .progress-card,
  .learning-card {
    margin-top: 0;
  }

  .feature-strip {
    grid-template-columns: 1fr 1fr;
    padding: 15px;
  }

  .feature {
    padding: 18px;
    border-right: none;
  }
}

@media (max-width: 560px) {

  .brand-text strong {
    font-size: 18px;
  }

  .brand-text span {
    font-size: 8px;
  }

  .hero h1 {
    font-size: 41px;
  }

  .hero-description {
    font-size: 15px;
  }

  .hero-buttons {
    flex-direction: column;
  }

  .primary-button,
  .secondary-button {
    width: 100%;
  }

  .dashboard-body {
    padding: 18px 13px;
  }

  .dashboard-main h2 {
    font-size: 20px;
  }

  .training-card {
    grid-template-columns: 30px 1fr;
  }

  .training-stats {
    grid-column: 2;
    grid-template-columns: repeat(2, 1fr);
    margin-top: 5px;
  }

  .dashboard-right {
    display: block;
  }

  .progress-card,
  .learning-card {
    margin-top: 12px;
  }

  .feature-strip {
    grid-template-columns: 1fr;
  }

  .feature {
    border-bottom: 1px solid #e7e0e8;
  }

  .feature:last-child {
    border-bottom: none;
  }

  .modal-two {
    grid-template-columns: 1fr;
  }

  .modal-card {
    padding: 29px 22px 24px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition: none !important;
  }
}


/* =========================================================
   SECTIONS

   Shared shell for everything below the hero. The ground
   alternates paper / grey / plum down the page so it has a
   rhythm without anything moving.
========================================================= */

.section {
  padding: 108px 0;
}

.section-inner {
  max-width: 1450px;
  margin: 0 auto;
  padding: 0 44px;
}

.section-alt {
  background: #f6f2f6;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.section-dark {
  background: var(--plum);
  color: #d5c8da;
}

.section-head {
  max-width: 640px;
  margin-bottom: 62px;
}

.section-eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .18em;
  color: var(--orange-dark);
  margin-bottom: 16px;
}

.section-head h2 {
  margin: 0;
  font-size: 44px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -.03em;
  color: var(--text);
}

.section-head p {
  margin: 20px 0 0;
  font-size: 17px;
  line-height: 1.65;
  color: var(--muted);
}

.section-dark .section-eyebrow {
  color: var(--orange);
}

.section-dark .section-head h2 {
  color: #f8f3f8;
}

.section-dark .section-head p {
  color: #cdbfd1;
}

/* =========================================================
   THE TRACK
========================================================= */

.track-grid {
  list-style: none;
  margin: 0;
  padding: 0;

  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 26px;
}

.track-grid li {
  position: relative;
  padding-top: 26px;
  border-top: 2px solid var(--line);
}

/* The short amber rule that sits over each step, so the row
   reads as a track rather than four unrelated columns. */
.track-grid li::after {
  content: "";
  position: absolute;
  top: -2px;
  left: 0;
  width: 38px;
  height: 2px;
  background: var(--orange);
}

.track-num {
  display: block;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .04em;
  color: var(--orange-dark);
  font-variant-numeric: tabular-nums;
}

.track-kicker {
  display: block;
  margin-top: 16px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .16em;
  color: var(--muted);
}

.track-grid h3 {
  margin: 7px 0 0;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -.02em;
  color: var(--text);
}

.track-grid p {
  margin: 11px 0 0;
  font-size: 15px;
  line-height: 1.62;
  color: var(--muted);
}

/* =========================================================
   WHAT AGENTS GET
========================================================= */

.agent-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.agent-grid article {
  padding: 38px 34px 40px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 1px 2px rgba(36,19,45,.04);
  transition: transform .2s ease, box-shadow .2s ease;
}

.agent-grid article:hover {
  transform: translateY(-3px);
  box-shadow: 0 20px 40px -24px rgba(36,19,45,.28);
}

.agent-icon {
  width: 50px;
  height: 50px;
  margin-bottom: 26px;

  display: grid;
  place-items: center;

  border-radius: 15px;
  background: rgba(103,64,120,.09);
  color: var(--purple);
}

.agent-icon svg {
  width: 24px;
  height: 24px;
}

.agent-grid h3 {
  margin: 0;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -.02em;
  color: var(--text);
}

.agent-grid p {
  margin: 13px 0 0;
  font-size: 15.5px;
  line-height: 1.66;
  color: var(--muted);
}

/* =========================================================
   HOW IT WORKS
========================================================= */

.how-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;

  background: rgba(248,243,248,.14);
  border-radius: 22px;
  overflow: hidden;
}

.how-grid article {
  display: flex;
  gap: 20px;

  padding: 36px 34px 38px;
  background: var(--plum);
}

.how-num {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--orange);
  font-variant-numeric: tabular-nums;
  padding-top: 4px;
}

.how-grid h3 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -.02em;
  color: #f8f3f8;
}

.how-grid p {
  margin: 11px 0 0;
  font-size: 15px;
  line-height: 1.66;
  color: #cdbfd1;
}

/* =========================================================
   CLOSING
========================================================= */

.closing .section-inner {
  text-align: center;
}

.closing h2 {
  margin: 0 auto;
  max-width: 17ch;

  font-size: 48px;
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -.03em;
  color: var(--text);
}

.closing p {
  margin: 22px auto 0;
  max-width: 52ch;
  font-size: 17.5px;
  line-height: 1.62;
  color: var(--muted);
}

.closing-buttons {
  margin-top: 38px;
  display: flex;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
}

/* =========================================================
   FOOTER
========================================================= */

.site-footer {
  background: var(--plum-dark);
  color: #9e8ea5;
  padding: 72px 0 30px;
}

.footer-inner {
  max-width: 1450px;
  margin: 0 auto;
  padding: 0 44px 44px;

  display: flex;
  flex-wrap: wrap;
  gap: 60px;
  justify-content: space-between;

  border-bottom: 1px solid rgba(248,243,248,.12);
}

.site-footer .brand strong {
  color: #f8f3f8;
}

.site-footer .brand span {
  color: #9e8ea5;
}

.footer-brand p {
  margin: 18px 0 0;
  max-width: 42ch;
  font-size: 14.5px;
  line-height: 1.65;
}

.footer-links {
  display: flex;
  gap: 76px;
  flex-wrap: wrap;
}

.footer-links > div {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.footer-links h4 {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: #f8f3f8;
}

.footer-links a {
  font-size: 14.5px;
  color: #9e8ea5;
  text-decoration: none;
  transition: color .16s ease;
}

.footer-links a:hover {
  color: #f8f3f8;
}

.footer-legal {
  max-width: 1450px;
  margin: 0 auto;
  padding: 26px 44px 0;

  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: space-between;

  font-size: 13px;
  color: rgba(248,243,248,.42);
}

/* =========================================================
   SECTION RESPONSIVE
========================================================= */

@media (max-width: 1250px) {
  .section-inner,
  .footer-inner,
  .footer-legal {
    padding-left: 32px;
    padding-right: 32px;
  }

  .track-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 34px;
  }
}

@media (max-width: 1050px) {
  .section {
    padding: 82px 0;
  }

  .section-head h2 {
    font-size: 36px;
  }

  .agent-grid {
    grid-template-columns: 1fr;
  }

  .how-grid {
    grid-template-columns: 1fr;
  }

  .closing h2 {
    font-size: 38px;
  }

  .footer-inner {
    gap: 42px;
  }
}

@media (max-width: 620px) {
  .section {
    padding: 64px 0;
  }

  .section-inner,
  .footer-inner,
  .footer-legal {
    padding-left: 20px;
    padding-right: 20px;
  }

  .section-head {
    margin-bottom: 42px;
  }

  .section-head h2 {
    font-size: 30px;
  }

  .track-grid {
    grid-template-columns: 1fr;
    gap: 30px;
  }

  .closing h2 {
    font-size: 30px;
  }

  .closing-buttons .primary-button,
  .closing-buttons .secondary-button {
    width: 100%;
    justify-content: center;
  }

  .footer-links {
    gap: 44px;
  }
}

/* The always-open material. Deliberately NOT numbered — these are not steps,
   and drawing them as steps would imply an order that does not exist. */
.always-open {
  margin-top: 58px;
  padding-top: 40px;
  border-top: 1px solid var(--line);
}

.always-open h3 {
  margin: 0 0 26px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--muted);
}

.always-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
}

.always-grid strong {
  display: block;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -.01em;
  color: var(--text);
}

.always-grid span {
  display: block;
  margin-top: 7px;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--muted);
}

@media (max-width: 900px) {
  .always-grid { grid-template-columns: 1fr; gap: 22px; }
}
`;