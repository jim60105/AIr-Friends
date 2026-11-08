# Design

## Context

See `proposal.md`. Observed facts:

- `deno.json` `fmt`: `lineWidth` 100, `indentWidth` 2, `useTabs` false, `singleQuote` false, `proseWrap` "preserve"; task scope `src/ tests/`.
- `deno.json` `lint`: `tags: ["recommended"]`, excludes `src/dashboard/public/`; task scope `src/ tests/`.
- `deno fmt` is built on dprint plugins. `dprint-plugin-typescript`, `dprint-plugin-json` and `dprint-plugin-markdown` each accept `"deno": true`, which applies Deno's formatting defaults.
- Lint suppressions in `src/` and `tests/`: 190 `// deno-lint-ignore no-explicit-any`, 2 `// deno-lint-ignore-file no-explicit-any`, 1 `// deno-lint-ignore no-control-regex`, 1 `// deno-lint-ignore ban-types`. TypeScript directives: 3 `@ts-expect-error`, 1 `@ts-ignore`.
- oxlint honors `// oxlint-disable-next-line <rule>` and `/* oxlint-disable <rule> */` comments.

## Goals / Non-Goals

**Goals:** working `fmt`, `fmt:check`, `lint` and `check` scripts; formatting settled before step 4.

**Non-Goals:**

- No code changes beyond formatting output and lint-directive comments. Do not fix lint findings by changing logic; a new finding that `deno lint` did not report is suppressed with a directive and listed in the task report.
- No requirement that `bun run check` passes now. The tree uses Deno globals until step 6.
- No CI change (`migrate-ci-and-docs-to-bun`).

## Decisions

### D1. `dprint.json`

```json
{
  "lineWidth": 100,
  "indentWidth": 2,
  "useTabs": false,
  "typescript": {
    "deno": true,
    "quoteStyle": "preferDouble",
    "lineWidth": 100,
    "indentWidth": 2,
    "useTabs": false
  },
  "json": { "deno": true, "lineWidth": 100, "indentWidth": 2, "useTabs": false },
  "markdown": { "deno": true, "textWrap": "maintain", "lineWidth": 100 },
  "includes": ["src/**/*.{ts,js,json,md}", "tests/**/*.{ts,js,json,md}"],
  "excludes": ["src/dashboard/public/**"],
  "plugins": [
    "https://plugins.dprint.dev/typescript-0.96.1.wasm",
    "https://plugins.dprint.dev/json-0.21.3.wasm",
    "https://plugins.dprint.dev/markdown-0.20.0.wasm"
  ]
}
```

Options changed from the first draft while matching `deno fmt`: with `"deno": true` the plugin ignores global
`lineWidth`/`indentWidth`/`useTabs`, so they are repeated inside each plugin block; `quoteStyle` is `preferDouble`
(Deno's `singleQuote: false`), not `alwaysDouble`, which escaped embedded quotes. The three plugin URLs are pinned to
the exact versions Deno 2.9.0 bundles (`dprint-plugin-typescript` 0.96.1, `-json` 0.21.3, `-markdown` 0.20.0, from
`denoland/deno` v2.9.0 `Cargo.toml`); newer plugins changed layout decisions and drifted from `deno fmt`.
`dprint` itself is a `devDependency` at an exact version. Scripts: `fmt` = `dprint fmt`, `fmt:check` = `dprint check`.

If `dprint check` reports differences on the unchanged tree, run `dprint fmt` once and commit the result as this change's formatting commit. Before committing, confirm `deno fmt --check src/ tests/` still exits 0 on the reformatted tree; if it does not, the two formatters disagree, so adjust the dprint options (never the code by hand) until both pass, and record the options changed.

`src/dashboard/public/**` is excluded because formatting browser assets is not part of this migration. This narrows
coverage: `deno fmt --check src/ tests/` also formatted YAML fixtures and the HTML/CSS assets under
`src/dashboard/public/`, while dprint here covers only TypeScript, JavaScript, JSON and Markdown. Those files are clean
today; `migrate-ci-and-docs-to-bun` must add YAML/HTML/CSS coverage or record its absence. CI still runs
`deno fmt --check src/ tests/` against a floating `deno-version: v2.x`, so until that change lands a newer Deno could
format differently from the pinned plugins.

### D2. `.oxlintrc.json`

```json
{
  "categories": { "correctness": "error" },
  "rules": {
    "typescript/no-explicit-any": "error",
    "no-unused-vars": "error",
    "prefer-const": "error",
    "require-await": "error",
    "no-empty": "error",
    "no-control-regex": "error",
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
    "typescript/ban-types": "error",
    "no-var": "error",
    "no-debugger": "error"
  },
  "ignorePatterns": ["src/dashboard/public/**"]
}
```

`typescript/ban-types` is enabled in addition to the nine rules above because the rewrite table's `ban-types` row needs
the rule that actually reports that line; `typescript/no-empty-object-type` does not report `(string & {})`. It flags
only the suppressed `src/types/config.ts` line.

`lint` = `oxlint src tests`. Each listed rule matches a `deno lint` recommended rule of the same intent. If oxlint rejects a rule name, drop it and list it in the task report; do not substitute a stricter rule.

Directive rewrite, applied with one scripted pass over `src/` and `tests/`:

| From | To |
| --- | --- |
| `// deno-lint-ignore no-explicit-any` | `// oxlint-disable-next-line typescript/no-explicit-any` |
| `// deno-lint-ignore-file no-explicit-any` | `/* oxlint-disable typescript/no-explicit-any */` |
| `// deno-lint-ignore no-control-regex` | `// oxlint-disable-next-line no-control-regex` |
| `// deno-lint-ignore ban-types` | `// oxlint-disable-next-line` followed by the oxlint rule that reports that line |

### D3. Type check

`typescript` is a `devDependency` at an exact 5.x or newer version. `check` = `tsc --noEmit -p tsconfig.json`. The `@ts-ignore` and `@ts-expect-error` directives stay as they are.

## Risks / Trade-offs

- [dprint's Deno profile drifts from `deno fmt` 2.9 output] → D1's dual check. The goal is that step 4 diffs carry no formatting noise, so equality with `deno fmt` today is the acceptance, not dprint's defaults.
- [oxlint finds issues `deno lint` did not] → Suppress with a directive and list them; behavior fixes are out of scope.
