import { Room } from "@/components/Room/Room";

/**
 * The room route: `/room/<meeting id>`.
 *
 * A dynamic segment rather than a query parameter, because the room is a place
 * you can be sent to, be linked to, and come back to after a reload — and
 * because the pre-join screen that follows will want the same address.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Room meetingId={id} />;
}
