"""Mesh transport adapters (NIU-517).

- ``NngMeshAdapter``       — Pi mode, nng PUB/SUB + REQ/REP, no broker required
- ``SleipnirMeshAdapter``  — infra mode, RabbitMQ topic exchange + RPC
- ``CompositeMeshAdapter`` — tries infra first, falls back to nng
"""
