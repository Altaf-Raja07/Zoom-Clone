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
  /**
   * The Meeting's internal id, not its Meeting ID. Both are called a "meeting
   * id" in Zoom's own UI, which is why the code is stored in `join_code` — so
   * the prop is named for what it carries rather than for what it resembles.
   */
  meetingUuid: string;
};

export function Room({ meetingUuid }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getMeeting(meetingUuid)
      .then((loaded) => {
        if (!cancelled) setMeeting(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.detail
            ? cause.detail
            : "We could not reach the server. Please try again.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [meetingUuid]);

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
        {meeting.is_host ? (
          <span className={styles.hostBadge} data-testid="host-badge">
            Host
          </span>
        ) : (
          <span className={styles.hostBadge} data-testid="host-badge">
            Hosted by {meeting.host.display_name}
          </span>
        )}
      </header>

      <main className={styles.main}>
        {/* Two different arrivals from one page. A host is told their Meeting is
            ready to share; a guest who followed a link is told they are in
            someone else's Meeting, and is not handed the host's copy controls as
            though sharing were theirs to give. */}
        {meeting.is_host ? (
          <>
            <h1 className={styles.title}>Your meeting is ready</h1>
            <p className={styles.subtitle}>
              Share the Meeting ID or the Invite Link. Anyone who has either can
              join — there is no password.
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>You are in the meeting</h1>
            <p className={styles.subtitle}>
              You joined with the Meeting ID below. The live room — participants,
              stage and controls — arrives in a later ticket; this page is the
              arrival, not the meeting.
            </p>
          </>
        )}

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Meeting ID</h2>
          <p className={styles.meetingId} data-testid="meeting-id">
            {meeting.meeting_id}
          </p>
          <p className={styles.hint}>
            Grouped 3-4-4 so it can be read out over a phone call.
          </p>

          {meeting.is_host ? (
            <>
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
                      Your browser would not let us copy. Select the link and copy
                      it.
                    </span>
                  ) : null}
                </span>
              </div>
            </>
          ) : null}
        </section>

        <p className={styles.notYet}>
          The pre-join screen and the live room arrive in later tickets. This page
          is the arrival, not the meeting.
        </p>
      </main>
    </div>
  );
}
