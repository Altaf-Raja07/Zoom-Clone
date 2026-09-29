# Schema: separate join code from storage identity, keep participation history

Four related decisions about the data model, recorded together because they
are one design rather than four.

**A Meeting has two identifiers.** `meetings.id` is a UUID surrogate key;
`meetings.join_code` is a separate unique 11-digit code grouped 3-4-4
(`123 456 789`), which is what users read aloud and what the invite link
carries. The assignment requires both a typed Meeting ID and a shareable link,
and a UUID is unusable for either. Keeping the public code off the primary key
means the code format can change without a migration touching every table that
references a meeting.

**Participation is soft-deleted.** Leaving a meeting stamps `participants.left_at`
rather than deleting the row, so attendance history survives. The cost is that
"who is in this room" becomes a *query* rather than a table, and the filter
`left_at IS NULL` must live in exactly one repository function — a bare
`SELECT * FROM participants WHERE meeting_id = ?` is a bug that returns past
attendees.

**Authority is derived, not denormalised.** There is no `role` column on
`participants`. "Is this user the host?" is `meetings.host_id`, one source of
truth. The alternative invites silent corruption the moment host controls
(mute-all, remove participant) are implemented, because a stale role column
would let a non-host act as host.

**Instant and Scheduled Meetings are one table.** A nullable
`scheduled_start_at` distinguishes them; there is deliberately no `kind`
discriminator, because a discriminator duplicating a fact already implied by a
null is the same class of bug as the role column.

**Why:** "Database Design: Design your own schema. This will be evaluated." The
common thread is refusing to store a fact twice.

**Consequences:** Recent Meetings lists only meetings the current user **hosted**
— `WHERE host_id = :me`, indexed, no union and therefore no deduplication step
(the hosted-or-attended union was considered and rejected in favour of a simple
query, with participation-based history left as a later addition). An empty
Recent Meetings list is a valid, honest state for a guest who has not hosted
anything — it must not be backfilled with fabricated history.

Ordering is by a meeting's recency timestamp, defined as the later of
`created_at` and `started_at`, falling back to `created_at` when `started_at` is
null, then descending, with `id` as a deterministic tie-break. It deliberately
does **not** order by `scheduled_start_at`, which is null for Instant Meetings
and represents a planned time rather than when a meeting was created or started.

**Schema addition:** `meetings.started_at` is nullable, set when the first
participant joins. It orders in-progress meetings to the top, and doubles as
the honest test for "has this meeting actually begun" — better than inferring
it from participant rows.

**Watch out for:** a scheduled meeting whose start time has passed but which
nobody has joined. It has a null `started_at`, so it sorts by `created_at` and
can drop below a freshly-created Instant Meeting. That is correct — nobody
started it — but it is a behaviour change and needs a test, not a surprise.
Test scheduled meetings, instant meetings, and the null-`started_at` fallback.

**Scope boundary:** attendance records exist to drive meeting participation and
live participant state. They are deliberately not a history feature.
