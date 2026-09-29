/**
 * The room's WebSocket: one connection per person, opened on arrival and held
 * until they leave.
 *
 * Everything about the *realtime* decision lives here rather than in the
 * component, for the same reason `media.ts` keeps `getUserMedia` out of a
 * component: one call site, and one place that knows the protocol. A component
 * that opened its own socket would have to re-derive the URL, the heartbeat and
 * the close codes a second time, and the second copy would be the one that
 * forgets to reconnect.
 *
 * **The heartbeat is not a nicety.** Render's free tier idles aggressively, and
 * an idled instance drops the WebSocket underneath a meeting that is still
 * happening (ADR-0002). A `ping` every ~25 seconds is what keeps the service
 * awake, and it doubles as the meeting-is-still-alive signal the server answers
 * with a `pong`. A client that stops sending it is not being polite; it is
 * allowing the room to be disconnected.
 *
 * **What is deliberately absent: a media transport.** No `RTCPeerConnection`, no
 * peer connections, no device negotiation. The socket carries *presence and
 * state* only, and remote participants are drawn as simulated tiles (ADR-0001).
 * Peer connections work on localhost and fail in the deployed demo without TURN,
 * so adding them here would be a feature that only ever demonstrates on the
 * developer's machine.
 *
 * **Reconnection is bounded and honest.** One retry, after a short delay, and
 * then the room says it has lost the connection. Silent infinite retrying is
 * what makes a realtime feature feel haunted: the list freezes, the user is told
 * nothing, and they reload. Saying "reconnecting" and then "connection lost" is
 * two sentences a person can act on.
 */

/**
 * How often to ping.
 *
 * About 25 seconds, because that is what the deployment target needs: Render's
 * free tier begins idling an idle service at around a minute, so a slower ping
 * would let it fall asleep mid-meeting. It is a deployment fact rather than a
 * protocol constant, exported so the browser test asserts the number the
 * application actually uses rather than a copy of it that can drift.
 */
export const HEARTBEAT_INTERVAL_MS = 25_000;

/** How long to wait before one reconnection attempt, after an unexpected close. */
const RECONNECT_DELAY_MS = 1_500;

/**
 * How long to wait for the socket to open before treating it as a failure.
 *
 * Without this, a connection that never opens leaves a person in a room that
 * will never populate and says nothing. A room that admits it has lost the
 * server is recoverable; a room that hangs is not.
 */
const OPEN_TIMEOUT_MS = 10_000;

/**
 * The one close code the client has to act on rather than merely report.
 *
 * The 4000-4999 range is reserved by the protocol for application codes, which
 * is why this is distinguishable from a normal closure at all.
 *
 * 4401 means the server had no cookie naming a User for the socket. It is
 * refused rather than given a fresh identity, because a WebSocket cannot set a
 * cookie before the handshake completes — so a User minted there would be one
 * the browser could never return as, and a guest would appear in the room under
 * an identity that evaporated on their next request. The client's answer is to
 * reload, which produces the cookie the socket was missing.
 *
 * The other application codes exist and carry a `refused` message with the
 * sentence the room renders, so this client does not need to word them itself.
 */
export const ROOM_CLOSE = {
  noIdentity: 4401,
} as const;

/** The room's own state, as the component needs to render it. */
export type ConnectionStatus =
  /** Not opened yet, or deliberately closed by the component. */
  | "idle"
  /** Opening, or open and receiving. */
  | "connecting"
  /** An unexpected close; one reconnect has been scheduled. */
  | "reconnecting"
  /** Refused by the server, with a reason a person can be shown. */
  | "refused"
  /** Dropped and not recovered. The room is no longer live. */
  | "lost";

/** One person in the room, as the server describes them. */
export type RoomParticipant = {
  user_id: string;
  display_name: string;
  /** Derived from `meetings.host_id`; there is no stored role (ADR-0004). */
  is_host: boolean;
  /** When they first arrived, which a reconnect does not reset. */
  joined_at: string;
  is_muted: boolean;
  is_video_on: boolean;
};

