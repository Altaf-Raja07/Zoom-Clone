/**
 * The join screen: one place both ways in arrive, and one field.
 *
 * The Invite Link lands on `/join/<code>` with the field already filled, and the
 * dashboard's Join Meeting button lands on `/join` with it empty. Both are the
 * same component and the same lookup, because they are the same Meeting — the
 * two identifiers are an addressing choice, not two features (ADR-0004).
 *
 * **This screen no longer asks for the Display Name.** It used to, because it was
 * the only screen between a link and the room; now that is the pre-join screen's
 * job, which is the one place where the name is worth confirming — beside a live
 * preview, where somebody can see whether they look like the person about to be
 * named. Asking twice would mean correcting it twice.
 *
 * What is left here is the one thing this screen knows that pre-join does not:
 * *which* Meeting. So the field is the Meeting ID, the lookup resolves it, and
 * the result is handed to `/prejoin/<id>` rather than straight to the room.
 *
 * The gate is unchanged and is still applied here: a Meeting that has not started,
 * has ended, or does not exist is refused before anybody reaches a camera prompt
 * for it. Nobody should be asked to fix their microphone for a meeting they were
 * never going to be allowed into.
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
  isJoinCodeShape,
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
 * several cases applies is decided by `explainApiError`, which every screen
 * needing it shares. The API's own `detail` is preferred either way, because it
 * is written for the person rather than for the developer.
 */
const SERVER_FAULT = "We could not join that meeting. Please try again in a moment.";

export function Join({ joinCode }: Props) {
  const router = useRouter();
  const [code, setCode] = useState(joinCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const codeIsValid = isJoinCodeShape(code);
  const canJoin = codeIsValid && !joining;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canJoin) return;

    setJoining(true);
    setError(null);

    // The Meeting is resolved here, on the screen that knows the Meeting ID, and
    // every refusal — malformed, unknown, not yet, over — is reported here
    // rather than two screens later. Pre-join never sees a Meeting it should
    // not be entering, and nobody is prompted for a camera for one.
    let meeting: Meeting;
    try {
      meeting = await getMeetingByJoinCode(code);
    } catch (cause: unknown) {
      setJoining(false);
      setError(explainApiError(cause, SERVER_FAULT));
      return;
    }

    router.push(`/prejoin/${meeting.id}`);
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
            Eleven digits, grouped so it can be read out over a phone call. You
            will get to check your camera and name on the next screen.
          </p>

          <button
            type="submit"
            className={styles.joinButton}
            disabled={!canJoin}
            data-testid="join-button"
          >
            {joining ? "Looking…" : "Continue"}
          </button>
        </form>

        <Link className={styles.backLink} href="/">
          Back to the dashboard
        </Link>
      </main>
    </div>
  );
}
