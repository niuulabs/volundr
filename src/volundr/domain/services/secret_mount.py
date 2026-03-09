"""Domain service for secret mount spec merging and Vault Agent config."""

from __future__ import annotations

import textwrap

from volundr.domain.models import MountType, SecretMountSpec


class SecretMountService:
    """Merges secret mount specs from tenant, user, and session layers."""

    def merge_mounts(
        self,
        tenant_mounts: list[SecretMountSpec],
        user_mounts: list[SecretMountSpec],
        session_mounts: list[SecretMountSpec],
    ) -> list[SecretMountSpec]:
        """Merge three layers. Session > User > Tenant precedence.

        Precedence is by destination path -- later layers override
        earlier ones when they target the same destination.
        """
        by_dest: dict[str, SecretMountSpec] = {}
        for mount in tenant_mounts:
            by_dest[mount.destination] = mount
        for mount in user_mounts:
            by_dest[mount.destination] = mount
        for mount in session_mounts:
            by_dest[mount.destination] = mount
        return list(by_dest.values())

    def generate_vault_agent_config(
        self,
        session_id: str,
        user_id: str,
        mounts: list[SecretMountSpec],
    ) -> str:
        """Generate Vault Agent config for the resolved mount specs.

        Returns a valid HCL string with auto_auth using the kubernetes
        method and template blocks for each mount spec.
        """
        if not mounts:
            return ""

        has_renewal = any(m.renewal for m in mounts)
        exit_after = "false" if has_renewal else "true"

        lines: list[str] = []
        lines.append(textwrap.dedent(f"""\
            exit_after_auth = {exit_after}

            auto_auth {{
              method "kubernetes" {{
                mount_path = "auth/kubernetes"
                config = {{
                  role = "volundr-session-{session_id}"
                  token_path  = "/var/run/secrets/kubernetes.io/serviceaccount/token"
                }}
              }}

              sink "file" {{
                config = {{
                  path = "/home/volundr/.vault-token"
                }}
              }}
            }}
        """))

        for mount in mounts:
            template_body = self._render_template_body(mount)
            lines.append(textwrap.dedent(f"""\
                template {{
                  destination = "{mount.destination}"
                  contents    = <<-EOT
                {template_body}
                  EOT
                }}
            """))

        return "\n".join(lines)

    def generate_pod_annotations(
        self,
        session_id: str,
        has_renewal: bool,
    ) -> dict[str, str]:
        """Generate pod annotations for Vault Agent injection."""
        annotations: dict[str, str] = {
            "vault.hashicorp.com/agent-inject": "true",
            "vault.hashicorp.com/role": (
                f"volundr-session-{session_id}"
            ),
            "vault.hashicorp.com/agent-pre-populate-only": (
                "false" if has_renewal else "true"
            ),
        }
        return annotations

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _render_template_body(
        self,
        mount: SecretMountSpec,
    ) -> str:
        """Render the Go-template body for a single mount spec."""
        if mount.template:
            return mount.template

        path = mount.secret_path

        if mount.mount_type == MountType.ENV_FILE:
            return (
                f'{{{{- with secret "{path}" -}}}}\n'
                f'{{{{- range $k, $v := .Data.data -}}}}\n'
                f"{{{{ $k }}}}={{{{ $v }}}}\n"
                f"{{{{- end -}}}}\n"
                f"{{{{- end -}}}}"
            )

        if mount.mount_type == MountType.FILE:
            return (
                f'{{{{- with secret "{path}" -}}}}\n'
                f"{{{{ .Data.data.value }}}}\n"
                f"{{{{- end -}}}}"
            )

        # MountType.TEMPLATE -- caller must have set mount.template;
        # fall back to raw secret dump.
        return (
            f'{{{{- with secret "{path}" -}}}}\n'
            f"{{{{ .Data.data | toJSON }}}}\n"
            f"{{{{- end -}}}}"
        )