/** What the server sends. Tagged, because more types arrive with later tickets. */
export type RoomMessage =
  | { type: "participants"; participants: RoomParticipant[]; count: number }
  | { type: "pong"; at: string }
  /**
   * The Meeting cannot be entered, and this is why.
   *
   * Sent as a *message* rather than only as a close code, because a socket
   * refused before the handshake reaches the browser as an abnormal closure —
   * code 1006, no reason — and 1006 is also what a dropped network looks like.
   * Without this message a person whose meeting had simply not started yet was
   * told their connection was broken, which is the wrong sentence about a
   * situation they can do nothing about except wait.
   */
  | { type: "refused"; reason: string; code: number };

/** What the room is told as things happen. */
export type RoomHandlers = {
  /**
   * The whole room, after every change, with the count the server sent.
   *
   * The count is passed rather than recomputed from the array, because "how
   * many people are in this meeting" is a question the server has already
   * answered and a client that re-derives it has two sources of truth for one
   * number. They agree today only because the server builds the list and counts
   * it in one place; the day a client filters a row out for its own reasons,
   * the title bar and the panel disagree and only one of them is wrong in a way
   * a test would notice.
   */
  onParticipants: (participants: RoomParticipant[], count: number) => void;
  onStatus: (status: ConnectionStatus, detail?: string) => void;
};

/** A live connection, and the one way to end it. */
export type RoomConnection = {
  close: () => void;
};

/** Where the room's socket lives, derived from the API's own origin. */
function socketUrl(meetingUuid: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  // The API is an http(s) origin and the socket is ws(s) at the same host. The
  // scheme is rewritten rather than the host re-parsed, so a base URL with a
  // path or a trailing slash cannot produce a socket pointed at the wrong
  // place.
  const origin = new URL(base);
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  return `${origin.origin}/api/meetings/${encodeURIComponent(meetingUuid)}/ws`;
}

/** What this person chose about their devices, sent to the server on arrival. */
export type RoomDevices = {
  microphoneOn: boolean;
  cameraOn: boolean;
};

/**
 * Open the room's socket, and keep it open.
 *
 * Returns a handle immediately rather than a promise, because there is nothing
 * for a caller to do with a resolved value and a component should not have to
 * await its own first render. Everything is reported through the handlers.
 */
