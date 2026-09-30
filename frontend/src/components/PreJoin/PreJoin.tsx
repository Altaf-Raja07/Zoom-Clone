/**
 * The pre-join screen: check yourself, choose, enter.
 *
 * This is the most recognisable moment in a Zoom flow and the first screen where
 * anything about the *user* is on show. Three things are on it — a live preview
 * of their own camera, the name they will be known by, and two toggles — and all
 * three are things they have just decided and are about to stop being able to
 * change.
 *
 * **The unhappy paths are the design.** A person who denies the camera, or has no
 * camera, or turns it off, must be told what happened and must still be able to
 * join. That is not a fallback bolted on afterwards: it is most of what this
 * screen has to get right, and a black rectangle with no explanation is the
 * specific failure the ticket forbids. So there is no state in which the Join
 * control is unavailable for a device reason — the only thing that can stop
 * somebody joining is a Meeting that has gone, and the API says so in words.
 *
 * **The camera and microphone are asked for separately** (`getLocalMedia`), because
 * one `getUserMedia({video, audio})` call fails entirely if *either* device is
 * absent. That single detail is why a laptop with no webcam would otherwise mute
 * somebody who has a perfectly good microphone.
 *
 * This surface has **no reference capture** — it is the first of three designed
 * from Zoom convention rather than from the supplied screenshots, and it is
 * documented as unvalidated in the README rather than presented as matched.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  Meeting,
  explainApiError,
  getMeeting,
  getSession,
  updateDisplayName,
} from "@/lib/api";
import { UNTITLED } from "@/lib/meetings";
import {
  CAMERA_PROBLEM_TEXT,
  MICROPHONE_PROBLEM_TEXT,
  CameraProblem,
  getLocalMedia,
  stopStream,
} from "@/lib/media";
import { savePreJoinChoices } from "@/lib/prejoin";

import styles from "./PreJoin.module.css";

type Props = {
  /** The Meeting's internal id, the same address the room uses. */
  meetingUuid: string;
};

/** The failure sentence when the API cannot say what went wrong. */
const ENTER_FAILED = "We could not enter this meeting. Please try again in a moment.";

/**
 * Which device problems are the user's own doing, and so worth a retry.
 *
 * "Denied" is recoverable — a person who blocked the camera may unblock it — so
 * the screen offers the try again that could actually work. "No device" and
 * "unsupported" are not: retrying a machine with no webcam produces the same
 * answer for ever, and a button that can only fail is a promise not kept.
 *
 * Held as the problem *kind* rather than tested against the rendered sentence,
 * because a copy change to the wording must not silently remove the retry — the
 * decision is about the failure, not about the words describing it.
 */
const WORTH_RETRYING = new Set<CameraProblem>(["denied", "busy"]);

