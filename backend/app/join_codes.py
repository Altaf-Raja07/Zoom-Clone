"""The Meeting's public identity: an eleven-digit code, grouped 3-4-4.

Zoom's own convention, for one reason: this is the thing a host reads aloud
over a phone call. `123 456 789` chunks into three spoken groups; a UUID does
not chunk at all, which is why the Meeting has a second identifier rather than
using its primary key for this (ADR-0004).

The code is stored as eleven bare digits and grouped only for display. Storing
the spaces would mean every lookup has to remember the format, and every future
format change becomes a migration — the exact cost ADR-0004 says the separate
column exists to avoid.
"""

import secrets

JOIN_CODE_DIGITS = 11

# How the digits are grouped for a human, in the order Zoom groups them. Stored
# as a list rather than a format string so the storage/display split is
# arithmetic rather than string surgery that could drop a leading zero.
_GROUPS = (3, 4, 4)


def generate_join_code() -> str:
    """A fresh eleven-digit code.

    `secrets` rather than `random`: the code is the only thing standing between
    "I know a meeting's ID" and "I am in that meeting", so the digits should not
    be guessable from observed codes. Uniform over the whole eleven-digit space,
    which means a leading zero is possible and perfectly fine — the length is
    what is displayed, never the value.
    """
    return "".join(str(secrets.randbelow(10)) for _ in range(JOIN_CODE_DIGITS))


def format_join_code(join_code: str) -> str:
    """`12345678901` as `123 456 789 01` — how a host reads it out.

    A code of the wrong length is passed through rather than padded or
    truncated: a formatter that quietly repairs malformed input hides the bug
    rather than showing it.
    """
    if len(join_code) != JOIN_CODE_DIGITS:
        return join_code

    groups = []
    start = 0
    for size in _GROUPS:
        groups.append(join_code[start : start + size])
        start += size
    return " ".join(groups)
