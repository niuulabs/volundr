from __future__ import annotations

from volundr.config import SessionContributorConfig, Settings
from volundr.main import _create_contributors


def test_create_contributors_does_not_duplicate_ravn_flock() -> None:
    settings = Settings(
        session_contributors=[
            SessionContributorConfig(
                adapter="volundr.adapters.outbound.contributors.ravn_flock.RavnFlockContributor"
            )
        ]
    )

    contributors = _create_contributors(settings)
    ravn_flock_contributors = [contributor for contributor in contributors if contributor.name == "ravn_flock"]

    assert len(ravn_flock_contributors) == 1
