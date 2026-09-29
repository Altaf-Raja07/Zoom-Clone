/**
 * Where the frontend finds the backend.
 *
 * The browser talks to FastAPI directly rather than through a Next.js proxy:
 * the WebSocket has to connect directly anyway, and one CORS configuration is
 * easier to reason about than a cookie story on one path and none on the other
 * (SPEC.md, Network topology). The browser must send the identity cookie, which
 * is why `credentials: "include"` appears on every request.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * The `detail` the API sent, when it sent one.
     *
     * Carried rather than discarded because FastAPI's refusals are already
     * written for a person — "No meeting has that Meeting ID." — and a second
     * copy of that sentence in the frontend is a second thing to keep in step
     * with the first. The frontend falls back to its own wording only for a
     * failure the API had no detail for.
     */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    // Without this the browser silently drops the identity cookie, and the
    // symptom is a guest who is mysteriously a new guest on every request.
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    // `detail` is not always a string — FastAPI puts a list of validation errors
    // there for a malformed body — so anything else is treated as no detail
    // rather than rendered as `[object Object]` on the page.
    const body = (await response.json().catch(() => null)) as {
      detail?: unknown;
    } | null;
    const detail = typeof body?.detail === "string" ? body.detail : undefined;

    throw new ApiError(`Request to ${path} failed`, response.status, detail);
  }
  return response.json() as Promise<T>;
}

export type Session = {
  id: string;
  display_name: string;
  is_new: boolean;
};

/**
 * The sentence for a request that never reached the server.
 *
 * One string, and not a parameter, because it means the same thing wherever it
 * appears: no reply, so nothing was decided. The wording that *does* depend on
 * the screen — "we could not join that meeting" rather than "we could not
 * schedule one" — is the 5xx case, and that one is passed in.
 */
export const UNREACHABLE = "We could not reach the server. Please try again.";

/**
 * The sentence a person reads when a request failed.
 *
 * The API's own `detail` wins, because it is written for the person rather than
 * for the developer. The fallbacks cover the two failures the API cannot
 * describe: a server that answered with a 5xx, and a network that never
 * answered at all.
 */
export function explainApiError(cause: unknown, serverFault: string): string {
  if (cause instanceof ApiError) {
    if (cause.detail) return cause.detail;
    if (cause.status >= 500) return serverFault;
  }
  return UNREACHABLE;
}

/**
 * A Meeting, as the API describes it.
 *
 * `meeting_id` is the grouped form a host reads aloud and `join_code` the stored
 * form it comes from. The grouping is done by the backend on purpose — it is a
 * product convention, and a convention the frontend invents is a convention the
 * frontend can get wrong.
 */
export type Meeting = {
  id: string;
  meeting_id: string;
  join_code: string;
  invite_path: string;
  title: string | null;
  description: string | null;
  scheduled_start_at: string | null;
  duration_minutes: number | null;
  started_at: string | null;
  created_at: string;
  is_host: boolean;
  host: { id: string; display_name: string };
};

/**
 * What a host books a Meeting with.
 *
 * `scheduled_start_at` is an instant with its offset attached, not a wall-clock
 * reading: the browser is the only thing here that knows which time zone the
 * person in front of it is in, so it resolves the date and time they picked
 * against their own clock and sends the moment. Time-zone selection is out of
 * scope, and the API refuses a timestamp that carries no zone rather than
 * guessing one.
 *
 * The title and description are optional, and sent as `null` when left blank,
 * so that a field nobody filled in is stored as absence rather than as a
 * string of spaces every later screen would have to know to hide.
 */
export type ScheduleMeetingInput = {
  title: string | null;
  description: string | null;
  scheduled_start_at: string;
  duration_minutes: number;
};

export function getSession(): Promise<Session> {
  return apiFetch<Session>("/api/session");
}

export function createMeeting(): Promise<Meeting> {
  return apiFetch<Meeting>("/api/meetings", { method: "POST" });
}

export function scheduleMeeting(input: ScheduleMeetingInput): Promise<Meeting> {
  return apiFetch<Meeting>("/api/meetings/scheduled", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getMeeting(meetingUuid: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/api/meetings/${meetingUuid}`);
}

/**
 * The Meeting an Invite Link or a typed Meeting ID points at.
 *
 * The other way in, and the reason the Meeting has a second identifier. The code
 * is interpolated encoded because a person who followed a badly-formed link can
 * put almost anything in that segment, and a `/` in it would otherwise change
 * which endpoint is being called.
 */
export function getMeetingByJoinCode(joinCode: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/api/meetings/by-code/${encodeURIComponent(joinCode)}`);
}

/**
 * Confirm the Display Name.
 *
 * The resolved value is returned rather than assumed, because the stored name is
 * trimmed and truncated — so echoing the browser's own text back could show a
 * different name from the one everyone else sees.
 */
export function updateDisplayName(displayName: string): Promise<Session> {
  return apiFetch<Session>("/api/session", {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
}

/**
 * Whether a typed value could be a Meeting ID, for disabling the Join control.
 *
 * A copy of the backend's rule, and deliberately only that: it decides whether
 * to offer the button, while the API decides whether to answer. The grouping
 * spaces are forgiven, because a host reads the code out loud and the person
 * listening types it with the spaces in.
 */
export function isJoinCodeShape(typed: string): boolean {
  const bare = typed.replace(/\s+/g, "");
  return /^\d{11}$/.test(bare);
}

/**
 * The Invite Link as an absolute URL.
 *
 * The API returns a path rather than a full URL: it does not know the address
 * the browser is on, and a link that hardcoded a hostname would break the day
 * the app was deployed somewhere else.
 */
export function absoluteInviteLink(invitePath: string): string {
  return new URL(invitePath, window.location.origin).toString();
}
