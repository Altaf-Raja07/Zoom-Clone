/**
 * The room a host lands in after creating a Meeting.
 *
 * For this ticket the room is the *arrival*: the Meeting ID a host reads aloud
 * and the Invite Link they send. The pre-join screen, the participant list and
 * the live stage are later tickets, and this page says so rather than
 * pretending to be a meeting that is not happening yet.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, Meeting, absoluteInviteLink, getMeeting } from "@/lib/api";

import styles from "./Room.module.css";

type Props = {
  meetingId: string;
};

export function Room({ meetingId }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getMeeting(meetingId)
      .then((loaded) => {
        if (!cancelled) setMeeting(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 404
            ? "That meeting does not exist. Check the ID you followed."
            : "We could not reach the server. Please try again.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  async function copyInviteLink() {
    if (!meeting) return;
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

  if (error) {
    return (
      <main className={styles.main}>
        <p role="alert" className={styles.error}>
          {error}
        </p>
        <Link className={styles.backLink} href="/">
          Back to the dashboard
        </Link>
      </main>
    );
  }

  if (!meeting) {
    return (
      <main className={styles.main}>
        <p className={styles.loading}>Opening your meeting…</p>
      </main>
    );
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
        <span className={styles.role}>Host</span>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your meeting is ready</h1>
        <p className={styles.subtitle}>
          Share the Meeting ID or the Invite Link. Anyone who has either can join —
          there is no password.
        </p>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Meeting ID</h2>
          <p className={styles.meetingId} data-testid="meeting-id">
            {meeting.meeting_id}
          </p>
          <p className={styles.hint}>
            Grouped 3-4-4 so it can be read out over a phone call.
          </p>

          <h2 className={styles.cardTitle}>Invite Link</h2>
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

        <p className={styles.notYet}>
          The pre-join screen and the live room arrive in later tickets. This page
          is the arrival, not the meeting.
        </p>
      </main>
    </div>
  );
}
