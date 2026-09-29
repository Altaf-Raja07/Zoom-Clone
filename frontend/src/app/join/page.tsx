import { Join } from "@/components/Join/Join";

/**
 * The typed-ID route: `/join`, with the field empty.
 *
 * The dashboard's Join Meeting action sends people here, and so does anyone who
 * has a number but no link. Same screen as `/join/<code>` — one component, one
 * lookup — because the two are the same Meeting reached by two identifiers.
 */
export default function JoinPage() {
  return <Join />;
}
