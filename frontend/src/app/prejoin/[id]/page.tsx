import { PreJoin } from "@/components/PreJoin/PreJoin";

/**
 * The pre-join route: `/prejoin/<meeting id>`.
 *
 * Addressed by the Meeting's internal id, the same as the room, because the two
 * are two moments of one act and the person arriving at this URL has already been
 * admitted by whatever brought them here — an Invite Link resolved on the join
 * screen, or the host's own New Meeting button.
 *
 * There is deliberately **no Invite Link that points here**. A link is a
 * `/join/<code>` path and always will be: this route takes a decision about
 * somebody's devices that a shared link must not carry, and a link that landed
 * here would either skip the Meeting's start-time gate or put a stranger's
 * browser into a room it never resolved.
 */
export default async function PreJoinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PreJoin meetingUuid={id} />;
}
