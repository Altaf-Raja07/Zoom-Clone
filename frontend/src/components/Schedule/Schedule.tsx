/**
 * The schedule form, and what a host is shown once a Meeting is booked.
 *
 * Two components in one module rather than two routes, because they are two
 * moments of one act: the form is the asking, and the confirmation is the
 * Invite Link the host came here for. Navigating between them would put the
 * link behind a URL a refresh would throw away — and a Meeting with an Invite
 * Link nobody kept is a Meeting nobody can attend.
 *
 * The confirmation deliberately does not send the host to the room. That page is
 * the arrival for a Meeting happening now, and it would read as though the
 * scheduled Meeting had already begun. The dashboard gains an Upcoming list
 * with ticket 05, and that is where a booked Meeting will be found.
 *
 * The form has exactly the four fields the assignment asks for. Recurrence,
 * invitees, passcodes and a waiting room are not here as disabled controls
 * either: a control that cannot do anything is a promise the app has not kept,
 * and a half-built version of Zoom's larger dialog is worse than a smaller one
 * that works.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Meeting,
  absoluteInviteLink,
  explainApiError,
  scheduleMeeting,
} from "@/lib/api";

import styles from "./Schedule.module.css";

/** Shown in place of a title the host did not write. */
const UNTITLED = "Untitled meeting";

/** The length that was not asked for, when the API cannot say what went wrong. */
const BOOKING_FAILED = "We could not schedule that meeting. Please try again in a moment.";

/**
 * When a Meeting starts, as two fields and then as one instant.
 *
 * A pair rather than a loose string, because the two are filled in separately
 * by two native pickers and travel together from the default through to the
 * request — three places that would each have to remember both halves.
 */
type StartWhen = {
  /** `yyyy-mm-dd`, the value a native date input holds. */
  date: string;
  /** `HH:mm`, the value a native time input holds. */
  time: string;
};

/** The lengths offered, in minutes. Zoom's own list, minus the ones under 15. */
const DURATIONS_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240, 480, 720];

/** The first half-hour boundary after now — a time a host can keep or change. */
function nextHalfHour(now: Date): StartWhen {
  const start = new Date(now);
  start.setSeconds(0, 0);
  // setMinutes past the hour rolls the date over on its own, so this stays
  // correct at 23:30 rather than needing a special case.
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60);

  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
  };
}

/**
 * The moment the host picked, in their own time zone — or null if they have not
 * picked one yet.
 *
 * Built from the numbers rather than by parsing `"<date>T<time>"`, so the only
 * thing deciding what nine o'clock means is the browser the host is sitting in
 * front of — the one place the answer is not a guess. The result is sent with
 * its offset attached, so nothing downstream has to know or care.
 *
 * A blank field is not midnight. `Number("")` is `0`, so the two numbers are
 * checked for being *there* before they are used: a cleared time input is a
 * start nobody has chosen, and a Meeting with no start time is an Instant
 * Meeting — a different button on the dashboard, not a midnight one here.
 */
function startInstant({ date, time }: StartWhen): Date | null {
  const dateParts = date.split("-");
  const timeParts = time.split(":");
  if (dateParts.length !== 3 || timeParts.length !== 2) return null;

  const [year, month, day] = dateParts.map(Number);
  const [hour, minute] = timeParts.map(Number);
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return null;

  return new Date(year, month - 1, day, hour, minute);
}

export function Schedule() {
  const [scheduled, setScheduled] = useState<Meeting | null>(null);

  return (
    <div>
      <header className={styles.navbar}>
        <div className={styles.brand}>
          <span aria-hidden="true" className={styles.brandMark}>
            M
          </span>
          Meetly
        </div>
      </header>

      <main className={styles.main}>
        {scheduled ? (
          <Confirmation meeting={scheduled} />
        ) : (
          <BookingForm onScheduled={setScheduled} />
        )}

        <Link className={styles.backLink} href="/">
          Back to the dashboard
        </Link>
      </main>
    </div>
  );
}

