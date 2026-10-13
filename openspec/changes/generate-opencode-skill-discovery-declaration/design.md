# Design

## Context

See proposal.md — Why. Verified current state. The upstream OpenCode chain below is SOURCE-AUDIT evidence read at the pinned v1.17.13 revision (the vendored tree is not part of this repository), not exercised runtime evidence: it is traced end to end at that revision, and "proven" in this document never means observed on a live agent. The repository's own resolution, configuration and bootstrap facts are read from this working tree.

- The pinned OpenCode v1.17.13 chain is proven end to end: `skills.paths: ["<abs root>"]` in `opencode.json` → `ConfigV1.Info.skills` (`packages/core/src/v1/config/skills.ts`, `{paths?: string[]; urls?: string[]}`) → `ConfigMigrateV1.migrate` folds it as `skills: [...(paths ?? []), ...(urls ?? [])]` → the v2 `skills: string[]` → the `config-skill` plugin turns each entry into `draft.source(DirectorySource{type: "directory", path})` (or `UrlSource` when the entry parses as http/https). Path resolution inside that plugin: an entry starting with `~/` joins `global.home`, an absolute entry is used exactly as written, and a relative entry joins `Location.directory`, which is the SESSION cwd rather than the config file's directory — so an absolute root is required.
- `Global.Path.config` is `path.join(xdgConfig, "opencode")` honoring `XDG_CONFIG_HOME`, and `loadGlobal()` merges `config.json`, then `opencode.json`, then `opencode.jsonc` from that directory, later winning.
- The image installs the canonical template at `/home/deno/.config/opencode/opencode.json` (`$UID:0 775`, `Containerfile:254`, `:345` area), which is writable by the runtime user and needs no new environment variable. `Flag.OPENCODE_CONFIG_DIR` was rejected as the mechanism because it would relocate auth and models state as well.
- The shipped template's relevant pins: `agent.build.permission.bash` routes `deno run *` and `*.ts*` to `ask` (`agent-config/opencode.json:92-93`) so skill executions reach the ACP gate, and `agent.build.permission.external_directory` (`:95-101`) allows `~/.agents/skills/**`, `/home/deno/.agents/skills/**`, `/app/data/agent-workspace/**` and `/app/data/workspaces/*/tmp/**` with a `*` default deny.
- An operator can mount their own configuration read-only over that path (`docs/DEVELOPMENT.md:590` documents `-v ./my-opencode.json:/home/deno/.config/opencode/opencode.json:ro`), and a development deployment uses the developer's own OpenCode configuration at the same relative location.
- The resolved value comes from `resolveTrustedSkillsRoot(...)` exactly as in `unify-skill-root-and-inventory`; `src/bootstrap.ts:192-195` already resolves it for the external-skill publication destination, before AgentCore construction.

## Goals / Non-Goals

**Goals:** OpenCode's declared discovery and read visibility follow the deployment's one configured value, with every other pin in the file preserved; the write is a no-op when the file already declares the root; a contradicting, unwritable configuration fails loudly instead of silently.

**Non-Goals:** changing the approval gate, the root-exact inventory or the `deno run *` / `*.ts*` routing; relocating auth or model state; adding a public configuration field, Helm value or environment override; replacing the canonical template as the source of every other pin; rewriting an operator file that is already correct.

## Decisions

### D1. Generate the declaration from the one resolved value

The declaration step reads the resolved root once (the same value the inventory, prompts, mounts and readiness use) and writes: the skill discovery path list containing exactly that root, and an `external_directory` allowance under that root. Nothing else in the document changes, and no second root is ever introduced. The declaration is an absolute path: a `~`-relative or relative entry would resolve against the session cwd and silently point elsewhere.

### D2. Target the deployed configuration, inspect before writing

