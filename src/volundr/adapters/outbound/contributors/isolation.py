"""Isolation contributor — sets pod labels for Kyverno PVC enforcement."""

from volundr.domain.models import LABEL_OWNER, LABEL_SESSION_ID, Session
from volundr.domain.ports import SessionContext, SessionContribution, SessionContributor


class IsolationContributor(SessionContributor):
    """Sets isolation labels on session pods for Kyverno PVC enforcement."""

    def __init__(self, **_extra: object):
        pass

    @property
    def name(self) -> str:
        return "isolation"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        pod_labels: dict[str, str] = {
            LABEL_SESSION_ID: str(session.id),
        }
        if session.owner_id:
            pod_labels[LABEL_OWNER] = session.owner_id

        return SessionContribution(values={"podLabels": pod_labels})