function BookingForm({ onScheduled }: { onScheduled: (meeting: Meeting) => void }) {
  const [start, setStart] = useState<StartWhen>({ date: "", time: "" });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  // Filled in after the first paint rather than in the initial state. The server
  // rendered this component too, on a different clock, and an input whose value
  // differs between the two renders is a hydration mismatch.
  useEffect(() => {
    setStart((current) => (current.date || current.time ? current : nextHalfHour(new Date())));
  }, []);

  const startsAt = startInstant(start);
  const canBook = startsAt !== null && !booking;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!startsAt || booking) return;

    setBooking(true);
    setError(null);

    try {
      const meeting = await scheduleMeeting({
        // Trimmed here so an untouched field is sent as absence rather than as
        // an empty string, and so what is shown afterwards is the value the API
        // stored rather than the characters that happened to be typed.
        title: title.trim() || null,
        description: description.trim() || null,
        scheduled_start_at: startsAt.toISOString(),
        duration_minutes: Number(duration),
      });
      onScheduled(meeting);
    } catch (cause: unknown) {
      setError(explainApiError(cause, BOOKING_FAILED));
    } finally {
      setBooking(false);
    }
  }

  return (
    <>
      <h1 className={styles.title}>Schedule a meeting</h1>
      <p className={styles.subtitle}>
        Pick a time and get an Invite Link to share before anyone arrives. There is
        no password and no login.
      </p>

      {error ? (
        <p role="alert" className={styles.error} data-testid="schedule-error">
          {error}
        </p>
      ) : null}

      <form className={styles.card} onSubmit={submit}>
        <label className={styles.label} htmlFor="schedule-title">
          Topic <span className={styles.optional}>(optional)</span>
        </label>
        <input
          id="schedule-title"
          className={styles.input}
          placeholder={UNTITLED}
          maxLength={200}
          autoComplete="off"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          data-testid="schedule-title"
        />
        <p className={styles.hint}>
          What the meeting is about. A meeting without one is called “{UNTITLED}”.
        </p>

        <label className={styles.label} htmlFor="schedule-description">
          Description <span className={styles.optional}>(optional)</span>
        </label>
        <textarea
          id="schedule-description"
          className={styles.textarea}
          placeholder="Anything people should know before they join"
          maxLength={1000}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          data-testid="schedule-description"
        />

        {/* Date and time as two fields, because the assignment asks for a date
            and a time, and because two native pickers are what a phone already
            knows how to open. The instant they add up to is resolved in the
            viewer's own zone, on submit. */}
        <label className={styles.label} htmlFor="schedule-date">
          Date
        </label>
        <input
          id="schedule-date"
          className={styles.input}
          type="date"
          value={start.date}
          onChange={(event) => setStart({ ...start, date: event.target.value })}
          data-testid="schedule-date"
        />

        <label className={styles.label} htmlFor="schedule-time">
          Time
        </label>
        <input
          id="schedule-time"
          className={styles.input}
          type="time"
          value={start.time}
          onChange={(event) => setStart({ ...start, time: event.target.value })}
          data-testid="schedule-time"
        />
        <p className={styles.hint}>
          Your own time zone. The meeting opens to join at this time.
        </p>

        <label className={styles.label} htmlFor="schedule-duration">
          Duration
        </label>
        <select
          id="schedule-duration"
          className={styles.input}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          data-testid="schedule-duration"
        >
          {DURATIONS_MINUTES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>

        <button
          type="submit"
          className={styles.scheduleButton}
          disabled={!canBook}
          data-testid="schedule-submit"
        >
          {booking ? "Scheduling…" : "Schedule"}
        </button>
      </form>
    </>
  );
}

function Confirmation({ meeting }: { meeting: Meeting }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(absoluteInviteLink(meeting.invite_path));
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // The Clipboard API needs a secure context and permission. Saying so beats
      // a button that appears to do nothing.
      setCopyFailed(true);
    }
  }

  return (
    <>
      <h1 className={styles.title} data-testid="schedule-confirmation">
        Your meeting is scheduled
      </h1>
      <p className={styles.subtitle}>
        Share the Invite Link now — it is the same link either way, and it starts
        working the moment the meeting begins.
      </p>

      <section className={styles.card}>
        <h2 className={styles.scheduledTitle} data-testid="scheduled-title">
          {meeting.title ?? UNTITLED}
        </h2>
        {meeting.description ? (
          <p className={styles.scheduledDescription} data-testid="scheduled-description">
            {meeting.description}
          </p>
        ) : null}

        <dl className={styles.details}>
          <dt>When</dt>
          <dd data-testid="scheduled-start">{formatStart(meeting.scheduled_start_at)}</dd>
          <dt>Duration</dt>
          <dd data-testid="scheduled-duration">{meeting.duration_minutes} minutes</dd>
        </dl>

        <h3 className={styles.cardTitle}>Meeting ID</h3>
        <p className={styles.meetingId} data-testid="meeting-id">
          {meeting.meeting_id}
        </p>

        <h3 className={styles.cardTitle}>Invite Link</h3>
        <p className={styles.invitePath} data-testid="invite-path">
          {absoluteInviteLink(meeting.invite_path)}
        </p>
        <div className={styles.copyRow}>
          <button
            type="button"
            className={styles.copyButton}
            onClick={() => void copyInviteLink()}
          >
            Copy invite link
          </button>
          <span aria-live="polite" className={styles.copyStatus}>
            {copied ? (
              <span className={styles.copied} data-testid="copied">
                Copied
              </span>
            ) : null}
            {copyFailed ? (
              <span className={styles.copyError} role="alert">
                Your browser would not let us copy. Select the link and copy it.
              </span>
            ) : null}
          </span>
        </div>
      </section>
    </>
  );
}

/**
 * The start time as a person should read it: this machine's calendar, in this
 * machine's zone.
 *
 * Rendered from the instant the API stored rather than from the fields the host
 * filled in, so what is on screen is what the Meeting will be gated on.
 */
function formatStart(stored: string | null): string {
  if (!stored) return "";
  return new Date(stored).toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  });
}
