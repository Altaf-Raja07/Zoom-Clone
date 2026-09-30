/**
 * The local camera and microphone, and what went wrong when they do not arrive.
 *
 * Three things live here rather than in a component, and each earns its place:
 *
 * - **Asking the browser.** `getUserMedia` is not called from a component, so
 *   there is one call site and one place that knows what it asked for.
 * - **Naming the failure.** `getUserMedia` rejects with a `DOMException` whose
 *   `name` is the only thing distinguishing "you clicked Block" from "this
 *   laptop has no webcam". Passing that raw to the screen would show a person a
 *   device-error code, which is the opposite of the ticket's requirement.
 * - **Giving it back.** Every track is stopped on release. A preview left
 *   running keeps the camera light on after the person has left the screen, and
 *   holding a microphone open after they have muted is worse.
 *
 * Note what is *absent*: no `RTCPeerConnection`, no device enumeration, no
 * device *selection*. ADR-0001 says why — this is a local preview, and remote
 * participants are simulated. Adding peer connections here would work on
 * localhost and fail in the deployed demo.
 */

/** What the browser told us when it would not give us a device. */
export type CameraProblem =
  /** The person said no, or the page is not allowed to ask. */
  | "denied"
  /** There is no such device on this machine. */
  | "missing"
  /** The device exists but something else is using it. */
  | "busy"
  /** Anything else, including no `getUserMedia` at all. */
  | "unsupported";

/**
 * What the pre-join screen needs to know about the devices.
 *
 * A stream *and* the failure that replaced it, never both: `problem: null` with a
 * stream is the working case, and a `problem` with a stream would be a stream the
 * caller has to remember to ignore.
 */
export type LocalMedia = {
  stream: MediaStream | null;
  problem: CameraProblem | null;
};

/**
 * The sentence for each failure, written for the person rather than the console.
 *
 * Two of these must say what to *do*, not only what happened. "NotAllowedError"
 * leaves a user on a black tile wondering whether the app is broken; "your
 * browser is blocking the camera for this site" tells them there is a permission
 * to grant, and that joining is still on the table either way.
 */
export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, string> = {
  denied:
    "Your browser is blocking the camera for this site. You can allow it in your browser's site settings, or join without video.",
  missing:
    "No camera was found on this device. You can join without video, and turn video on later if a camera turns up.",
  busy: "Your camera is being used by another application. Close it, or join without video.",
  unsupported:
    "This browser did not give us a camera. You can still join and be heard.",
};

/** The same, for the microphone, which fails independently of the camera. */
export const MICROPHONE_PROBLEM_TEXT: Record<CameraProblem, string> = {
  denied:
    "Your browser is blocking the microphone for this site. You can allow it in your browser's site settings, or join muted.",
  missing: "No microphone was found on this device. You can join and be seen, but not heard.",
  busy: "Your microphone is being used by another application. Close it, or join muted.",
  unsupported: "This browser did not give us a microphone. You can still join and be seen.",
};

/**
 * Ask for a camera and a microphone, and report which of them refused.
 *
 * Asked separately rather than as one `getUserMedia({video, audio})` call,
 * because a single call fails *entirely* if either device is missing. That is
 * what turns a machine with no webcam into a person who cannot be heard, and it
 * is the single most important thing this function gets right: the camera and the
 * microphone are independent, and one failing must not take the other down.
 *
 * Neither result is an error to throw. The caller gets both answers either way,
 * because "here is your video" and "here is why you have none" are two renderings
 * of the same screen and the caller has to be able to draw both.
 */
export async function getLocalMedia(): Promise<{
  video: MediaStream | null;
  cameraProblem: CameraProblem | null;
  audio: MediaStream | null;
  microphoneProblem: CameraProblem | null;
}> {
  const [video, cameraProblem] = await requestDevice("video");
  const [audio, microphoneProblem] = await requestDevice("audio");

  return { video, cameraProblem, audio, microphoneProblem };
}

/**
 * One device, and the reason it did not arrive.
 *
 * A tuple rather than a Result type because there are exactly two things a
 * caller can do with it and both are one destructuring away, and because a
 * `try`/`catch` at every call site would be four copies of the same `name`
 * switch.
 */
async function requestDevice(
  kind: "video" | "audio",
): Promise<[MediaStream | null, CameraProblem | null]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    // Not an error worth rendering as one: there is no camera on this platform at
    // all, which is the same situation as a machine without a webcam.
    return [null, "unsupported"];
  }

  try {
    return [await navigator.mediaDevices.getUserMedia({ [kind]: true }), null];
  } catch (cause: unknown) {
    return [null, classify(cause)];
  }
}

/**
 * The browser's `DOMException.name`, as one of our four problems.
 *
 * Names are matched rather than exception types because browsers do not agree on
 * which class each failure is — `NotFoundError` and `DevicesNotFoundError` are
 * the same fact under two names — and `name` is the one property all of them have
 * and all of them document.
 */
function classify(cause: unknown): CameraProblem {
  const name = (cause as { name?: string } | null)?.name;

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    default:
      return "unsupported";
  }
}

/**
 * Stop every track on a stream.
 *
 * Called when leaving the pre-join screen. Without it the camera light stays on
 * for a screen nobody is watching, and the device is held against the room that
 * is supposed to be using it.
 */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
