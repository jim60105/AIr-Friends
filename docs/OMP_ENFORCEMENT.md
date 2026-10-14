# OMP Restricted Capability Extension (bundle, registration, launch, confinement)

The restricted OMP integration ships exactly **one** native extension: a small
capability-admission callback attached to the official pre-dispatch `tool_call`
API. The callback performs the single decision documented in
[docs/OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md) — a native call naming one of the
eleven mapped abilities continues to native dispatch, and any other name is
blocked before execution with the bounded reason `rejected_unknown_tool`. It adds
no further decision logic and no second policy.

Pinned to official OMP **v18.6.1** / commit
`2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`. Carried by the OpenSpec change
`cutover-omp-native-runtime`.

> **Evidence boundary.** This document is a source/configuration observation of
> the shipped extension, launch and mount wiring. It does not claim the official
> native binary was run and does not certify that the binary loads the module or
> invokes the registered callback. Live observation of the confined native
> runtime is owned by the separate `verify-omp-confined-native-runtime` change
> and is **not** claimed here.

## Live modules

| Module                                         | Role                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/acp/omp/extension/index.ts`               | Entrypoint: default-exports `registerOmpCapabilityCallback`                                                                 |
| `src/acp/omp/extension/native-registration.ts` | Registers `api.on("tool_call", handler)` and implements the capability callback over `decideOmpToolCapability`              |
| `src/acp/omp/tool-inventory.ts`                | The frozen capability map and `decideOmpToolCapability` (see [OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md))                      |

## Generated bundle contract

The extension is **one self-contained ESM bundle** with **zero external
dependency edges**:

- **Build** — `deno task bundle:omp-extension` cuts it from canonical source
  (`src/acp/omp/extension/index.ts`) and the frozen lock. A missing generated
  artifact fails the restricted launch naming this build remedy; the raw
  Deno-only source tree is never a load fallback.
- **Selection** — the restricted launch resolves the bundle **image-first**:
  `/opt/air/omp/extension/index.js` when present, otherwise the deterministic
  generated development entry `build/omp-extension/index.js`.
- **Load** — only the restricted launch loads the bundle (`--trusted-extension
  <bundle>`, below). Native-YOLO loads no extension.
- **No ownership prerequisite** — file ownership or replacement evidence is
  **not** an integration authorization prerequisite. The bundle is accepted
  because the restricted launch selected and mounted it; authorization of mapped
  names is the native approval + shared ACP path, not a property of the artifact.

## Native registration

The pinned native loader evaluates the module's **default export** as a factory
and discards its return value, so the only enforcement surface is what the
factory registers synchronously through the native `ExtensionAPI`:

```ts
// src/acp/omp/extension/native-registration.ts
api.on("tool_call", (event) => {
  const decision = decideOmpToolCapability(event.toolName);
  if (decision.decision === "continue") return undefined;      // continue to native dispatch
  return { block: true, reason: decision.reason };             // "rejected_unknown_tool" — blocks pre-dispatch
});
```

- The handler receives the pinned event's `toolName` and returns `undefined` to
  continue toward the mapped ability's own native/ACP path, or
  `{block: true, reason}` to stop the call before it executes.
- The callback is attached **unconditionally** by the restricted launch; there
  is no cwd/mode observer, no registry observation, no replacement tool
  registration and no handshake.
- No registry surface and no session acquisition is consumed.

## Launch wiring

The OMP factory branch assembles:

```
omp acp --config <selected mode settings> --system-prompt <selected prompt>
```

- **Restricted** appends `--trusted-extension <resolved bundle>`; **native-YOLO
  loads no extension**. The two modes are separate processes selected at launch;
  OMP exposes no ACP session-mode override.
- **`--no-extensions` and `--no-lsp` are gone** — native ambient exploration
  stays enabled and the LSP denial is the exact-name YAML in both mode documents
  (see [OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md)).
- **cwd** — the process working directory is the caller/session `workingDir`
  (there is no neutral launch cwd).
- **`TMPDIR`** — `{repoPath}/channel-tmp/{poolKey}` when pooled, else
  `{workingDir}/tmp`.
- **`XDG_DATA_HOME`** — `ompXdgDataHome(baseRoot, mode)` =
  `{baseRoot}/omp-agent/{mode}/xdg-data`, where `baseRoot` is
  `{repoPath}/omp-pools/{poolKey}` when pooled, else `{workingDir}/tmp`. Its
  `omp` child is created before spawn, because native OMP redirects its data
  directory to `$XDG_DATA_HOME/omp` when that application directory already
  exists.
- **`HOME`** is inherited normally; `PI_CODING_AGENT_DIR` is **not** assigned and
  there is no isolated HOME. Native model configuration is read from the
  inherited HOME's native config path (mounted read-only below).
- **Unchanged** — `SESSION_ID` (per-spawn), `SKILL_SHARED_PROCESS` (pooled),
  `SKILL_JWT_DIR`, `AGENT_WORKSPACE`, the detected browser binary and the egress
  proxy variables. Payload staging remains `{session cwd}/tmp/{Skill API ID}`.

## Environment filtering

The shared filter/allowlist decides the environment: platform/dashboard/raw
Skill API secrets stay denied and OpenCode's existing selector denials are
unchanged. OMP adds **no** separate discovery sanitization, no foreign-provider
selector blacklist and no settings-source consistency prerequisite.

## Confinement mounts

`AgentConfig.runtimeMounts` (optional, OMP only) supplies `readOnlyPaths` and
`writableRuntimePaths`, which `SandboxManager.buildSpawnOptions()` appends to the
shared confinement defaults:

- **Read-only** — the selected mode settings file, the selected system prompt,
  the restricted capability bundle (restricted only) and the inherited-HOME
  `.omp/agent/models.yml`.
- **Read-write** — the selected `<XDG_DATA_HOME>/omp` child.

Sibling mode/pool data roots, the pool parent, `dataRoot` and HOME are **not**
exposed. The shared skill-root overlap refusal and final read-only skill bind are
unchanged. OpenCode passes no `runtimeMounts` and its mounts are unchanged.

## Accepted native local posture

Authenticated native builtins execute their own local IO. This change states that
boundary truthfully instead of claiming confinement the pinned binary does not
provide:

- **Read/search** — native `read` and the builtin `grep`/`glob`/`find` search run
  under the supported native activation/approval tier and then the process's own
  ambient OS permissions. Native scans and content IO are not daemon
  descriptor-bound and are not protected by an ACP read denial: an
  ambient-readable path outside the daemon session roots may be read. The
  daemon-side protected read boundary keeps its guarantees only for the ACP
  filesystem callbacks that actually execute.
- **Ordinary write/edit** — native `write`/`edit` run under the pinned native
  approval path and the same ambient OS permissions. The restricted ACP mutation
  sink decides the route where the pinned bridge routes the call, and its
  decision/denial propagation is unchanged; an absolute native session-sandbox/
  plan target or an unavailable client bridge does not reach that sink and mutates
  directly — the user-authorized residual risk.
- **Unchanged boundaries** — the shared command policy for `bash`, the fail-closed
  destructive decision for delete/move/multi-file mutation, the shared ACP
  filesystem authorization, the shared egress proxy/SSRF posture
  (`src/utils/ssrf.ts`, `src/utils/egress-proxy.ts`) and the both-mode exact-name
  LSP denial all stand unchanged.
- **Settings, not ACLs** — support comes from the authored restriction
  (exact-name `tools.approval` allow entries and the activation flags), not from
  a fabricated filesystem ACL.

## Source pin and accepted upstream differences

- **Pin** — official OMP `v18.6.1`, commit
  `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.
