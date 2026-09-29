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
