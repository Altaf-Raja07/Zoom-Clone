"""The health of the app, as a reviewer or a monitor sees it.

Reached over HTTP, like every other test: a 404 from a wrong path is the
behaviour, and asserting it here keeps the API surface honest.
"""


def test_the_application_reports_itself_healthy(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_an_unknown_api_path_is_a_404(client):
    assert client.get("/api/nope").status_code == 404
