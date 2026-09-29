# Simulated remote media tiles instead of real peer-to-peer video

The assignment asks for a Zoom clone but its Must Have list stops at meeting
management (create / join / schedule) — WebRTC appears nowhere in the
requirements, and the deadline is one day. So we ship a fully real-time meeting
room (participant list, mute/video/hand state, chat, screen-share affordances)
over WebSockets, plus a real `getUserMedia` camera preview in the local tile,
and simulated tiles for every other participant.

**Why:** the grading criterion is "UI/UX — visual similarity to Zoom's design and
UX patterns", which a real local preview does a lot for at almost no cost. Real
`RTCPeerConnection` mesh would need a TURN server to work behind the restrictive
NATs most evaluation machines sit behind, and would have consumed the entire
time budget. Because the signalling channel is real, adding real peer
connections later is additive rather than a rewrite.

**Consequences:** the client must not present simulated tiles as real video —
they are visually distinct (initial avatar, muted indicator) on purpose, so the
distinction is a design constraint, not an oversight. Do not "fix" this by
wiring up `RTCPeerConnection` without TURN; it will work on localhost and fail
in the deployed demo.
