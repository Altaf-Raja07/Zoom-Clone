/**
 * The live room: the dark stage, the toolbar, and who is in it.
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
 * **Your own camera is real; everyone else's is not, and the room says so.**
 * There is no peer-to-peer transport (ADR-0001), so a remote tile can never
 * carry anybody's actual video. The local tile is a genuine `getUserMedia`
 * stream, and a remote tile is an initial on a flat panel with a visible
 * "simulated" line. The two must not be confusable: a tile that looked like
 * live video would be the one genuinely misleading thing this screen could do,
 * so the distinction is a design constraint rather than an oversight.
 *
 * **The toolbar follows the reference's shape, not a neat row.** Left, centre
 * and right groups rather than evenly spaced controls; the destructive
 * end-meeting action alone at the far right and visually distinct, because the
 * cost of pressing it by accident is the meeting; and a chevron on the controls
 * that will carry a submenu, which is how the reference signals one without
 * opening one.
 *
 * **What this screen does not have yet, and says so.** Chat and end-meeting are
 * rendered where the reference puts them but are **disabled with the reason
 * stated** — they are tickets 09 and 10, and a live-looking control that does
 * nothing when pressed is worse than an absent one. The "Leave" control is
 * likewise ticket 10's. A toolbar is the most-used surface in a conferencing
 * product, and a row of dead buttons on it reads as a broken build.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, Meeting, absoluteInviteLink, getMeeting, getSession } from "@/lib/api";
import {
  CAMERA_PROBLEM_TEXT,
  DeviceProblem,
  getLocalMedia,
  stopStream,
} from "@/lib/media";
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

/** Why the two controls that are not built yet are not built yet. */
const NOT_YET = "Arrives with a later ticket";

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

  // This person's own User id, which is how the room knows which entry in the
  // participant list is *them*. Without it the local tile cannot be drawn and the
  // two toggles have nothing to draw their pressed state from. A null id — the
  // session call failed — leaves the room without a local tile rather than
  // guessing at one, because a tile that might be somebody else is worse than
  // no tile.
  const [myUserId, setMyUserId] = useState<string | null>(null);

  // The real camera and microphone streams, and the reason there is no camera.
  // A person who denied the camera or has none still has a room, an identity and
  // a microphone, so the failure is drawn as a sentence on the local tile rather
  // than as an absence — the same rule pre-join follows, applied to a different
  // screen.
  //
  // **Two streams, not one.** `getLocalMedia` asks for the devices separately and
  // gets back separate streams, which is the whole reason it does: one
  // `getUserMedia({video, audio})` fails outright if *either* device is missing,
  // and a laptop with no webcam would lose its microphone too. Holding them
  // separately here is what lets the mute control silence a microphone that
  // exists while the camera does not.
  const [localVideo, setLocalVideo] = useState<MediaStream | null>(null);
  const [localAudio, setLocalAudio] = useState<MediaStream | null>(null);
  const [cameraProblem, setCameraProblem] = useState<DeviceProblem | null>(null);
  const videoElement = useRef<HTMLVideoElement | null>(null);

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

  // The live connection, in a ref as well as the effect that made it. The
  // toggles are called from event handlers, which run long after the effect
  // that opened the socket has returned, and a handler cannot reach a local of
  // the effect it was defined in. A ref is the one place both can reach.
  const connection = useRef<RoomConnection | null>(null);

  // What pre-join recorded, consumed on arrival and kept here so the second run
  // of a double-invoked effect reads the same value rather than nothing. `null`
  // means pre-join recorded nothing — a reload of this URL, which is not an
  // error — and the room falls back to defaults.
  const prejoinDevices = useRef<PreJoinChoices | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((session) => {
        if (cancelled) return;
        setDisplayName(session.display_name);
        setMyUserId(session.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The local camera, asked for once on arrival and given back on the way out.
  //
  // Stopped on unmount because a stream left running keeps the camera light on
  // after the person has left the room — and this screen is the one people leave
  // by navigating away, which is exactly the case that leaks.
  useEffect(() => {
    let cancelled = false;
    let video: MediaStream | null = null;
    let audio: MediaStream | null = null;

    getLocalMedia()
      .then((media) => {
        if (cancelled) {
          stopStream(media.video);
          stopStream(media.audio);
          return;
        }
        video = media.video;
        audio = media.audio;
        setLocalVideo(media.video);
        setLocalAudio(media.audio);
        setCameraProblem(media.cameraProblem);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      stopStream(video);
      stopStream(audio);
    };
  }, []);

  /**
   * Hand the stream to the `<video>` once it exists.
   *
   * A ref callback rather than a `srcObject` prop, because the element and the
   * stream arrive independently: the stream may be ready before React has
   * rendered the tile, and `<video srcObject>` set once at mount would then be
   * setting `null` and never corrected. A ref callback runs on mount and again
   * whenever the callback identity changes, so the stream is attached whenever
   * both exist — the same shape a hidden `<video>` in the pre-join preview uses.
   */
  const attachStream = useCallback((element: HTMLVideoElement | null) => {
    videoElement.current = element;
    if (element) element.srcObject = localVideo;
  }, [localVideo]);

  useEffect(() => {
    let cancelled = false;

    // Taken once, on arrival, and only once — **guarded by a ref rather than
    // merely by being inside the effect body.**
    //
    // `takePreJoinChoices` deletes the entry as it reads it, which is what stops
    // a second meeting in this tab inheriting the first one's device state. But
    // React runs effects twice in development's StrictMode, so the second run
    // finds nothing and falls back to the defaults. The symptom is subtle and
    // looks like a server problem: a person who turned their camera off on the
    // pre-join screen arrives broadcasting it, because the room sent
    // `camera_on: true` on their behalf.
    //
    // The ref survives the double invocation — React re-runs effects on the same
    // instance rather than mounting a new one — so the entry is taken on the
    // first pass and only the first, and both passes read the same value out of
    // `prejoinDevices` below.
    if (!prejoinDevices.current) {
      prejoinDevices.current = takePreJoinChoices(meetingUuid);
      if (prejoinDevices.current) setChoices(prejoinDevices.current);
    }

    // Read from the ref rather than from `choices`: a state value captured by
    // this closure would still be the default, because the `setChoices` above
    // has not rendered yet.
    const devices = prejoinDevices.current ?? DEFAULT_CHOICES;

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
        connection.current = connectToRoom(
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
      connection.current?.close();
      connection.current = null;
    };
  }, [meetingUuid]);

  /**
   * This person's own entry in the room, or `null` before the first broadcast.
   *
   * Everything about *their own* mute and camera state is read from here rather
   * than from local state, because the server is the only thing that has told
   * everybody else. A toolbar that showed a local guess would be a second
   * source of truth about the same two booleans, and the moment the two
   * disagreed — a reconnect, a dropped frame — the person would see themselves
   * unmuted while a host sees them muted.
   */
  const me = participants.find((p) => p.user_id === myUserId) ?? null;
  const myMuted = me ? me.is_muted : !choices.microphoneOn;
  const myVideoOn = me ? me.is_video_on : choices.cameraOn;

  // The tracks follow the toggles, not the other way round. If the room is
  // showing somebody as unmuted, the microphone they are holding must be off —
  // otherwise the room and the hardware disagree, and the person is broadcasting
  // audio a host has been told is silent. Disabling the track rather than tearing
  // the stream down is what makes a toggle instant and stops the browser asking
  // for permission a second time when it is turned back on.
  useEffect(() => {
    localAudio?.getTracks().forEach((track) => {
      track.enabled = !myMuted;
    });
  }, [localAudio, myMuted]);

  useEffect(() => {
    localVideo?.getVideoTracks().forEach((track) => {
      track.enabled = myVideoOn;
    });
  }, [localVideo, myVideoOn]);

  /**
   * This person's devices as the wire describes them: **on**, not muted.
   *
   * The room's own vocabulary is the opposite — `myMuted` says whether the room
   * has you muted, and `is_muted` is what every other participant is shown. So
   * this is the one place the inversion is written down, and every consumer
   * below speaks the device's language instead of the room's.
   *
   * It matters because the inversion is the exact thing that is easy to get
   * backwards. An earlier version of the mute control sent `microphone_on:
   * myMuted` directly, which is *correct* and reads like a bug — and the next
   * version "fixed" it to `!myMuted`, which silently broke the button: the value
   * sent was always the one the server already held, `set_device_state` reported
   * no change, nothing was broadcast, and the control did nothing at all. No
   * error, no failing request — a dead button. Converting once, here, means the
   * toggles below only ever negate their own field.
   */
  const liveDevices = { microphoneOn: !myMuted, cameraOn: myVideoOn };

  /**
   * Press one of the two toggles.
   *
   * Each branch negates the field it owns and leaves the other alone, so there
   * is no arithmetic across the two vocabularies to get wrong.
   *
   * The *track* is disabled by the effects above, so the device genuinely stops
   * rather than the room merely claiming it has.
   *
   * The optimistic local flip is deliberately absent. The button's pressed state
   * comes from the server's answer, so it changes when the room agrees rather
   * than when the key is pressed: a toggle that appeared to work and then
   * silently reverted would be worse than one that takes the length of a round
   * trip to change.
   */
  const toggleDevice = useCallback(
    (which: "microphone" | "camera") => {
      connection.current?.setDevices(
        which === "microphone"
          ? { ...liveDevices, microphoneOn: !liveDevices.microphoneOn }
          : { ...liveDevices, cameraOn: !liveDevices.cameraOn },
      );
    },
    [liveDevices.microphoneOn, liveDevices.cameraOn],
  );

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
              {participants.map((participant) => {
                const isMe = participant.user_id === myUserId;
                return (
                  <li
                    className={isMe ? styles.ownTile : styles.tile}
                    key={participant.user_id}
                    data-testid={isMe ? "own-tile" : "remote-tile"}
                  >
                    {/* The real camera, on this person's own tile and nowhere
                        else. `muted` because a browser will not play a local
                        stream back through the speakers, and without it the
                        person hears themselves a half-second late, which reads
                        as an echo in the room. */}
                    {isMe && myVideoOn && localVideo ? (
                      <video
                        ref={attachStream}
                        className={styles.ownVideo}
                        data-testid="own-video"
                        autoPlay
                        playsInline
                        muted
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={styles.tileInitial}
                        data-testid="tile-initial"
                      >
                        {initialOf(participant.display_name)}
                      </span>
                    )}

                    <span className={styles.tileName} data-testid="tile-name">
                      {participant.display_name}
                      {isMe ? " (You)" : ""}
                      {participant.is_host && !isMe ? " (Host)" : ""}
                    </span>

                    {participant.is_muted ? (
                      <span
                        className={styles.tileMuted}
                        data-testid="tile-muted"
                        title="Muted"
                      >
                        Muted
                      </span>
                    ) : null}

                    {/* Why there is no picture of somebody else, in words. No
                        peer-to-peer transport exists (ADR-0001), so a remote
                        tile that looked like video would be the one genuinely
                        misleading thing this screen could do — and unlike the
                        local tile, which is a real stream, nothing here can
                        become real later without a rewrite. */}
                    {!isMe ? (
                      <span
                        className={styles.tileSimulated}
                        data-testid="tile-simulated"
                      >
                        {participant.is_video_on
                          ? "Camera simulated"
                          : "Camera off"}
                      </span>
                    ) : cameraProblem ? (
                      <span
                        className={styles.tileSimulated}
                        role="status"
                        data-testid="local-camera-notice"
                      >
                        {CAMERA_PROBLEM_TEXT[cameraProblem]}
                      </span>
                    ) : null}
                  </li>
                );
              })}
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
                  {participant.user_id === myUserId ? " (You)" : ""}
                </span>
                {participant.is_host ? (
                  <span className={styles.rowHost} data-testid="participant-host">
                    Host
                  </span>
                ) : null}
                {/* Both states, not just the loud one. The checklist asks for
                    status indicators, and a host reading this panel is asking
                    two questions: who can hear me, and who can see me. Muting
                    is the one people notice, which is exactly why the camera
                    needs saying out loud too — a silently dark camera is
                    indistinguishable from a broken one. */}
                {participant.is_muted ? (
                  <span
                    className={styles.rowMuted}
                    data-testid="participant-muted"
                    title="Muted"
                  >
                    Muted
                  </span>
                ) : null}
                <span
                  className={
                    participant.is_video_on
                      ? styles.rowCameraOn
                      : styles.rowMuted
                  }
                  data-testid="participant-camera"
                  title={
                    participant.is_video_on
                      ? "Camera on"
                      : "Camera off"
                  }
                >
                  {participant.is_video_on ? "Camera" : "No camera"}
                </span>
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

      {/* The toolbar, in the reference's arrangement: left, centre, right rather
          than evenly spaced. The grouping is the point — Zoom's controls are
          clustered by how often they are used, so the two controls pressed
          constantly are under the hand and the destructive one is as far away
          from them as the width allows. */}
      <div className={styles.toolbar} data-testid="toolbar">
        <div className={styles.toolbarGroup}>
          {/* `aria-pressed` rather than a class, because the state of a toggle
              has to be readable by something that is not looking at the pixels —
              a screen reader, and a test. */}
          <button
            type="button"
            className={myMuted ? styles.controlActive : styles.control}
            aria-pressed={myMuted}
            aria-label={myMuted ? "Unmute" : "Mute"}
            title={myMuted ? "Unmute" : "Mute"}
            onClick={() => toggleDevice("microphone")}
            data-testid="toggle-microphone"
          >
            <span aria-hidden="true" className={styles.controlIcon}>
              {myMuted ? "🔇" : "🎙"}
            </span>
            <span className={styles.controlLabel}>
              {myMuted ? "Unmute" : "Mute"}
            </span>
          </button>

          <button
            type="button"
            className={myVideoOn ? styles.control : styles.controlActive}
            aria-pressed={!myVideoOn}
            aria-label={myVideoOn ? "Turn camera off" : "Turn camera on"}
            title={myVideoOn ? "Turn camera off" : "Turn camera on"}
            onClick={() => toggleDevice("camera")}
            data-testid="toggle-camera"
          >
            <span aria-hidden="true" className={styles.controlIcon}>
              {myVideoOn ? "🎥" : "🚫"}
            </span>
            <span className={styles.controlLabel}>Video</span>
            {/* A chevron, because the reference carries one on controls that open
                a submenu — device selection, which this build does not have. It
                is drawn rather than omitted so the toolbar reads as the same
                family of surface, and so the later ticket that adds it has
                somewhere to put the menu. */}
            <span aria-hidden="true" className={styles.chevron}>
              ⌄
            </span>
          </button>
        </div>

        <div className={styles.toolbarGroup}>
          <span className={styles.controlStatic} data-testid="participants-control">
            <span className={styles.controlBadge} data-testid="participants-badge">
              {count}
            </span>
            <span className={styles.controlLabel}>Participants</span>
          </span>

          {/* Chat is ticket 09 and End is ticket 10. They are drawn where the
              reference puts them — so the toolbar is the same shape a reviewer
              is comparing against — but disabled, with the reason in `title` and
              on the control's accessible description. A live-looking button that
              does nothing is worse than an absent one, and a toolbar of dead
              buttons reads as a broken build rather than as work in progress. */}
          <button
            type="button"
            className={styles.control}
            disabled
            title={NOT_YET}
            aria-label={`Chat (${NOT_YET})`}
            data-testid="chat-toggle"
          >
            <span aria-hidden="true" className={styles.controlIcon}>
              💬
            </span>
            <span className={styles.controlLabel}>Chat</span>
            <span aria-hidden="true" className={styles.chevron}>
              ⌄
            </span>
          </button>
        </div>

        {/* Alone at the far right, in the destructive colour, and host-only.
            The cost of pressing it is the meeting, so it is separated by every
            available means: distance, colour, and a confirmation that arrives
            with ticket 10. */}
        {meeting.is_host ? (
          <button
            type="button"
            className={styles.endMeeting}
            disabled
            title={NOT_YET}
            aria-label={`End meeting (${NOT_YET})`}
            data-testid="end-meeting"
          >
            <span aria-hidden="true" className={styles.controlIcon}>
              ⏹
            </span>
            <span className={styles.controlLabel}>End</span>
          </button>
        ) : null}
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
          {/* The same two booleans the toolbar is showing, read from the same
              source. This used to render pre-join's snapshot, which is right
              until the moment somebody presses mute: the toolbar would say
              "Unmute" and the line directly beneath it would say Microphone
              "On". Two truths about one person's own hardware, on one screen,
              with the toolbar contradicting the text next to it. */}
          <dl className={styles.devices}>
            <dt>Camera</dt>
            <dd data-testid="room-camera-state">
              {myVideoOn ? "On" : "Off"}
            </dd>
            <dt>Microphone</dt>
            <dd data-testid="room-microphone-state">
              {myMuted ? "Off" : "On"}
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