- **Native unsupported destructive patch limits** — the pinned native location
  lists for multi-file patches omit subsequent destructive operations, so native
  edit/patch syntax the shared decoder cannot model keeps its named fail-closed
  denial; only the shared single delete/move shapes are normalized.
- **Native URL/search differences remain upstream-owned** — native read URL,
  web search and `skill://...` reads use the original native implementation; the
  project re-implements no transport, backend or skill-URI metadata.
- **Native non-overridable identity headers** — the authored native model file
  configures the OpenRouter `headers.X-Title: AIr-Friends` value; a built-in
  identity header the pinned native configuration cannot override is documented
  from the pinned source mechanism, never claimed as preserved from
  configuration inspection or mocks.

## Evidence limits

- The callback's block/continue effect and the bundle's zero-external-edge shape
  are exercised API-shape and consumer-level only; they do not prove that the
  pinned binary loads the module or delivers events to it.
- The accepted native local posture above is a source observation of the pinned
  binary's behavior, not a runtime observation.
- The real confined-native-runtime probe (native directory load, data
  persistence, offline probe output, authored model bytes) and the authored test
  model fixture are wholly owned by the separate `verify-omp-confined-native-runtime`
  change; **no runtime observation is claimed here**.

Related: [OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md) ·
[AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md)
