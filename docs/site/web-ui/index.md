# Web UI

The web UI is a React single-page application built with Vite.

## Session views

The main workspace provides tabs for chat, terminal, code, diffs, chronicles, and logs.

<div class="screenshot-gallery" markdown>

<figure markdown>
![Session chat](../images/dashboard.png)
<figcaption>Chat — talk to the AI coding agent</figcaption>
</figure>

<figure markdown>
![Session diffs](../images/session-diffs.png)
<figcaption>Diffs — review code changes</figcaption>
</figure>

</div>

<div class="screenshot-full" markdown>

![Chronicle timeline](../images/chronicle-timeline.png)

</div>

<div class="screenshot-full" markdown>

![Session workspace](../images/session-workspace.png)

</div>

## Launch wizard

Sessions are created through a guided wizard: pick a template, configure resources and credentials, then launch.

<div class="screenshot-gallery" markdown>

<figure markdown>
![Template selection](../images/launch-wizard.png)
<figcaption>Step 1 — choose a template</figcaption>
</figure>

<figure markdown>
![Session configuration](../images/launch-wizard-config.png)
<figcaption>Step 2 — configure the session</figcaption>
</figure>

</div>

## Settings

<div class="screenshot-full" markdown>

![Credentials management](../images/settings-credentials.png)

</div>

<div class="screenshot-gallery" markdown>

<figure markdown>
![Workspace storage](../images/settings-workspaces.png)
<figcaption>Workspace PVC management</figcaption>
</figure>

<figure markdown>
![Integrations](../images/settings-integrations.png)
<figcaption>External service integrations</figcaption>
</figure>

</div>

## Admin

<div class="screenshot-full" markdown>

![User management](../images/admin-users.png)

</div>

## Development

```bash
cd web
npm install
npm run dev        # Dev server at http://localhost:5173
npm run build      # Production build
npm run lint       # ESLint
npm run format:check  # Prettier check
npm run typecheck  # TypeScript check
npm run test:coverage # Tests with 85% coverage threshold
```

## Architecture

The UI follows the same hexagonal pattern as the backend:

```
web/src/
├── ports/           # Interfaces for API communication
├── adapters/        # HTTP/WebSocket implementations
├── models/          # TypeScript domain models
├── store/           # State management
├── pages/           # Route-level components
├── components/      # Reusable UI components
├── hooks/           # Custom React hooks
├── contexts/        # React contexts
├── styles/          # Design tokens and global styles
├── auth/            # Authentication
└── utils/           # Utilities
```

## Styling

All styles use CSS Modules with design tokens. Inline styles, Tailwind classes, and CSS-in-JS are not used.

```tsx
import styles from './StatusBadge.module.css';

export function StatusBadge({ status }: Props) {
  return <span className={styles.badge} data-status={status}>{status}</span>;
}
```

```css
/* StatusBadge.module.css */
.badge {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
}

.badge[data-status="healthy"] {
  background-color: color-mix(in srgb, var(--color-accent-emerald) 20%, transparent);
  color: var(--color-accent-emerald);
}
```

Design tokens are defined in `src/styles/tokens.css` and cover colors, spacing, typography, and border radius.

## Key components

| Component | Description |
|-----------|-------------|
| `LaunchWizard` | Guided session creation flow |
| `SessionChat` | WebSocket chat connected to Skuld |
| `SessionChronicles` | Chronicle timeline and history |
| `SessionDiffs` | Git diff viewer |
| `SessionTerminal` | ttyd terminal integration |
| `TemplateBrowser` | Workspace template selection |
| `CredentialForm` | Credential management |
| `IntegrationCard` | Integration setup |
| `AdminGuard` | Admin-only route protection |

## Testing

Tests use vitest with @testing-library/react. Test files are co-located with source:

```
components/
  StatusBadge/
    StatusBadge.tsx
    StatusBadge.module.css
    StatusBadge.test.tsx
    index.ts
```

Coverage thresholds: 85% on statements, branches, functions, and lines.
