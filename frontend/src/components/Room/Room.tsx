/**
 * The live room: the dark stage, and who is in it.
 *
 * This is the first screen in the app that is *about other people*. Everything
 * before it — the dashboard, the join screen, pre-join — is one person deciding
 * things about themselves. Here the screen has to answer "who else is here",
 * and the only honest way to do that is a live connection: a list fetched on
 * arrival is true for one second and a lie thereafter.
 *
 * **The room is dark while the rest of the app is light**, and that is not an
 * inconsistency. Every supplied Zoom screenshot shows a light chrome wrapped
 * around a near-black meeting stage, and the stage is what a room *is* — the
 * chrome is what you use to get to it. Matching one without the other produces
 * something that is neither. The dark surface is a semantic token
 * (`--surface-meeting-stage`), so this is a role the token layer already had a
 * name for rather than a colour invented here.
 *
 * **What this screen does not have yet, and says so.** No toolbar, no mute, no
 * camera feed, no chat, no leave control — those are tickets 08 to 10, and each
 * of them is a real piece of behaviour rather than a styling pass. The room
 * shows presence and identity now; pretending to more would be a lie a
 * reviewer can see through in one click.
 *
 * **Simulated video is labelled as simulated.** ADR-0001 records that there is
 * no peer-to-peer transport, so a remote tile can never carry anybody's real
 * video. A tile that looked like video would be the one genuinely misleading
 * thing this screen could do, so remote tiles say what they are. The local
 * camera arrives with ticket 08, when there is a real stream to show.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, Meeting, absoluteInviteLink, getMeeting, getSession } from "@/lib/api";
import { UNTITLED } from "@/lib/meetings";
import { DEFAULT_CHOICES, PreJoinChoices, takePreJoinChoices } from "@/lib/prejoin";
import {
  ConnectionStatus,
  RoomConnection,
  RoomParticipant,
  connectToRoom,
} from "@/lib/realtime";

import styles from "./Room.module.css";

type Props = {
  /**
   * The Meeting's internal id, not its Meeting ID. Both are called a "meeting
   * id" in Zoom's own UI, which is why the code is stored as `join_code` — so
   * the prop is named for what it carries rather than for what it resembles.
   */
  meetingUuid: string;
};

/** The sentence for a request that never reached the server. */
const ROOM_UNREACHABLE = "We could not reach the server. Please try again.";

/**
 * The sentence for each state the connection can be in.
 *
 * A person left staring at a participant list that has stopped changing has no
 * way to tell a quiet meeting from a broken one, and the two call for opposite
 * reactions: wait, or reload. So each state gets a sentence rather than the
 * list simply being left alone — including the *reconnecting* one, which is the
 * state that would otherwise be the longest silence in the product.
 */
const CONNECTION_NOTICE: Record<ConnectionStatus, string | null> = {
  idle: null,
  connecting: null,
  reconnecting: "Lost the connection to this meeting. Reconnecting…",
  lost: "Lost the connection to this meeting. Reload to try again.",
  refused: null,
};

