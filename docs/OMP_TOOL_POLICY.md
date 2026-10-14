# OMP Restricted Tool Policy (capability admission)

The restricted OMP integration owns exactly **one** tool decision: capability
admission by native tool name. The restricted launch attaches a small capability
callback to the official pre-dispatch native `tool_call` API; a native call whose
name is in the frozen capability map continues to native dispatch, and **every
other name is blocked before execution** with the bounded reason
`rejected_unknown_tool`. Native and ACP authorization are **not** repeated for
mapped names — a mapped ability keeps its native approval policy and the shared
ACP path described below.

Pinned to official OMP **v18.6.1** / commit
`2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`. Carried by the OpenSpec change
`cutover-omp-native-runtime`.

> **Evidence boundary.** Everything here is a source/configuration observation
> of the shipped decisions. It does not claim the official native binary was
> run, and it does not certify that the binary invokes the registered handler.
> Live observation of the confined native runtime is owned by the separate
> `verify-omp-confined-native-runtime` change and is **not** claimed here.

## Live modules

| Module                          | Role                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/acp/omp/tool-inventory.ts` | The frozen capability map `OMP_TOOL_CAPABILITY_MAP` and `decideOmpToolCapability(toolName)` — the whole admission decision                                        |
| `src/acp/omp/destructive-ingress.ts` | ACP **client** ingress normalizer: canonicalizes a configured-OMP native single `Delete`/`Move` permission request into the shared destructive vocabulary before the shared policy (separate from the extension callback) |

The callback that consumes the capability decision lives in
`src/acp/omp/extension/native-registration.ts` and is exported as the default
from `src/acp/omp/extension/index.ts`; the bundle, launch and confinement
contract for that callback is [docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md).

## Capability map

`OMP_TOOL_CAPABILITY_MAP` is a frozen record mapping exactly **eleven** native
tool names to the OpenCode abilities they stand for (one-to-one; there is no
fabricated `skill` tool — native skill discovery and `read skill://...` supply
that capability):

| Native tool name | Capability    |
| ---------------- | ------------- |
| `read`           | `read`        |
| `grep`           | `search`      |
| `glob`           | `search`      |
| `find`           | `search`      |
| `todo`           | `todo`        |
| `web_search`     | `network`     |
| `bash`           | `execute`     |
| `edit`           | `modify`      |
| `write`          | `modify`      |
| `delete`         | `destructive` |
| `move`           | `destructive` |

## The decision

`decideOmpToolCapability(toolName)` returns one of two shapes:

- **`{decision: "continue", capability}`** — the name is in the map. The call
  proceeds to native dispatch **without** any repeated native or ACP
  authorization: the existing native approval and the shared ACP policy still
  decide it downstream (see "Shared policy retained").
- **`{decision: "block", reason: "rejected_unknown_tool"}`** — any other name.
  The callback returns `{block: true, reason: "rejected_unknown_tool"}`, which
  blocks the call **before** it executes. No wildcard default-deny key exists in
  the pinned native schema, so this pre-dispatch admission is what closes the
  unmatched-name gap.

**Membership is an own-property check** (`Object.hasOwn`) against the frozen
table, so prototype-shaped names (`toString`, `constructor`, `__proto__`, …)
never match and are blocked like any other unmatched name.

The decision is name-only: no other input participates.

## Mode selection and LSP

Mode selection happens at process launch, not through the callback (see
[docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md)):

- **Restricted** — `agent-config/omp/restricted.yml` authors
  `tools.approvalMode: write` plus exact-name `tools.approval.<name>` entries
  (`read`, `grep`, `glob`, `find`, `todo`, `web_search`: `allow`; `lsp: deny`).
  The capability callback is attached, so every **other** tool name is blocked
  by `rejected_unknown_tool`.
- **Native-YOLO** — `agent-config/omp/native-yolo.yml` authors
  `tools.approvalMode: yolo` with the single explicit denial
  `tools.approval.lsp: deny`. No capability extension is loaded; unmatched
  non-LSP tools keep native permissive policy.

