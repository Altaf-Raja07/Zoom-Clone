import { Schedule } from "@/components/Schedule/Schedule";

/**
 * The schedule route: `/schedule`.
 *
 * Reached from the dashboard's Schedule Meeting action, and nowhere else — a
 * scheduled Meeting is not something a link points at, since the Invite Link it
 * produces is the only thing worth sending to someone else.
 */
export default function SchedulePage() {
  return <Schedule />;
}
