/**
 * The landing dashboard.
 *
 * For this ticket it establishes one thing end to end: a first-time visitor
 * arrives with no login step and is greeted by name. The three primary actions
 * and the Upcoming / Recent sections arrive with the dashboard ticket.
 */

"use client";

import { useEffect, useState } from "react";

import { ApiError, Session, apiFetch } from "@/lib/api";

import styles from "./Dashboard.module.css";

const PRIMARY_ACTIONS = [
  { key: "new", label: "New Meeting" },
  { key: "join", label: "Join Meeting" },
  { key: "schedule", label: "Schedule Meeting" },
] as const;

export function Dashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<Session>("/api/session")
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
              className={
                action.key === "new"
                  ? `${styles.actionButton} ${styles.actionPrimary}`
                  : styles.actionButton
              }
            >
              {action.label}
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
