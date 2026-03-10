# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email security@niuu.dev with details
3. Include steps to reproduce if possible

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Measures

- All container images are scanned with [Trivy](https://trivy.dev/) on every release
- Dependencies are monitored with [Dependabot](https://github.com/dependabot)
- Secrets are scanned with [TruffleHog](https://trufflesecurity.com/trufflehog)
- CLI binaries include [build provenance attestations](https://github.com/actions/attest-build-provenance)
- Container images are signed with [Sigstore cosign](https://www.sigstore.dev/)
