import { Join } from "@/components/Join/Join";

/**
 * The Invite Link's route: `/join/<meeting id>`.
 *
 * The code is a path segment, not a query parameter, because this is a place you
 * can be sent to — pasted into a chat, mailed, opened on a phone. The Invite
 * Link the host copies is this path, and it stopped being a 404 in this ticket.
 *
 * No validation happens here. The link can carry anything a person mistypes into
 * it, and a malformed code is refused with a plain explanation at the API rather
 * than being turned into a Next.js not-found page that says nothing useful.
 */
export default async function JoinByCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <Join joinCode={decodeURIComponent(code)} />;
}