Both modes therefore deny the **LSP tool** by exact-name native approval
(`tools.approval.lsp: deny`). There is **no `--no-lsp` flag** for OMP and no
session-mode override: the denial is expressed in the authored native YAML
only. This is a native approval-tool denial; it makes no claim about implicit
language-server startup.

> Source-observed: the pinned native documentation establishes
> `tools.approvalMode: write|yolo` and exact-name
> `tools.approval.<name>: allow|deny|prompt`, honored in both modes, with no
> wildcard default-deny. Whether the pinned binary honors the LSP denial at
> runtime is not claimed here; native implicit-startup suppression stays
> runtime-unverified (see `docs/AGENT_PERMISSIONS.md`).

## Shared policy retained

Mapped native names are **not** re-authorized by a second project-owned policy;
they continue through the native approval path and the existing shared ACP
policy in `src/acp/*`, which is unchanged:

- **Filesystem authorization** — the shared protected read/write boundaries and
  the restricted mutation sink (`src/acp/filesystem-policy.ts`,
  `src/acp/filesystem-access.ts`) decide the ACP filesystem callbacks the client
  actually serves. A rejected callback write causes no unauthorized file change.
- **Command policy** — the shared lexical command-path policy
  (`src/acp/command-path-policy.ts`) governs `bash` alongside the native
  approval path.
- **Destructive policy** — the shared fail-closed destructive all-target policy
  (`src/acp/destructive-policy.ts`) governs delete/move/multi-file mutation.
- **Skills** — `src/acp/skill-inventory.ts` remains the skill inventory.

### ACP client ingress normalization (`src/acp/omp/destructive-ingress.ts`)

Before the shared destructive policy, the ACP **client** ingress normalizes the
native single-operation vocabulary: `normalizeOmpDestructivePermissionInput()`
canonicalizes a configured-OMP `Delete`/`Move` request (identified from the
native `kind` or a case-insensitive word-boundary `Delete`/`Move` title) into
the shared `{path}` / `{source, destination}` payload, using the native move
alias precedence `oldPath`, `path`, `from` / `newPath`, `to`, `destination`.
The decoder is selected only by the connector-supplied `ClientConfig.agentType`;
request fields, titles and claimed parser lineage grant no authority, and
OpenCode/omitted-type clients keep the pre-existing decoder exactly. Anything
outside the native single-operation field vocabulary (extra mutation fields,
`operations`/patch bodies, malformed JSON, missing or partial locations) is
passed through to the shared bounded `rejected_destructive_incomplete` /
`rejected_destructive_binding` denials.

## Accepted native local posture

Native builtins execute their own local IO under the process's ambient OS
permissions; the daemon-side protected read boundary and the restricted ACP
mutation sink apply only to the ACP filesystem callbacks the client actually
serves. The full posture (read/search, ordinary write/edit, unchanged
boundaries, and "settings, not ACLs") is recorded in
[docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md), "Accepted native local posture".

## Source pin and accepted upstream differences

- **Pin** — official OMP `v18.6.1`, commit
  `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.
- **Unsupported native destructive patch syntax** — the pinned native location
  lists for multi-file patches omit subsequent destructive operations, so native
  edit/patch syntax the shared decoder cannot model keeps its named fail-closed
  denial and no fallback into generic unknown-tool approval. Only the shared
  single delete/move shapes are normalized (above).
- **Native network/URL and skill-URI differences** — native URL read, web search
  and `skill://...` reads use the original native implementation; any native
  transport/result differences remain upstream-owned and are not re-implemented
  here.
- **Native non-overridable identity headers** — the authored
  `agent-config/omp/models.yml` configures the OpenRouter `headers.X-Title:
  AIr-Friends` value; a built-in identity header the pinned native configuration
  cannot override is documented from the pinned source mechanism, never claimed
  as preserved from configuration inspection.

## Related

- [docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md) — the capability bundle, native
  registration, launch and confinement contract, plus the accepted native local
  posture and evidence limits
- [docs/AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md) — runtime permission layers
- [docs/OMP_SETTINGS.md](OMP_SETTINGS.md) — the authored native mode settings
- [openspec/specs/acp-integration/spec.md](../openspec/specs/acp-integration/spec.md)
