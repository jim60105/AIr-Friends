## Why

The dashboard currently uses a custom dark purple-tinted theme (`#0f0d1a` base with indigo accents). Switching to the widely-recognized VSCode Dark+ theme colors will provide a more familiar, professional developer-tool aesthetic and improve visual consistency with the tooling ecosystem that AIr-Friends integrates with.

## What Changes

- Replace the custom purple-tinted surface color palette (`#0f0d1a`, `#1a1726`, `#1e1b2e`, `#252236`) with VSCode Dark+ equivalents (`#1e1e1e`, `#252526`, `#2d2d30`, `#3c3c3c`)
- Replace indigo accent colors (`indigo-*` / `#4338ca` / `#6366f1` / `#818cf8`) with VSCode's accent blue (`#007acc`, `#0e639c`) and appropriate text colors (`#cccccc`, `#d4d4d4`)
- Update `style.css` hardcoded colors (scrollbar, markdown rendering, blockquote borders, links, typing indicator) to match the VSCode Dark+ palette
- Update all Tailwind color class references in `index.html` from `indigo-*` to a new `accent` color mapped to VSCode blue

## Capabilities

### New Capabilities

- `vscode-dark-theme`: Dashboard theme color mapping from custom purple/indigo palette to VSCode Dark+ color scheme, covering Tailwind config, CSS custom properties, and all hardcoded color references.

### Modified Capabilities

_(none — this is a purely visual change with no spec-level behavior modifications)_

## Impact

- **Files affected**: `src/dashboard/public/index.html` (Tailwind config + all color classes), `src/dashboard/public/style.css` (all hardcoded hex colors)
- **No API changes**: Backend logic, auth, and endpoints are unaffected
- **No dependency changes**: Still uses Tailwind CSS CDN
- **No test impact**: No functional behavior changes; existing tests remain valid
