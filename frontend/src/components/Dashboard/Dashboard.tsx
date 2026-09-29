/**
 * The landing dashboard.
 *
 * Ticket 01 established one thing end to end: a first-time visitor arrives with
 * no login step and is greeted by name. This ticket makes two of the three
 * primary actions real — New Meeting creates a Meeting and walks the host into
 * the room, and Join Meeting opens the join screen. The Upcoming / Recent
 * sections arrive with the dashboard ticket.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, Session, createMeeting, getSession } from "@/lib/api";

import styles from "./Dashboard.module.css";

const PRIMARY_ACTIONS = [
  { key: "new", label: "New Meeting" },
  { key: "join", label: "Join Meeting" },
  { key: "schedule", label: "Schedule Meeting" },
] as const;

type ActionKey = (typeof PRIMARY_ACTIONS)[number]["key"];

export function Dashboard() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((loaded) => {
        if (!cancelled) setSession(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? "We could not reach the server. Please try again."
            : "Something went wrong loading your session.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function startMeeting() {
    setStarting(true);
    setError(null);
    try {
      const meeting = await createMeeting();
      // Pushing rather than linking, so Back returns to a dashboard that still
      // has the session on it rather than re-fetching the whole app.
      router.push(`/room/${meeting.id}`);
    } catch {
      setStarting(false);
      setError("We could not start a meeting. Please try again.");
    }
  }

  function onAction(action: ActionKey) {
    if (action === "new") {
      void startMeeting();
      return;
    }
    if (action === "join") {
      // Pushed rather than linked, for the same reason New Meeting pushes: Back
      // should return to a dashboard that still has the session on it.
      router.push("/join");
      return;
    }
    // Schedule is its own ticket; saying nothing beats a button that pretends.
    setError(`${PRIMARY_ACTIONS.find((a) => a.key === action)?.label} is not built yet.`);
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
        <div className={styles.navRight}>
          {session ? (
            <span className={styles.greeting} data-testid="greeting">
              Hi, {session.display_name}
            </span>
          ) : null}
          <a className={styles.settingsLink} href="#settings" aria-label="Settings">
            <span aria-hidden="true">⚙</span>
          </a>
          {session ? (
            <span
              className={styles.avatar}
              aria-hidden="true"
              data-testid="avatar"
            >
              {initialsOf(session.display_name)}
            </span>
          ) : null}
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Meetly</h1>
        <p className={styles.subtitle}>
          {session
            ? `You are signed in as ${session.display_name}. No password needed.`
            : "Getting your session…"}
        </p>

        {error ? (
          <p role="alert" className={styles.subtitle}>
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          {PRIMARY_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={starting && action.key === "new"}
              className={
                action.key === "new"
                  ? `${styles.actionButton} ${styles.actionPrimary}`
                  : styles.actionButton
              }
              onClick={() => onAction(action.key)}
            >
              {starting && action.key === "new" ? "Starting…" : action.label}
            </button>
          ))}
        </div>
      </main>
    </div>
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
