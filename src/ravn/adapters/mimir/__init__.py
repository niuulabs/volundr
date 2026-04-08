"""Mímir knowledge base adapters for Ravn.

Adapters:
- ``mimir.adapters.markdown.MarkdownMimirAdapter`` — filesystem-backed (standalone Mímir service)
- ``ravn.adapters.mimir.http.HttpMimirAdapter`` — calls a remote Mímir service over HTTP
- ``ravn.adapters.mimir.composite.CompositeMimirAdapter`` — fans out across multiple instances
"""
