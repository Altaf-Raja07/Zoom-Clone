/**
 * The device choices a person made on the pre-join screen, handed to the room.
 *
 * Pre-join and the room are two routes, so something has to carry two device
 * booleans across. `sessionStorage` does it, keyed by Meeting id, and the
 * reasoning is worth writing down because the alternatives were worse:
 *
 * - **Not the URL.** `/room/<id>?mic=0&cam=1` puts a person's device state in
 *   their address bar, in their history, and in anything they paste. The Invite
 *   Link is a `/join` path precisely so that no such data is ever in it.
 * - **Not the Display Name's route.** The name does not come this way at all: it
 *   is written through the API on the way in, so it lives on the `User` and is
 *   already the truth by the time the room asks. See `PreJoinChoices`.
 * - **Not `localStorage`.** These are decisions about *this* visit — "turn my
 *   video off for this meeting" — and a persistent store would carry them into
 *   the next one. `sessionStorage` is scoped to the tab, which is also the right
 *   scope for "what I chose two seconds ago".
 * - **Not a cookie.** It would travel to the API on every request, and a
 *   device preference is not a fact about the User.
 *
 * The entry is **removed once read**, and that is not tidiness. It is what stops
 * a second meeting in the same tab from inheriting the first one's device state,
 * and what stops a reload from re-applying a decision the person already made.
 * Re-applying would be invisible and wrong: leaving a room and coming back would
 * silently un-mute somebody.
 *
 * Every read is validated and falls back, because `sessionStorage` can be
 * unavailable (private browsing, a blocked origin, a full quota) and can hold
 * anything at all — another tab, an older version of this app, a person editing
 * it in devtools. Storage being broken must never stop somebody joining a meeting.
 */

/** Where the choices are written, and what the room reads. */
export const PREJOIN_KEY_PREFIX = "meetly:prejoin:";

/**
 * What a person chose before entering.
 *
 * **The Display Name is deliberately not one of these.** The two have different
 * lifetimes: a name is a fact about the `User` and is written through the API
 * before the person enters, so it is on the session and every other participant
 * already agrees about it; the two device flags are a decision about *this visit
 * in this tab* and exist nowhere else. Carrying the name here as well would be a
 * second copy of a fact that is already stored once, and two copies of a name
 * are two chances to disagree — the room would have to pick a winner, and either
 * choice can be wrong.
 */
export type PreJoinChoices = {
  microphoneOn: boolean;
  cameraOn: boolean;
};

/**
 * What the room does when there is nothing stored.
 *
 * Both devices on, because that is the state a person is in who has not been
 * asked: a missing entry means they did not come through pre-join, and starting
 * muted-and-dark is a worse surprise than starting as the browser's own defaults
 * would have been.
 */
export const DEFAULT_CHOICES: PreJoinChoices = {
  microphoneOn: true,
  cameraOn: true,
};

function keyFor(meetingUuid: string): string {
  return `${PREJOIN_KEY_PREFIX}${meetingUuid}`;
}

/**
 * Remember the device choices for this Meeting.
 *
 * Returns nothing, and swallows a storage failure entirely. That is the whole
 * contract: a failure costs the person their device preferences for one visit,
 * and the room falls back to its own defaults, so there is no decision left for
 * the caller to make and no error worth rendering. Returning a boolean nobody
 * reads would only invite somebody to act on it.
 */
export function savePreJoinChoices(
  meetingUuid: string,
  choices: PreJoinChoices,
): void {
  try {
    window.sessionStorage.setItem(keyFor(meetingUuid), JSON.stringify(choices));
  } catch {
    // Private browsing, a blocked third-party context, or a full quota. None of
    // those is a reason to stop somebody joining.
  }
}

/**
 * Read and consume the choices for this Meeting.
 *
 * Returns `null` when there are none, which is *not* the same as the defaults:
 * `null` means "nobody chose anything" and the room decides for itself, while the
 * defaults are a choice the room makes on someone's behalf. Callers that need to
 * tell them apart should, and the pre-join flow does not.
 *
 * The entry is deleted on the way out whatever it contained, so a malformed
 * value is discarded rather than re-parsed on every render.
 */
export function takePreJoinChoices(meetingUuid: string): PreJoinChoices | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(keyFor(meetingUuid));
    window.sessionStorage.removeItem(keyFor(meetingUuid));
  } catch {
    return null;
  }

  if (raw === null) return null;

  try {
    return validated(JSON.parse(raw));
  } catch {
    // Not JSON at all. Someone else's value, or a corrupted write.
    return null;
  }
}

/**
 * The stored value, or `null` if it is not the shape we wrote.
 *
 * Checked field by field rather than trusted, because the alternative is a
 * meeting that opens with somebody muted and no camera because a string was
 * truthy where a boolean was expected — a failure with no error to trace it to.
 */
function validated(candidate: unknown): PreJoinChoices | null {
  if (typeof candidate !== "object" || candidate === null) return null;

  const { microphoneOn, cameraOn } = candidate as Record<string, unknown>;
  if (typeof microphoneOn !== "boolean") return null;
  if (typeof cameraOn !== "boolean") return null;

  return { microphoneOn, cameraOn };
}
