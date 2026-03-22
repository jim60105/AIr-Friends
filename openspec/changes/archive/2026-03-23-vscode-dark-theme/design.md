## Context

The AIr-Friends dashboard (`src/dashboard/public/`) is a single-page web app using Tailwind CSS (CDN) with a custom dark purple-tinted theme. The current palette uses deep purples (`#0f0d1a`, `#1a1726`, `#1e1b2e`, `#252236`) with indigo accents (`indigo-300` through `indigo-900`, plus hardcoded `#4338ca`, `#6366f1`, `#818cf8`). Colors are defined in two places:

1. **`index.html`** — Tailwind `config.theme.extend.colors.surface` object (4 surface shades) + Tailwind utility classes (`indigo-*`, `gray-*`)
2. **`style.css`** — Hardcoded hex values for scrollbar, markdown rendering, blockquote, links, typing indicator

The target is VSCode's default "Dark+" theme, whose canonical colors are:

| Role | Current | VSCode Dark+ |
|------|---------|-------------|
| Base background | `#0f0d1a` | `#1e1e1e` |
| Panel/sidebar | `#1a1726` | `#252526` |
| Card/elevated | `#1e1b2e` | `#2d2d30` |
| Input/inline code | `#252236` | `#3c3c3c` |
| Accent primary | `#4338ca` (indigo) | `#007acc` (blue) |
| Accent hover | `#6366f1` | `#1a8ad4` |
| Button bg | `indigo-600` | `#0e639c` |
| Text primary | `gray-200` | `#cccccc` / `#d4d4d4` |
| Link color | `#818cf8` | `#3794ff` |
| Link hover | `#a5b4fc` | `#4dabf5` |

## Goals / Non-Goals

**Goals:**
- Replace all surface/background colors with VSCode Dark+ equivalents
- Replace all indigo accent colors with VSCode blue accent (`#007acc`)
- Update all hardcoded CSS hex values in `style.css`
- Maintain the same visual hierarchy and layout structure
- Keep the Tailwind CSS CDN approach (no build tooling changes)

**Non-Goals:**
- Changing layout, spacing, typography, or component structure
- Adding CSS custom properties or a theme switcher
- Modifying backend code, auth flow, or API endpoints
- Changing the Tailwind CDN version or adding new dependencies
- Matching VSCode's syntax highlighting colors (not applicable)

## Decisions

### 1. Surface color mapping strategy
**Decision**: Direct 1:1 mapping of the 4 surface shades to VSCode equivalents.

| Tailwind token | Old | New |
|---|---|---|
| `surface.DEFAULT` | `#0f0d1a` | `#1e1e1e` |
| `surface.50` | `#1a1726` | `#252526` |
| `surface.100` | `#1e1b2e` | `#2d2d30` |
| `surface.200` | `#252236` | `#3c3c3c` |

**Rationale**: Keeps the existing Tailwind class structure (`bg-surface`, `bg-surface-50`, etc.) so HTML changes are minimal — only the config values change.

### 2. Accent color approach
**Decision**: Add a custom `accent` color in Tailwind config mapped to VSCode blue shades, and replace all `indigo-*` class references.

New Tailwind accent palette:
- `accent.DEFAULT`: `#007acc`
- `accent.light`: `#3794ff`
- `accent.dark`: `#0e639c`
- `accent.muted`: `rgba(0, 122, 204, 0.15)` (for borders/subtle backgrounds)

**Rationale**: Using a custom `accent` palette (rather than Tailwind's built-in `blue-*`) provides exact control over VSCode's specific blue shades and makes future theme changes easier.

**Alternative considered**: Using Tailwind's `blue-*` palette directly — rejected because VSCode's `#007acc` doesn't map cleanly to any standard Tailwind blue shade.

### 3. CSS hardcoded values
**Decision**: Update every hardcoded hex in `style.css` to the corresponding VSCode color. No CSS variables introduced — keep the direct hex approach matching current architecture.

**Rationale**: Introducing CSS variables would be a structural change beyond scope. The number of hardcoded values (~15) is manageable for direct replacement.

## Risks / Trade-offs

- **[Visual consistency]** Some Tailwind `gray-*` utility classes used for text may not perfectly match VSCode's `#cccccc` text color → Mitigation: Replace `gray-200`/`gray-300`/`gray-400` with custom text colors where visible differences exist.
- **[Subjective preference]** VSCode Dark+ is more neutral/gray compared to the current purple-tinted theme, which some users may prefer → Mitigation: This is a deliberate design choice; the purple theme can be restored by reverting the color values.
- **[Indigo class sweep]** Missing an `indigo-*` reference could leave an inconsistent color → Mitigation: Grep for all `indigo` references in both files before marking complete.
