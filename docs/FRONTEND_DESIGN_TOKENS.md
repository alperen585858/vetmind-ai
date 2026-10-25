# Frontend design tokens (ISS-FE-UX / issue #6)

Semantic CSS variables live in [`src/index.css`](../src/index.css) (`:root`) and are mirrored in Tailwind via [`tailwind.config.js`](../tailwind.config.js).

| Token | CSS var | Tailwind | Use |
|-------|---------|----------|-----|
| Surface | `--vm-surface` | `bg-surface` | Page atmosphere |
| Elevated | `--vm-surface-elevated` | `bg-surface-elevated` | Cards / topbar |
| Accent | `--vm-accent` | `bg-accent` / `text-accent` | Primary actions |
| Danger / Success / Warning / Info | `--vm-*` | `bg-danger` etc. | Semantic states |
| Radius | `--vm-radius` | `rounded-vm` | Cards & buttons |
| Shadow | `--vm-shadow` | `shadow-soft` | Elevation |

Typography utilities: `.text-display`, `.text-title`, `.text-body`, `.text-caption`.

Primitives: `Button` (44px+ md/lg), `Card`, `Skeleton`, `EmptyState`, `PageHeader`.
