/**
 * The dashboard's two sections: Upcoming and Recent.
 *
 * Two lists from one module, because they are the same thing asked two ways —
 * "what is coming?" and "what is mine?" — over the same rows, and a shared
 * `MeetingCard` is what stops the two from drifting into looking like different
 * features. Both are filtered on the Host by the API (ADR-0004), so neither can
 * show a stranger's Meeting.
 *
 * Every date is rendered from the instant the API stored, in this browser's own
 * zone. Formatting the stored *text* instead would put a host's nine o'clock at
 * whatever the server's clock believed, on a screen whose whole job is saying
 * when something happens.
 *
 * A Meeting with no title is called "Untitled meeting" rather than left blank.
 * The fallback name comes from `@/lib/meetings`, shared with the Schedule module:
 * two copies of it would be two things to keep in step, and a section showing an
 * empty row reads as a rendering fault.
 */

"use client";

import Link from "next/link";

import { Meeting } from "@/lib/api";
import { UNTITLED } from "@/lib/meetings";

import styles from "./Dashboard.module.css";

/**
 * The word for a Meeting's length, as a person reads it.
 *
 * "45 min" and "1 hr" rather than "45 minutes", because this is a list of ten and
 * the shorter form is what fits without wrapping. The schedule confirmation says
 * "45 minutes" for the same number on purpose: there it is the only fact on the
 * screen, here it is one of four in a row.
 */
function sayDuration(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${minutes} min`;
}

/**
 * The date of a Meeting's start, grouped by how near it is.
 *
 * "Today" and "Tomorrow" because a list of five identical calendar dates is a
 * worse answer than one that says which of them is today — and a host reading
 * this is answering "do I need to do anything now?", not reading a calendar.
 */
function formatDayLabel(instant: string): string {
  const when = new Date(instant);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(when, today)) return "Today";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(when, tomorrow)) return "Tomorrow";

  return when.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * The single instant a row is labelled with.
 *
 * One function, because the label and the clock must agree: a row whose day came
 * from `started_at` and whose time came from `created_at` showed two instants a
 * minute apart on the same line, which reads as a bug in the data rather than as
 * two columns disagreeing. The instant is the Meeting's *start* — when it was
 * due to start, or when it actually did — with the creation time only as the
 * fallback for an Instant Meeting, which has no other.
 */
function rowInstant(meeting: Meeting): string {
  return meeting.scheduled_start_at ?? meeting.started_at ?? meeting.created_at;
}

function MeetingCard({ meeting }: { meeting: Meeting }) {
  const duration = sayDuration(meeting.duration_minutes);
  const instant = rowInstant(meeting);

  return (
    <li className={styles.meetingCard} data-testid="meeting-card">
      <div className={styles.meetingWhen}>
        <span className={styles.meetingDay} data-testid="meeting-day">
          {formatDayLabel(instant)}
        </span>
        <span className={styles.meetingClock} data-testid="meeting-clock">
          {new Date(instant).toLocaleTimeString(undefined, { timeStyle: "short" })}
        </span>
      </div>

      <div className={styles.meetingBody}>
        <h3 className={styles.meetingTitle} data-testid="meeting-title">
          {meeting.title ?? UNTITLED}
        </h3>
        <p className={styles.meetingMeta}>
          {duration ? <span>{duration}</span> : null}
          <span data-testid="meeting-code">{meeting.meeting_id}</span>
          {meeting.started_at ? (
            <span className={styles.meetingStarted}>Started</span>
          ) : null}
        </p>
      </div>

      {/* Into the room, not the Invite Link. Both lists are the Host's own
          Meetings, so a row is a way back to something they already made — and
          since ticket 06 the room is behind pre-join, which is where a name and a
          device choice get made. An Invite Link is for sharing, and the host's own
          browser is not a guest arriving somewhere. */}
      <Link className={styles.meetingLink} href={`/room/${meeting.id}`}>
        Open
      </Link>
    </li>
  );
}

/**
 * Upcoming: the viewer's Scheduled Meetings, soonest first.
 *
 * Empty state on purpose rather than a blank area — a section with a heading and
 * nothing under it is indistinguishable from one that failed to load, and the
 * honest reading ("you have nothing booked") is also the useful one.
 */
export function UpcomingMeetings({
  meetings,
  idPrefix = "upcoming",
}: {
  meetings: Meeting[];
  /**
   * Distinguishes this pair of sections from another pair on the same page.
   *
   * Not decoration: `aria-labelledby` needs a unique `id`, and the demo panels
   * render these same two components below the reviewer's own. Two sections
   * sharing one heading id leaves the second one's accessible name pointing at
   * the first, which is the heading above somebody else's meetings.
   */
  idPrefix?: string;
}) {
  const headingId = `${idPrefix}-heading`;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 className={styles.sectionTitle} id={headingId}>
        Upcoming Meetings
      </h2>
      {meetings.length === 0 ? (
        <p className={styles.empty} data-testid="upcoming-empty">
          No upcoming meetings. Schedule one and it will appear here with an
          Invite Link to share.
        </p>
      ) : (
        <ul className={styles.meetingList} data-testid="upcoming-list">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Recent: the Meetings the viewer hosted, most recently active first.
 *
 * Each row says what it can and stops: when it was, how long, its Meeting ID.
 * Deliberately no Join button here — Recent is for *rejoining* a Meeting, but
 * this ticket has not built the live room, and a button that opens a room which
 * cannot yet hold a meeting would be a promise the app has not kept. The Invite
 * Link is the honest action: it is what actually works, today.
 */
export function RecentMeetings({
  meetings,
  idPrefix = "recent",
}: {
  meetings: Meeting[];
  /** See `UpcomingMeetings` — the demo panels render a second pair. */
  idPrefix?: string;
}) {
  const headingId = `${idPrefix}-heading`;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 className={styles.sectionTitle} id={headingId}>
        Recent Meetings
      </h2>
      {meetings.length === 0 ? (
        <p className={styles.empty} data-testid="recent-empty">
          No meetings yet. Anything you start will be listed here.
        </p>
      ) : (
        <ul className={styles.meetingList} data-testid="recent-list">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </ul>
      )}
    </section>
  );
}