The target is the deployed OpenCode global configuration (`/home/deno/.config/opencode/opencode.json` in the image; the developer's configuration in development), the same file an operator mount shadows. The check is canonical rather than textual and covers BOTH declaration entries: a file that already names a root resolving to the resolved root — including a `~/` spelling — and already allows external-directory reads under it is left byte-identical, so the documented read-only mount keeps working when it is fully correct. Otherwise the daemon writes the updated document.

Alternatives rejected: `OPENCODE_CONFIG_DIR` (relocates auth and models state); a generated sibling that wins by load order (`config.json` → `opencode.json` → `opencode.jsonc`), which would silently override an operator's own file and its pins; relying on the implicit `~/.agents/skills` convention, which ignores any operator `AGENT_SKILLS_DIR` value.

### D3. Fail explicitly when the declaration cannot be made true

A file that must be updated but cannot be written (a read-only operator mount whose content contradicts the resolved root) fails startup explicitly, naming the file and the resolved root. The alternative — warn and continue — would start an agent whose discovery contradicts the root the daemon tells it to execute from, which is precisely the asymmetry this proposal set removes.

### D4. Scope of the declaration

The declaration grants discovery and file-read visibility. It never grants script execution: the root-exact inventory and the ACP approval gate remain the sole authority, and they still route `deno run *` and `*.ts*` to the gate. The step runs before agent construction, next to the existing external-skill publication, so an inventory built afterwards observes the same root.

### D5. Absent target, over-broad allowance, and the OMP-only case

When the deployed configuration file does not exist at all, bootstrap creates it containing exactly the declaration entries (the parent directory too when needed); a configuration whose content corroborates the resolved root is still left untouched when it exists. Failing instead was rejected: an absent file declares nothing, and a development or wiped-HOME deployment would silently lose discovery, which is the asymmetry this proposal set removes.

The allowance is bounded to the resolved root itself: the step refuses to run — failing startup explicitly, naming the root — when the resolved root is the daemon user's home directory or an ancestor of it, because a home-scoped allowance would let the agent read unrelated home content (credentials, other configuration) far beyond a skill tree. The step never writes an allowance for a parent directory of the root.

The step runs unconditionally, including when OMP is the deployment's default agent, because a dashboard-selected OpenCode session can exist on that deployment and would otherwise resolve a root its own agent cannot discover — the same reasoning that already makes the external-skill publication destination independent of the default agent type.

## Risks / Trade-offs

- **The `~/` equivalence assumes the OpenCode child resolves the same home as the daemon** (the child inherits `HOME` on this launch path) → the comparison resolves `~` against the daemon's observed home and the assumption is stated here; if a deployment isolates the child's home, the written absolute path stays correct and only the no-op optimization is lost.

- **A new bootstrap side effect on a possibly operator-mounted file** → inspect-then-write with canonical comparison and explicit failure (D2, D3), documented in `docs/DEVELOPMENT.md`.
- **A development deployment writes into the developer's own OpenCode configuration**, permanently adding a repository-derived path and an allowance → stated in the migration plan and the documentation; a developer can avoid the write by declaring the resolved root themselves (which makes the step a no-op).
- **The configuration is writable by the runtime user** (`$UID:0 775`) and now carries a discovery path and an external-directory allowance → this is the file's pre-existing posture (the agent could already rewrite its own pins before this change), and it grants no execution authority (D4).
- **A canonical comparison can mask a materially different spelling** (for example a symlinked home) → accepted: two spellings that resolve to the same directory are the same discovery source, and the resolver's canonical observation is the value written.

## Migration Plan

Deploy after `unify-skill-root-and-inventory`; independent of the OMP trust alignment and the packaging collapse, so it may ship in the same release or a following one. Operator consequence: an operator who mounts their own OpenCode configuration read-only must either declare the resolved root in it or mount it writable — otherwise startup fails explicitly. Development consequence: the developer's own configuration gains the resolved root and the allowance. Rollback is a revert; the written file keeps its generated keys until the next run rewrites or the operator restores it.

## Dependencies and Conflicts

| Change | Relationship | Code/spec overlap | Scheduling |
| --- | --- | --- | --- |
| `unify-skill-root-and-inventory` | Required dependency: consumes its resolved value | `src/bootstrap.ts`, configuration-and-deployment deltas, `docs/DEVELOPMENT.md` | After it; same or next release |
| `align-omp-skill-trust-to-shared-root` | None | None | Any order |
| `collapse-skill-packaging-to-one-tree` | None | None | Any order |

Documentation edits to `docs/DEVELOPMENT.md` are sequential with `unify-skill-root-and-inventory` (different sections).

## Open Questions

None that would change the specs, the approach or the task breakdown.
