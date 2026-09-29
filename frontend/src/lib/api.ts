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
    throw new ApiError(`Request to ${path} failed`, response.status);
  }
  return response.json() as Promise<T>;
}

export type Session = {
  id: string;
  display_name: string;
  is_new: boolean;
};

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
  scheduled_start_at: string | null;
  started_at: string | null;
  created_at: string;
  is_host: boolean;
  host: { id: string; display_name: string };
};

export function createMeeting(): Promise<Meeting> {
  return apiFetch<Meeting>("/api/meetings", { method: "POST" });
}

export function getMeeting(meetingUuid: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/api/meetings/${meetingUuid}`);
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
