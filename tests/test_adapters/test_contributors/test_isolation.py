"""Tests for IsolationContributor."""

import pytest

from volundr.adapters.outbound.contributors.isolation import IsolationContributor
from volundr.domain.models import LABEL_OWNER, LABEL_SESSION_ID, Session
from volundr.domain.ports import SessionContext


@pytest.fixture
def session():
    return Session(
        name="test",
        model="claude",
        repo="",
        branch="main",
        owner_id="user-1",
    )


class TestIsolationContributor:
    async def test_name(self):
        c = IsolationContributor()
        assert c.name == "isolation"

    async def test_labels_with_owner(self, session):
        c = IsolationContributor()
        result = await c.contribute(session, SessionContext())
        labels = result.values["podLabels"]
        assert labels[LABEL_SESSION_ID] == str(session.id)
        assert labels[LABEL_OWNER] == "user-1"

    async def test_labels_without_owner(self):
        session = Session(name="test", model="claude", repo="", branch="main")
        c = IsolationContributor()
        result = await c.contribute(session, SessionContext())
        labels = result.values["podLabels"]
        assert labels[LABEL_SESSION_ID] == str(session.id)
        assert LABEL_OWNER not in labels
