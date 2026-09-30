/**
 * The landing dashboard.
 *
 * Ticket 01 established one thing end to end: a first-time visitor arrives with
 * no login step and is greeted by name. Since then all three primary actions
 * have been made real — New Meeting creates a Meeting and walks the host into
 * the room, Join Meeting opens the join screen, and Schedule Meeting opens a
 * form that books one for later. This ticket adds the two sections the
 * assignment names, and the first-run Demo Identity.
 *
 * The two sections and the session load *together*, in one effect, rather than
 * as three. They are one screen's worth of state arriving at once, and three
 * effects would mean three chances for a partially-rendered dashboard: a
 * greeting above two skeletons that never resolve.
 *
 * A Meeting a host creates from this page appears in Recent only on the next
 * visit, because New Meeting navigates away into the room rather than staying
 * here to re-fetch. Re-fetching on the way back would be the alternative, and it
 * is not worth a second fetch of two lists for a screen the host already left.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ApiError,
  DemoDashboard,
  Meeting,
  Session,
  createMeeting,
  explainApiError,
  getDemoDashboard,
  getRecentMeetings,
  getSession,
  getUpcomingMeetings,
} from "@/lib/api";

import { RecentMeetings, UpcomingMeetings } from "./MeetingLists";
import styles from "./Dashboard.module.css";

const PRIMARY_ACTIONS = [
  { key: "new", label: "New Meeting" },
  { key: "join", label: "Join Meeting" },
  { key: "schedule", label: "Schedule Meeting" },
] as const;

type ActionKey = (typeof PRIMARY_ACTIONS)[number]["key"];

export function Dashboard() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Whether the session request is still in flight — not whether it succeeded.
  // The actions wait on the request, not on its answer, because the answer is
  // the identity and by then it is too late to need it.
  const [sessionPending, setSessionPending] = useState(true);

  // The seeded first-run data, held exactly as the API returned it. `null` means
  // "not asked yet", which is why it is not a boolean — not-shown and shown are
  // two states, and re-boxing the payload into a local type would be a second
  // shape to keep in step with the API's for no gain.
  const [demo, setDemo] = useState<DemoDashboard | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Whether this database has a Demo Identity at all. `undefined` while the
  // probe is still in flight, which renders nothing — so the section cannot flash
  // in and then vanish on an unseeded database.
  const [demoAvailable, setDemoAvailable] = useState<boolean | undefined>(undefined);

  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const [recent, setRecent] = useState<Meeting[]>([]);

  useEffect(() => {
    let cancelled = false;

    // Two steps, not three requests in parallel — and this is the same identity
    // race the disabled actions above exist for, arriving through a different
    // door. A first visit has no cookie, and the API mints a *new* User for any
    // request that arrives without one. Three cookie-less requests in flight are
    // three Users; the two section fetches would answer for whichever User their
    // response was built from, while the browser keeps whichever cookie landed
    // last, and the reviewer is then looking at sections that belong to someone
    // else while being greeted by their own name.
    //
    // So the session goes first and alone, and everything else follows it in its
    // own right. Nothing here may be started until the session has landed, and
    // nothing here may be started *alongside* anything else either — a chain, not
    // a fan-out. The first cut of this code got that wrong twice: it fanned the
    // two sections out in parallel, and then fanned the demo probe out beside
    // the session. Both looked harmless and both broke a returning visitor's
    // name.
    getSession()
      .then((loaded) => {
        if (cancelled) return;
        setSession(loaded);

        const sections = Promise.all([getUpcomingMeetings(), getRecentMeetings()])
          .then(([loadedUpcoming, loadedRecent]) => {
            if (cancelled) return;
            setUpcoming(loadedUpcoming.upcoming);
            setRecent(loadedRecent.recent);
          })
          // The sections failing does not un-greet the visitor: the session did
          // land, and a dashboard showing a name and two empty sections is a far
          // better state than one showing an error over the whole page.
          .catch(() => {
            if (cancelled) return;
            setUpcoming([]);
            setRecent([]);
          });

        // Asked only once the visitor is known, for the same reason as the
        // sections above — and awaited here rather than fired, because a request
        // started in this tick is a cookie-less request in a first visit.
        const demoProbe = getDemoDashboard()
          .then(() => {
            if (!cancelled) setDemoAvailable(true);
          })
          .catch(() => {
            if (!cancelled) setDemoAvailable(false);
          });

        return Promise.all([sections, demoProbe]);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? "We could not reach the server. Please try again."
            : "Something went wrong loading your dashboard.",
        );
      })
      .finally(() => {
        if (!cancelled) setSessionPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The Demo Identity's sections, shown once.
   *
   * Opt-in on purpose and never a default: the seed's whole job is to make a
   * first run look designed, and the way to do that without lying is to let a
   * reviewer *ask* to see the seeded state rather than to serve it to them as
   * though it were theirs. Nothing here touches the reviewer's identity — the
   * two lists below stay their own.
   */
  async function showDemo() {
    setDemoError(null);
    try {
      setDemo(await getDemoDashboard());
    } catch (cause: unknown) {
      setDemoError(
        explainApiError(
          cause,
          "We could not load the demo data. Please try again in a moment.",
        ),
      );
    }
  }

  async function startMeeting() {
    setStarting(true);
    setError(null);
    try {
      const meeting = await createMeeting();
      // To pre-join, not straight to the room. The host is a participant like any
      // other and gets the same camera check, the same name confirmation and the
      // same choice about whether to be heard — arriving to find yourself already
      // broadcasting would make "check your camera before others arrive" true for
      // guests and false for the one person in the meeting who arranged it.
      //
      // Pushed rather than linked, so Back returns to a dashboard that still has
      // the session on it rather than re-fetching the whole app.
      router.push(`/prejoin/${meeting.id}`);
    } catch {
      setStarting(false);
      setError("We could not start a meeting. Please try again.");
    }
  }

  function onAction(action: ActionKey) {
    if (action === "new") {
      void startMeeting();
      return;
    }
    if (action === "join") {
      // Pushed rather than linked, for the same reason New Meeting pushes: Back
      // should return to a dashboard that still has the session on it.
      router.push("/join");
      return;
    }
    // Pushed rather than linked for the same reason again: booking a Meeting is
    // a form the host fills in, and Back out of it should land on the dashboard
    // that offered the action rather than on a fresh copy of the app.
    router.push("/schedule");
  }

  return (
    <div>
      <header className={styles.navbar}>
        <div className={styles.brand}>
          <span aria-hidden="true" className={styles.brandMark}>
            M
          </span>
          Meetly
        </div>
        <div className={styles.navRight}>
          {session ? (
            <span className={styles.greeting} data-testid="greeting">
              Hi, {session.display_name}
            </span>
          ) : null}
          <a className={styles.settingsLink} href="#settings" aria-label="Settings">
            <span aria-hidden="true">⚙</span>
          </a>
          {session ? (
            <span
              className={styles.avatar}
              aria-hidden="true"
              data-testid="avatar"
            >
              {initialsOf(session.display_name)}
            </span>
          ) : null}
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Meetly</h1>
        <p className={styles.subtitle}>
          {session
            ? `You are signed in as ${session.display_name}. No password needed.`
            : "Getting your session…"}
        </p>

        {error ? (
          <p role="alert" className={styles.subtitle}>
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          {PRIMARY_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              // Disabled until the visitor is known. A first visit has no
              // identity cookie, and the API mints a new User for *any* request
              // that arrives without one — so clicking before the session has
              // landed puts two cookie-less requests in flight at once, the
              // second User becomes the host of the meeting being created, and
              // whichever cookie the browser stores last wins. The loser is the
              // person who pressed the button, who then sees their own meeting
              // as somebody else's. Nothing server-side can tell those two
              // requests apart; the only place that can stop them racing is
              // here, by not acting until we know who is asking.
              disabled={sessionPending || (starting && action.key === "new")}
              className={
                action.key === "new"
                  ? `${styles.actionButton} ${styles.actionPrimary}`
                  : styles.actionButton
              }
              onClick={() => onAction(action.key)}
            >
              {starting && action.key === "new" ? "Starting…" : action.label}
            </button>
          ))}
        </div>

        {/* The two sections the assignment names. Both render whatever arrives,
            including nothing — the empty states are in the list components, next
            to the lists they belong to rather than duplicated here. */}
        <UpcomingMeetings meetings={upcoming} />
        <RecentMeetings meetings={recent} />

        {/* The seeded first-run data, behind an explicit ask. Not a tab and not a
            default: a reviewer who wants it clicks, and a reviewer who does not
            never sees it. Its own heading, because showing someone else's
            Meetings under your own sections without one would be a lie about
            whose meetings those are.

            Rendered only once the API has said there is a Demo Identity to look
            at. GLOSSARY.md is explicit that it is "only offered where
            explicitly initialised", and a control that is always on screen is
            always offered — so on an unseeded database this whole section is
            absent rather than present and failing, which is the difference
            between "there is nothing to see" and "something is broken". That
            costs one probe on load; the alternative is a button on the deployed
            app whose only possible outcome is an error message.

            The probe is deliberately not part of the identity-carrying load
            above: it depends on `current_user` like everything else, and three
            cookie-less requests on a first visit are three Users. */}
        {demoAvailable !== false ? (
          <section className={styles.demo} aria-labelledby="demo-heading">
            <h2 className={styles.demoTitle} id="demo-heading">
              See a populated dashboard
            </h2>
            <p className={styles.demoBlurb}>
              A first run is seeded with a Demo Identity, a completed meeting and
              some bookings, so you can see these two sections with real data in
              them. You keep your own meetings either way — this does not sign
              you in as anybody.
            </p>

            {demo ? (
              <div data-testid="demo-sections">
                <p className={styles.demoName} data-testid="demo-name">
                  {demo.display_name}&apos;s meetings
                </p>
                <UpcomingMeetings meetings={demo.upcoming} idPrefix="demo-upcoming" />
                <RecentMeetings meetings={demo.recent} idPrefix="demo-recent" />
              </div>
            ) : (
              <button
                type="button"
                className={styles.demoButton}
                onClick={() => void showDemo()}
                data-testid="show-demo"
              >
                Show the demo identity&apos;s meetings
              </button>
            )}

            {demoError ? (
              <p role="alert" className={styles.demoError} data-testid="demo-error">
                {demoError}
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function initialsOf(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
