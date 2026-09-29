/**
 * The join screen: one place both ways in arrive.
 *
 * The Invite Link lands on `/join/<code>` with the field already filled, and the
 * dashboard's Join Meeting button lands on `/join` with it empty. Both are the
 * same component and the same lookup, because they are the same Meeting — the
 * two identifiers are an addressing choice, not two features (ADR-0004).
 *
 * The Display Name is confirmed here rather than in the room, because a name is
 * only worth confirming before anyone else has seen it. The pre-join screen will
 * move this alongside a camera preview; until then the confirmation lives on the
 * one screen that both entry points pass through.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ApiError,
  Meeting,
  explainApiError,
  getMeetingByJoinCode,
  getSession,
  isJoinCodeShape,
  updateDisplayName,
} from "@/lib/api";

import styles from "./Join.module.css";

type Props = {
  /** The code an Invite Link carried, if the person arrived by one. */
  joinCode?: string;
};

/**
 * Why the meeting could not be entered, in the words of someone who was told a
 * number by a colleague and got it slightly wrong.
 *
 * The 5xx sentence is this screen's own — "we could not join that meeting" and
 * "we could not schedule one" are different reactions — while which of the
 * three cases applies is decided by `explainApiError`, which every screen
 * needing it shares. The API's own `detail` is preferred either way, because it
 * is written for the person rather than for the developer.
 */
const SERVER_FAULT = "We could not join that meeting. Please try again in a moment.";

export function Join({ joinCode }: Props) {
  const router = useRouter();
  const [code, setCode] = useState(joinCode ?? "");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((session) => {
        if (!cancelled) setDisplayName(session.display_name);
      })
      // A missing pre-fill is not a failure worth reporting: the field is
      // editable, and the person joining can type their name themselves.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const codeIsValid = isJoinCodeShape(code);
  const nameIsUsable = displayName.trim().length > 0;
  const canJoin = codeIsValid && nameIsUsable && !joining;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canJoin) return;

    setJoining(true);
    setError(null);

    // The Meeting is resolved first, so an unknown or finished one is refused
    // before anything is written. The name is then stored *before* entering: a
    // failure part-way through leaves it saved rather than silently discarded,
    // and the room reads it from one place instead of carrying a second copy in
    // memory. The two failures are reported apart, because "your name was
    // rejected" and "that meeting has ended" call for different reactions.
    let meeting: Meeting;
    try {
      meeting = await getMeetingByJoinCode(code);
    } catch (cause: unknown) {
      setJoining(false);
      setError(explainApiError(cause, SERVER_FAULT));
      return;
    }

    let storedName: string;
    try {
      storedName = (await updateDisplayName(displayName)).display_name;
    } catch (cause: unknown) {
      setJoining(false);
      setError(
        cause instanceof ApiError && cause.detail
          ? cause.detail
          : "We could not save your name. Please try again.",
      );
      return;
    }

    // The field shows what was stored, not what was typed — a name truncated to
    // the column's length would otherwise be corrected here and nowhere else.
    setDisplayName(storedName);
    router.push(`/room/${meeting.id}`);
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

      <main className={styles.main}>
        <h1 className={styles.title}>Join a meeting</h1>
        <p className={styles.subtitle}>
          Enter the Meeting ID you were given, or follow the Invite Link. There is no
          password and no login.
        </p>

        {error ? (
          <p role="alert" className={styles.error} data-testid="join-error">
            {error}
          </p>
        ) : null}

        <form className={styles.card} onSubmit={submit}>
          <label className={styles.label} htmlFor="join-code">
            Meeting ID
          </label>
          <input
            id="join-code"
            className={styles.input}
            // Eleven digits, grouped 3-4-4 — the widest thing this field ever
            // holds is the grouped form, so the width suits it.
            placeholder="123 456 789 01"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={!joinCode}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            data-testid="join-code"
          />
          <p className={styles.hint}>
            Eleven digits, grouped so it can be read out over a phone call.
          </p>

          <label className={styles.label} htmlFor="display-name">
            Your name
          </label>
          <input
            id="display-name"
            className={styles.input}
            placeholder="The name other participants will see"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            data-testid="display-name"
          />
          <p className={styles.hint}>
            Confirm this before you enter — it is the name people will see.
          </p>

          <button
            type="submit"
            className={styles.joinButton}
            disabled={!canJoin}
            data-testid="join-button"
          >
            {joining ? "Joining…" : "Join"}
          </button>
        </form>

        <Link className={styles.backLink} href="/">
          Back to the dashboard
        </Link>
      </main>
    </div>
  );
}