export function Room({ meetingUuid }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  /**
   * Who is in the room, and how many that is, exactly as the server last said.
   *
   * The count is stored rather than recomputed from the list. "How many people
   * are in this meeting" is a question the server has already answered, and a
   * client that derives it has two sources of truth for one number — the two
   * agree only for as long as the client applies no filter of its own, and the
   * count is what a host reads to decide whether anybody is really there.
   */
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [count, setCount] = useState(0);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);

  // What pre-join decided, read on arrival and then discarded. `null` means
  // nobody decided anything — this browser did not come through pre-join, which
  // is a reload of this URL rather than an error — and the room falls back to
  // defaults rather than refusing to open.
  const [choices, setChoices] = useState<PreJoinChoices>(DEFAULT_CHOICES);
  // The stored Display Name, falling back to the session's. The session is the
  // authority on who this is — pre-join stored the name through the API, so the
  // two agree — but a reload of this URL finds no stored choices at all, and
  // showing nobody's name would be worse than showing the one on the cookie.
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((session) => {
        if (!cancelled) setDisplayName(session.display_name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let connection: RoomConnection | null = null;

    // Taken once, on arrival, and only once. `takePreJoinChoices` deletes the
    // entry as it reads it, so a reload finds nothing and a second meeting in
    // this tab cannot inherit the first one's device state.
    const stored = takePreJoinChoices(meetingUuid);
    if (stored) setChoices(stored);

    // Read once and passed straight through, rather than read from `choices`
    // inside the callback below — a state value captured by that closure would
    // still be the default, because the `setChoices` above has not rendered yet.
    const devices = stored ?? DEFAULT_CHOICES;

    getMeeting(meetingUuid)
      .then((loaded) => {
        if (cancelled) return;
        setMeeting(loaded);
        // The socket opens only once the Meeting is known to exist and the
        // browser holds the cookie naming this person.
        //
        // That ordering is not tidiness. The socket carries no identity of its
        // own — a WebSocket cannot set a cookie before its handshake completes —
        // so opening it before the HTTP fetch would connect anonymously and be
        // refused (close code 4401). The fetch above is what mints a first-time
        // guest's cookie, so it is also what makes the socket possible.
        connection = connectToRoom(
          meetingUuid,
          {
            onParticipants: (arrived, arrivedCount) => {
              if (cancelled) return;
              setParticipants(arrived);
              setCount(arrivedCount);
            },
            onStatus: (next, detail) => {
              if (cancelled) return;
              setStatus(next);
              setStatusDetail(detail ?? null);
            },
          },
          { microphoneOn: devices.microphoneOn, cameraOn: devices.cameraOn },
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.detail
            ? cause.detail
            : ROOM_UNREACHABLE,
        );
      });

    return () => {
      cancelled = true;
      // Closed explicitly, because the socket reconnects by itself. Unmounting
      // without this would leave a room trying to come back for a meeting the
      // person has left — a socket the server holds open, and a participant it
      // counts as present, for as long as the tab stayed in memory.
      connection?.close();
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

  const title = meeting.title ?? UNTITLED;
  const notice = statusDetail ?? CONNECTION_NOTICE[status];

  return (
    <div className={styles.room}>
      {/* The meeting title bar: dark, below the chrome, with the count on the
          right. Its shape comes from the Zoom Workplace reference — a small
          circular attendee count, and the title on the left. */}
      <header className={styles.titleBar}>
        <div className={styles.titleGroup}>
          <span aria-hidden="true" className={styles.brandMark}>
            M
          </span>
          <h1 className={styles.roomTitle} data-testid="room-title">
            {title}
          </h1>
        </div>

        <div className={styles.titleRight}>
          {/* The count is the server's, not `participants.length` computed here.
              Two numbers for one room is how a title bar ends up disagreeing
              with the panel underneath it. */}
          <span
            className={styles.participantCount}
            data-testid="participant-count"
            aria-label={`${count} in this meeting`}
          >
            {count}
          </span>
          {meeting.is_host ? (
            <span className={styles.hostBadge} data-testid="host-badge">
              Host
            </span>
          ) : (
            <span className={styles.hostBadge} data-testid="host-badge">
              Hosted by {meeting.host.display_name}
            </span>
          )}
        </div>
      </header>

      <div className={styles.body}>
        {/* The stage. Near-black, because that is what a meeting stage is in
            every supplied screenshot, and because a conferencing surface that
            is the same colour as the dashboard has nowhere to put the
            participants' attention. */}
        <section className={styles.stage} aria-label="Meeting stage">
          {participants.length === 0 ? (
            <p className={styles.stageEmpty} data-testid="stage-empty">
              Waiting for people to join…
            </p>
          ) : (
            <ul className={styles.tiles} data-testid="stage-tiles">
              {participants.map((participant) => (
                <li className={styles.tile} key={participant.user_id}>
                  <span
                    aria-hidden="true"
                    className={styles.tileInitial}
                    data-testid="tile-initial"
                  >
                    {initialOf(participant.display_name)}
                  </span>
                  <span className={styles.tileName} data-testid="tile-name">
                    {participant.display_name}
                    {participant.is_host ? " (Host)" : ""}
                  </span>
                  {/* Said out loud, not implied by a grey rectangle. There is no
                      peer-to-peer transport (ADR-0001), so a tile that looked
                      like video would be the one genuinely misleading thing this
                      screen could do. */}
                  <span className={styles.tileSimulated} data-testid="tile-simulated">
                    {participant.is_video_on
                      ? "Camera simulated"
                      : "Camera off"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The participant list. Not the full panel of ticket 08 — no status
            indicators, no controls — but the list itself, including the
            viewer's own entry, so a person can confirm they are identified the
            way they chose to be. */}
        <aside className={styles.panel} aria-label="Participants">
          <h2 className={styles.panelTitle}>
            Participants
            <span className={styles.panelCount}>{count}</span>
          </h2>
          {notice ? (
            <p className={styles.notice} role="status" data-testid="connection-notice">
              {notice}
            </p>
          ) : null}
          <ul className={styles.participantList} data-testid="participant-list">
            {participants.map((participant) => (
              <li
                className={styles.participantRow}
                key={participant.user_id}
                data-testid="participant-row"
              >
                <span
                  aria-hidden="true"
                  className={styles.rowInitial}
                  data-testid="participant-initial"
                >
                  {initialOf(participant.display_name)}
                </span>
                <span
                  className={styles.rowName}
                  data-testid="participant-name"
                >
                  {participant.display_name}
                </span>
                {participant.is_host ? (
                  <span className={styles.rowHost} data-testid="participant-host">
                    Host
                  </span>
                ) : null}
                {participant.is_muted ? (
                  <span
                    className={styles.rowMuted}
                    data-testid="participant-muted"
                    title="Muted"
                  >
                    Muted
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {participants.length === 0 ? (
            <p className={styles.panelEmpty} data-testid="participant-empty">
              Nobody else is here yet.
            </p>
          ) : null}
        </aside>
      </div>

      {/* Who you are, and how to let anyone else in. The Meeting ID is shown to
          everybody and the Invite Link only to the host: a guest already has
          one, and the number is the thing a person reads aloud to bring a
          third person in by hand. Sharing — copying the link — is the host's to
          do, and a guest is not handed the host's copy controls as though
          sharing were theirs to give. */}
      <footer className={styles.footer}>
        <div className={styles.you}>
          <p className={styles.youName} data-testid="your-name">
            {displayName}
          </p>
          <dl className={styles.devices}>
            <dt>Camera</dt>
            <dd data-testid="room-camera-state">
              {choices.cameraOn ? "On" : "Off"}
            </dd>
            <dt>Microphone</dt>
            <dd data-testid="room-microphone-state">
              {choices.microphoneOn ? "On" : "Off"}
            </dd>
          </dl>
        </div>

        <div className={styles.invite}>
          <div>
            <span className={styles.inviteLabel}>Meeting ID</span>
            <span className={styles.inviteValue} data-testid="meeting-id">
              {meeting.meeting_id}
            </span>
          </div>
          {meeting.is_host ? (
            <>
              <div>
                <span className={styles.inviteLabel}>Invite Link</span>
                <span className={styles.inviteValue} data-testid="invite-path">
                  {absoluteInviteLink(meeting.invite_path)}
                </span>
              </div>
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
            </>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/**
 * The letter on somebody's tile.
 *
 * The first letter of the first word, which is what Zoom does and what a person
 * recognises themselves by. A generated colour is deliberately *not* used: two
 * people with the same name would get the same colour, and a colour carries
 * information here that it cannot actually be trusted for.
 */
function initialOf(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  return (first[0] ?? "?").toUpperCase();
}