export function PreJoin({ meetingUuid }: Props) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [nameLoading, setNameLoading] = useState(true);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  // Held as the problem *kind* rather than as the rendered sentence: the words
  // are derived where they are shown, and the retry decision below is about the
  // failure rather than about how it is described.
  const [cameraProblem, setCameraProblem] = useState<CameraProblem | null>(null);
  const [microphoneProblem, setMicrophoneProblem] = useState<CameraProblem | null>(
    null,
  );
  const [entering, setEntering] = useState(false);
  // Whether the two device answers have come back yet. The toggles read `true`
  // until they do — that is the state a person is in who has not been asked, and
  // starting them off would be a worse surprise — which means for a moment after
  // arrival the screen is showing a decision it is about to revise. Tests cannot
  // see a permission prompt they never saw, so without this a test that reads a
  // toggle's state can read it before the browser has answered, and then be
  // right about the DOM and wrong about the meeting.
  const [devicesPending, setDevicesPending] = useState(true);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  // Held in a ref as well as state because the stream is a DOM object rather than
  // something to re-render, and because the cleanup below needs it without
  // depending on a render having happened since.
  const streamRef = useRef<MediaStream | null>(null);

  // The Meeting, for the title and for knowing whether this is even a Meeting
  // worth entering. A Meeting that has ended refuses here rather than after the
  // person has arranged their camera.
  useEffect(() => {
    let cancelled = false;

    getMeeting(meetingUuid)
      .then((loaded) => {
        if (!cancelled) setMeeting(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(explainApiError(cause, ENTER_FAILED));
      });

    return () => {
      cancelled = true;
    };
  }, [meetingUuid]);

  // The Display Name, so the field is pre-filled with something rather than
  // empty. A failure here is not reported: the field is editable and the person
  // can type their own name, which is what somebody on a borrowed machine would
  // do anyway.
  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((session) => {
        if (!cancelled) setDisplayName(session.display_name);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setNameLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The devices, once, on arrival.
   *
   * Not re-run when a toggle changes: turning the camera *off* here is a
   * decision about whether to send video, and the browser's own track still
   * belongs to this screen until it is left. Re-asking on every toggle would
   * re-prompt for a permission the person has already answered.
   */
  useEffect(() => {
    let cancelled = false;

    getLocalMedia().then(({ video, cameraProblem, audio, microphoneProblem }) => {
      if (cancelled) {
        // Arrived after leaving. Give the devices straight back rather than
        // holding a camera open on a screen nobody is watching.
        stopStream(video);
        stopStream(audio);
        return;
      }

      streamRef.current = video;
      if (video && previewRef.current) {
        previewRef.current.srcObject = video;
        // `muted` and `playsInline` so the browser does not treat an unmuted
        // autoplay as noise the user did not ask for, and so iOS does not take
        // the video fullscreen the moment it plays.
        void previewRef.current.play().catch(() => undefined);
      }
      // The microphone is asked for and then released. Nothing here plays it —
      // ADR-0001 has remote audio simulated and there is no peer connection to
      // feed — so a live track would be a recording indicator on a device that
      // is capturing nothing. The permission it asked for is what the screen
      // needs to know; the stream is not.
      stopStream(audio);

      // A missing device means the matching toggle starts *off*, because the
      // button would otherwise claim video is on while nothing is being sent.
      setCameraProblem(cameraProblem);
      setMicrophoneProblem(microphoneProblem);
      if (cameraProblem) setCameraOn(false);
      if (microphoneProblem) setMicrophoneOn(false);
      setDevicesPending(false);
    });

    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const nameIsUsable = displayName.trim().length > 0;
  const canEnter = nameIsUsable && !entering && meeting !== null;

  async function enter() {
    if (!canEnter || !meeting) return;

    setEntering(true);

    // The name is stored before entering, so a failure part-way through leaves it
    // saved — and the room reads the name from the session rather than carrying
    // a second copy in memory that could disagree with what everyone else sees.
    let storedName: string;
    try {
      storedName = (await updateDisplayName(displayName)).display_name;
    } catch (cause: unknown) {
      setEntering(false);
      setLoadError(
        cause instanceof ApiError && cause.detail
          ? cause.detail
          : "We could not save your name. Please try again.",
      );
      return;
    }

    // Device preferences cross to the room through storage rather than the URL,
    // so nothing about this person ends up in a link they might paste. A storage
    // failure is *not* an error: the room falls back to its own defaults and the
    // person still joins.
    savePreJoinChoices(meetingUuid, {
      displayName: storedName,
      microphoneOn,
      cameraOn,
    });

    router.push(`/room/${meeting.id}`);
  }

  if (loadError) {
    return (
      <main className={styles.main}>
        <p role="alert" className={styles.error} data-testid="prejoin-error">
          {loadError}
        </p>
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
      </header>

      {/* `data-devices` says whether the two device answers have come back. It
          is here for the browser tests, which otherwise read a toggle mid-
          question and are right about the DOM and wrong about the meeting — a
          permission prompt is not something a test can watch happen. */}
      <main
        className={styles.main}
        data-devices={devicesPending ? "pending" : "settled"}
      >
        <h1 className={styles.title} data-testid="prejoin-title">
          {meeting?.title ?? UNTITLED}
        </h1>
        <p className={styles.subtitle}>
          Check how you look and how you sound before you enter. There is no
          password.
        </p>

        {/* The preview and its stand-in share one box so the screen does not
            change size when the camera fails — a layout that jumps when a person
            clicks "Block" is disorienting at exactly the moment they are least
            expecting it. */}
        <div className={styles.stage}>
          {cameraOn && !cameraProblem ? (
            <video
              ref={previewRef}
              className={styles.preview}
              data-testid="camera-preview"
              autoPlay
              muted
              playsInline
            />
          ) : (
            <div className={styles.fallback} data-testid="camera-fallback">
              <span className={styles.fallbackName} aria-hidden="true">
                {initialsOf(displayName)}
              </span>
              <p className={styles.fallbackText}>
                {cameraOn
                  ? "Your camera is off."
                  : "You will enter with your camera off."}
              </p>
            </div>
          )}
        </div>

        {cameraProblem ? (
          <p className={styles.notice} data-testid="camera-notice" role="status">
            {CAMERA_PROBLEM_TEXT[cameraProblem]}
            {WORTH_RETRYING.has(cameraProblem) ? (
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => void retryDevices()}
                data-testid="retry-devices"
              >
                Try again
              </button>
            ) : null}
          </p>
        ) : null}

        {microphoneProblem ? (
          <p
            className={styles.notice}
            data-testid="microphone-notice"
            role="status"
          >
            {MICROPHONE_PROBLEM_TEXT[microphoneProblem]}
          </p>
        ) : null}

        <div className={styles.controls}>
          <DeviceToggle
            label="Microphone"
            testId="toggle-microphone"
            pressed={microphoneOn}
            onChange={setMicrophoneOn}
          />
          <DeviceToggle
            label="Camera"
            testId="toggle-camera"
            pressed={cameraOn}
            onChange={setCameraOn}
          />
        </div>

        <label className={styles.label} htmlFor="prejoin-name">
          Your name
        </label>
        <input
          id="prejoin-name"
          className={styles.input}
          placeholder="The name other participants will see"
          autoComplete="name"
          value={displayName}
          disabled={nameLoading}
          onChange={(event) => setDisplayName(event.target.value)}
          data-testid="display-name"
        />
        <p className={styles.hint}>
          This is the name people will see. You can change it here rather than
          being called something you did not choose.
        </p>

        <button
          type="button"
          className={styles.joinButton}
          disabled={!canEnter}
          onClick={() => void enter()}
          data-testid="join-button"
        >
          {entering ? "Joining…" : "Join meeting"}
        </button>
      </main>
    </div>
  );

  /** Ask again, for a person who blocked the camera and has now unblocked it. */
  async function retryDevices() {
    stopStream(streamRef.current);
    // Back to pending for the same reason as on arrival: the toggles are about to
    // be revised, and anything reading them mid-question is reading a decision
    // that has not been made yet.
    setDevicesPending(true);
    const { video, cameraProblem, audio, microphoneProblem } = await getLocalMedia();
    // Same as on arrival: the audio is released rather than held.
    stopStream(audio);
    streamRef.current = video;
    if (video && previewRef.current) {
      previewRef.current.srcObject = video;
      void previewRef.current.play().catch(() => undefined);
    }
    setCameraProblem(cameraProblem);
    setMicrophoneProblem(microphoneProblem);
    setCameraOn(!cameraProblem);
    setMicrophoneOn(!microphoneProblem);
    setDevicesPending(false);
  }
}

/**
 * One on/off control for one device.
 *
 * `aria-pressed` rather than a checkbox: these are toggles that act on a live
 * device, and the pressed state is what a screen reader needs to announce for
 * somebody who cannot see the camera light come on.
 */
function DeviceToggle({
  label,
  testId,
  pressed,
  onChange,
}: {
  label: string;
  testId: string;
  pressed: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={pressed ? styles.toggleOn : styles.toggleOff}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      data-testid={testId}
    >
      <span className={styles.toggleIcon} aria-hidden="true">
        {pressed ? "◉" : "○"}
      </span>
      {label}
      <span className={styles.toggleState}>
        {pressed ? "On" : "Off"}
      </span>
    </button>
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
