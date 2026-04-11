"""Mímir — standalone knowledge service.

Exposes the Mímir wiki over HTTP so that Ravens, Valkyries, Pi room nodes,
and Hliðskjálf can read and write the knowledge base without filesystem access.

Usage
-----
Standalone (development)::

    python -m mimir serve --path ~/.ravn/mimir --port 7477

Co-located on the Ravn gateway::

    # In ravn CLI: listen-mimir mounts the MimirRouter on the existing server
    ravn listen-mimir

Discovery
---------
On startup the service announces itself on Sleipnir::

    {"type": "odin.mimir.announce", "name": "shared", "url": "...", "role": "shared"}
"""
