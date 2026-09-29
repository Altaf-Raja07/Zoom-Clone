/**
 * What a Meeting with no title is called.
 *
 * Its own module rather than a constant in one of the two components that need
 * it, because three surfaces now fall back to these words — the schedule
 * confirmation, Upcoming and Recent — and two copies of a fallback is one
 * rename away from the same Meeting being called two different things on one
 * page.
 *
 * A title is optional by design (ADR-0004: a blank field is stored as absence),
 * so the fallback is not an edge case to be tidied away later; it is what a
 * screen shows whenever a host did not write anything.
 */
export const UNTITLED = "Untitled meeting";
