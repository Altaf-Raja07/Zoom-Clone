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
  DeviceProblem,
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
const WORTH_RETRYING = new Set<DeviceProblem>(["denied", "busy"]);

export function PreJoin({ meetingUuid }: Props) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  // A Meeting that could not be read, and a name that could not be stored, are
  // kept apart. They are different failures with different recoveries: the first
  // means there is nothing here to enter, the second means everything is here
  // except one field, and replacing the whole form with a sentence about a
  // rejected name would throw away a camera the person has already arranged.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enterError, setEnterError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [nameLoading, setNameLoading] = useState(true);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  // Held as the problem *kind* rather than as the rendered sentence: the words
  // are derived where they are shown, and the retry decision below is about the
  // failure rather than about how it is described.
  const [cameraProblem, setCameraProblem] = useState<DeviceProblem | null>(null);
  const [microphoneProblem, setMicrophoneProblem] = useState<DeviceProblem | null>(
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

  // The camera stream, in state rather than a ref, and the reason is that two
  // things have to happen when it arrives and they happen at different times: it
  // has to be attached to the preview element, and it has to be stopped when this
  // screen goes away. An effect keyed on it does both, and — the case the ticket
  // forbids — re-runs when the *element* changes too, so turning the camera off
  // and on again re-attaches rather than leaving a mounted `<video>` with nothing
  // in it and the camera light on.
  const [stream, setStream] = useState<MediaStream | null>(null);
  // The preview element as a **callback ref**, not a `useRef` object. The preview
  // is unmounted whenever the camera is off or has failed, so an effect with no
  // dependency on the element would never hear about the new one, and there would
  // be a window in which a video tag is on screen with nothing in it.
  const [previewElement, setPreviewElement] = useState<HTMLVideoElement | null>(
    null,
  );
  // Counts the device requests in flight, so a retry that arrives after a second
  // retry — or after the person has left — is recognised as stale and its stream
  // handed straight back instead of overwriting the live one. Without it, two
  // clicks on "Try again" leak a camera and the person is left with a preview of a
  // stream nobody is holding. A ref because it is a counter read and written
  // outside rendering, and never drawn.
  const requestRef = useRef(0);

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
   * Ask for the devices, and put the answer on the screen.
   *
   * One function, called on arrival and by every retry, because the two places
   * used to be a copy each and only the copy was careful: the effect version
   * knew how to give a stream back if it arrived after the person had left, and
   * the retry version did not — so leaving during a retry left the camera light
   * on for a screen nobody was watching. One code path has no such gap.
   */
  async function refreshDevices() {
    const request = (requestRef.current += 1);
    setDevicesPending(true);

    const { video, cameraProblem, audio, microphoneProblem } = await getLocalMedia();

    // The microphone is asked for and then released. Nothing here plays it —
    // ADR-0001 has remote audio simulated and there is no peer connection to feed
    // — so a live track would be a recording indicator on a device that is
    // capturing nothing. The permission it asked for is what the screen needs to
    // know; the stream is not.
    stopStream(audio);

    // Superseded by a later request, or the person has left. Either way this
    // stream was never going to be looked at, and holding it is the one outcome
    // the whole file treats as worst.
    if (request !== requestRef.current) {
      stopStream(video);
      return;
    }

    // Setting the stream rather than assigning it to a ref: the effect below owns
    // the camera's lifetime, and it can only do that for something React knows
    // changed. The previous stream is stopped by that effect's cleanup, so a retry
    // on a machine whose camera was freed and re-taken does not leave two tracks
    // running on one device.
    setStream(video);

    // A failed device means the matching toggle is *off*, because the button
    // would otherwise claim video is on while nothing is being sent — and the
    // room would be told the same lie.
    setCameraProblem(cameraProblem);
    setMicrophoneProblem(microphoneProblem);
    setCameraOn(!cameraProblem);
    setMicrophoneOn(!microphoneProblem);
    setDevicesPending(false);
  }

  /**
   * The devices, once, on arrival.
   *
   * Not re-run when a toggle changes: turning the camera *off* here is a
   * decision about whether to send video, and the browser's own track still
   * belongs to this screen until it is left. Re-asking on every toggle would
   * re-prompt for a permission the person has already answered.
   */
  useEffect(() => {
    void refreshDevices();

    return () => {
      // Invalidate anything in flight. The stream already held is stopped by the
      // effect below; this is only about the one that has not arrived yet.
      requestRef.current += 1;
    };
  }, []);

  /**
   * The camera's whole lifetime, in one effect.
   *
   * Two jobs, deliberately in one place. **Stopping it** is the one this file
   * treats as worst: a camera left running on a screen that is no longer on
   * screen is a light that stays on after the person has gone, and nothing else
   * here would remember to stop it. **Attaching it** is the one the ticket
   * forbids failing: the preview is unmounted whenever the camera is off, so the
   * dependency on the element is what re-attaches the stream when it comes back
   * rather than leaving a video tag with nothing in it.
   */
  useEffect(() => {
    if (!stream) return;
    return () => stopStream(stream);
  }, [stream]);

  useEffect(() => {
    if (!previewElement || !stream) return;
    previewElement.srcObject = stream;
    // `muted` and `playsInline` are attributes on the element for the same
    // reasons; the `play()` is because a freshly mounted element does not start
    // on its own in every browser, and a rejected promise here is a browser
    // autoplay policy rather than anything the person did.
    void previewElement.play().catch(() => undefined);
  }, [previewElement, stream]);

  const nameIsUsable = displayName.trim().length > 0;
  const canEnter = nameIsUsable && !entering && meeting !== null;

  async function enter() {
    if (!canEnter || !meeting) return;

    setEntering(true);
    setEnterError(null);

    // The name is stored before entering, so a failure part-way through leaves it
    // saved — and the room reads the name from the session rather than carrying
    // a second copy in memory that could disagree with what everyone else sees.
    //
    // A failure here is reported *in place*, with the form still on screen. The
    // Meeting loaded; it is one field the API would not take, and replacing a
    // camera the person has already arranged with a sentence would be the most
    // destructive way to tell them so.
    try {
      await updateDisplayName(displayName);
    } catch (cause: unknown) {
      setEntering(false);
      setEnterError(
        cause instanceof ApiError && cause.detail
          ? cause.detail
          : "We could not save your name. Please try again.",
      );
      return;
    }

    // Device preferences cross to the room through storage rather than the URL,
    // so nothing about this person ends up in a link they might paste. The name
    // is not here: it is on the `User` now, and a second copy would be a second
    // chance to disagree. A storage failure is *not* an error: the room falls
    // back to its own defaults and the person still joins.
    savePreJoinChoices(meetingUuid, { microphoneOn, cameraOn });

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
              ref={setPreviewElement}
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
                {cameraProblem
                  ? "You will enter with your camera off."
                  : "Your camera is off."}
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
                onClick={() => void refreshDevices()}
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
            onChange={(next) => {
              // The same answer for a microphone that was never there: pressing
              // "On" asks again rather than claiming to be sending audio.
              if (next && microphoneProblem) {
                void refreshDevices();
                return;
              }
              setMicrophoneOn(next);
            }}
          />
          <DeviceToggle
            label="Camera"
            testId="toggle-camera"
            pressed={cameraOn}
            onChange={(next) => {
              // Turning a *failed* camera on asks the browser again, rather than
              // flipping the button to "On" while nothing is being sent and the
              // room is about to be told the opposite. A person who has just
              // unblocked the site in another tab gets their camera this way,
              // without hunting for the retry link.
              if (next && cameraProblem) {
                void refreshDevices();
                return;
              }
              setCameraOn(next);
            }}
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

        {/* Where the name is refused. Above the Join control and not instead of
            it, so the person can fix the one field and press it again rather than
            being told something went wrong and left with nothing to do. */}
        {enterError ? (
          <p role="alert" className={styles.error} data-testid="prejoin-enter-error">
            {enterError}
          </p>
        ) : null}

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
