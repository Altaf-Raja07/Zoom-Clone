"""The two configuration rules that are cheap to state and easy to break.

- Cookie attributes are configured in exactly one place.
- CORS origins are configured in exactly one place.

There is no behavioural test for either — the behaviour is already covered in
`test_guest_identity.py` and `test_cors.py`. What is untested is the *absence*
of a second definition, which is exactly what a reviewer reading the code would
look for and what duplicated configuration looks like in production: a cookie
attribute set in one handler and overridden in another.
"""

import re
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"

_SET_COOKIE_CALL = re.compile(r"set_cookie\(")

# A cookie attribute given a *literal* value, e.g. `samesite="none"`. Passing a
# value through (`secure=settings.cookies_are_secure`) is how a second module
# correctly delegates to the one place; inventing a value is the duplication
# this test exists to catch.
_COOKIE_ATTRIBUTE_LITERAL = re.compile(
    r"""\b(samesite|httponly|secure|max_age|domain)\s*[=:]\s*["']""",
    re.IGNORECASE,
)


def python_sources() -> list[Path]:
    return sorted(APP_DIR.rglob("*.py"))


def test_cookie_attributes_are_configured_in_exactly_one_place():
    setters = [
        path for path in python_sources() if _SET_COOKIE_CALL.search(path.read_text())
    ]
    assert [path.name for path in setters] == ["identity.py"]


def test_no_module_outside_identity_declares_a_cookie_attribute():
    offenders = [
        path.name
        for path in python_sources()
        if path.name != "identity.py"
        and _COOKIE_ATTRIBUTE_LITERAL.search(path.read_text())
    ]
    assert offenders == []


def test_cors_origins_are_configured_in_exactly_one_place():
    reading_origins = [
        path.name
        for path in python_sources()
        if "MEETLY_CORS_ORIGINS" in path.read_text()
    ]
    assert reading_origins == ["config.py"]


def test_only_one_module_installs_the_cors_middleware():
    installers = [
        path.name
        for path in python_sources()
        if "CORSMiddleware" in path.read_text()
    ]
    assert installers == ["main.py"]