export function connectToRoom(
  meetingUuid: string,
  handlers: RoomHandlers,
  devices: RoomDevices,
): RoomConnection {
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let openTimer: ReturnType<typeof setTimeout> | null = null;

  // Set once on a deliberate close, so the teardown below does not read its own
  // cleanup as a dropped connection and reconnect on the way out. Without it,
  // navigating away from a meeting would leave a socket trying to come back for
  // a room the person has left.
  let closed = false;
  let hasConnected = false;

  // Set from a `refused` message, and read by the close handler below. Reset on
  // every `open()` so a stale refusal cannot be applied to a later connection.
  let refusal: number | null = null;
  let refusalReason: string | null = null;

  function stopTimers() {
    if (heartbeat !== null) clearInterval(heartbeat);
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (openTimer !== null) clearTimeout(openTimer);
    heartbeat = null;
    reconnectTimer = null;
    openTimer = null;
  }

  function open() {
    handlers.onStatus("connecting");
    refusal = null;
    refusalReason = null;
    socket = new WebSocket(socketUrl(meetingUuid));

    openTimer = setTimeout(() => {
      // A socket that has not opened in ten seconds is not coming, and leaving
      // it pending means the person watches an empty room with no explanation.
      socket?.close();
    }, OPEN_TIMEOUT_MS);

    socket.onopen = () => {
      if (openTimer !== null) clearTimeout(openTimer);
      openTimer = null;

      // Recorded here rather than at construction, because "have we ever been
      // connected" is the question the close handler asks, and the answer is
      // only yes once the handshake has actually completed. Leaving this
      // permanently false is not a subtle bug: it routes *every* unexpected
      // close to "lost" and makes the retry below unreachable.
      hasConnected = true;

      // The device state pre-join decided, sent to the server so the record of
      // this participant agrees with what the room displays. Without it the
      // database would record everybody as unmuted with their camera on, while
      // the room showed the person their own opposite choice — two truths about
      // one person, and the mute badge is the one that gets believed.
      send({
        type: "state",
        microphone_on: devices.microphoneOn,
        camera_on: devices.cameraOn,
      });

      // One ping immediately, so the round trip is proven while somebody is
      // still watching, and the interval then carries the keep-alive. Waiting
      // 25 seconds for the first one would make a broken connection look fine
      // for the first half-minute of a meeting.
      send({ type: "ping" });
      heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      const message = parse(event.data);
      if (!message) return;
      if (message.type === "participants") {
        handlers.onParticipants(message.participants, message.count);
        return;
      }
      if (message.type === "refused") {
        // Recorded before the close arrives, because the close for a refused
        // socket is an ordinary 1006-or-1000 with no information in it, and
        // handling only the close would overwrite this sentence with "we lost
        // the connection". The refusal is the more specific fact, so it wins.
        refusal = message.code;
        refusalReason = message.reason;
        return;
      }
      // A `pong` needs no handler of its own. Its value is that it arrived: the
      // socket is open and the server is answering, and nothing needs to be
      // rendered for that. The one thing that must not happen is treating it as
      // unknown — the room would log a protocol error every 25 seconds forever.
    };

    socket.onclose = (event) => {
      stopTimers();

      if (closed) return;

      // A `refused` message is the specific fact; the close code is the
      // fallback for a client that only saw the close. Either way the room is
      // told what actually happened rather than being handed a generic failure.
      const reason = refusalFor(refusal ?? event.code, refusalReason);
      if (reason !== null) {
        handlers.onStatus("refused", reason);
        return;
      }

      if (hasConnected) {
        // One retry, then an honest "lost". Infinite silent retrying is what
        // makes a realtime feature feel haunted: the list freezes, the person is
        // told nothing, and they reload.
        handlers.onStatus("reconnecting");
        reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS);
        return;
      }

      handlers.onStatus(
        "lost",
        "We could not reach the meeting. Check your connection and reload.",
      );
    };

    socket.onerror = () => {
      // Nothing useful to say here. `onerror` is always followed by `onclose`,
      // which is where the code is and therefore where the decision belongs.
      // Reporting from both would show the same failure twice.
    };
  }

  function send(message: unknown) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  /**
   * The sentence for a refusal, or `null` if this close was not one.
   *
   * There is no wording of our own for any of them, and that is deliberate.
   * The server accepts the handshake before refusing precisely so it can *send*
   * a sentence — a close before the handshake reaches the browser as a bare
   * 1006, indistinguishable from a dropped network. So the reason is always
   * delivered as a message, and the only code handled here is 4401, which needs
   * an action rather than a sentence.
   */
  function refusalFor(code: number, reason: string | null): string | null {
    if (code === ROOM_CLOSE.noIdentity) {
      // The server had no cookie for the socket, and a cookie is set on the
      // *response* to an HTTP request — so a `fetch` from this page will not
      // produce one, and a full load will. That is the difference between a
      // person arriving at a broken room and one arriving a moment later in a
      // working one.
      window.location.reload();
      return "Reconnecting…";
    }
    return reason;
  }

  open();

  return {
    close() {
      closed = true;
      stopTimers();
      socket?.close();
      socket = null;
    },
  };
}

/**
 * Read one message, or nothing.
 *
 * Returns `null` for anything that is not a message this client understands,
 * rather than throwing. A socket that delivers one unexpected frame must not
 * take the room down with it — the next valid frame is seconds away, and a room
 * that renders a frozen list because of one bad message is worse than a room
 * that waits.
 */
function parse(raw: unknown): RoomMessage | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { type } = value as { type?: unknown };
  if (type === "participants") {
    const { participants, count } = value as {
      participants?: unknown;
      count?: unknown;
    };
    if (!Array.isArray(participants)) return null;
    return {
      type: "participants",
      participants: participants as RoomParticipant[],
      // The server's own number, kept as sent. Falling back to the array's
      // length is a last resort for a server that somehow omitted it, not a
      // normal path — and it is not the same thing as recomputing it.
      count: typeof count === "number" ? count : participants.length,
    };
  }
  if (type === "pong") {
    const { at } = value as { at?: unknown };
    return { type: "pong", at: typeof at === "string" ? at : "" };
  }
  if (type === "refused") {
    const { reason, code } = value as { reason?: unknown; code?: unknown };
    return {
      type: "refused",
      reason: typeof reason === "string" ? reason : "",
      code: typeof code === "number" ? code : 0,
    };
  }
  return null;
}
