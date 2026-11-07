# Design

## Context

Source design: `docs/superpowers/specs/2026-11-07-identity-linked-memory-design.md` (sections 3, 4.1, 4.2, 10). That document scopes the feature as one change; this batch splits it into three workday-sized changes. This first change delivers configuration and the registry only.

Observed code:

- `src/core/config-loader.ts`: `loadConfig()` deep-merges defaults and YAML, calls `applyEnvOverrides(config)`, then `validateConfig(config)`. `validateConfig` normalizes `channels` through `loadChannels()` (around line 746). `DEFAULT_CONFIG` holds `channels: []`.
- `src/utils/env.ts`: `ENV_MAPPINGS` maps `CHANNELS: "channels"`; `applyEnvOverrides` skips unset/empty variables and JSON-parses `CHANNELS`, silently skipping invalid JSON or a non-array (`continue`).
- `src/platforms/email/email-identity.ts`: `normalizeEmailMailbox(address)` returns `{ canonicalAddress, userId }` with `userId = "e_" + sha256hex(canonicalAddress)`. Its thrown messages **include the raw address**, so the loader must catch and replace them.
- `src/types/config.ts`: `parseChannelId(id)` matches `^(\w+)\/(account|channel|timeline)\/(.+)$`.
- `src/types/events.ts`: `VALID_PLATFORMS = ["discord", "misskey", "email"]`, `isValidPlatform()` (line 15).
- `src/utils/path-validator.ts`: `sanitizePathComponent()` replaces `/`, `\`, `..` with `_`, strips leading dots and trims.
- `src/core/workspace-manager.ts`: `computeWorkspaceKey({platform,userId})` sanitizes both components; `getWorkspacePath(key)` resolves under the workspaces root and throws `WorkspaceError` when outside it. Neither creates directories.
- `src/types/errors.ts`: `ConfigError(ErrorCode.CONFIG_INVALID, message, context?)`.

## Goals / Non-Goals

**Goals:**
- `Config.identities: IdentityGroupConfig[]` with canonical workspace keys, validated fail-fast.
- `IDENTITIES` env override using the existing JSON-array path.
- `IdentityRegistry` with `groupOf`, `linkedWorkspaces`, `groupCount`.

**Non-Goals:**
- Constructing the registry in `AgentCore`, or any change to `ContextAssembler`, `MemoryRetriever`, `MemoryHandler`, `SkillRegistry` (owned by `identity-linked-memory-recall` / `identity-linked-memory-patch`).
- A native `identities` value in `helm/templates/secret.yaml` (only the `IDENTITIES` env entry is added, per source design §10).
- Runtime reload, identity inference, changes to `channels` or reply policy.

## Decisions

### D1. Types

In `src/types/config.ts`, next to `ChannelConfig`:

```ts
/** One operator-declared identity group (identity-linked memory). */
export interface IdentityGroupConfig {
  /** Operator-facing label; used only in logs and error locations. */
  id: string;
  /** Canonical workspace keys `{platform}/{userId}`, produced by the config loader. */
  accounts: string[];
}
```

`Config` gains `identities?: IdentityGroupConfig[];` (optional, so the many hand-built `Config` literals in tests keep type-checking; `loadConfig` always sets it, `DEFAULT_CONFIG` sets `identities: []`, and consumers read `config.identities ?? []`). `src/core/identity-registry.ts` imports the type from `src/types/config.ts` instead of redeclaring it.

### D2. Normalization function (exported for unit tests)

Add to `src/core/config-loader.ts`:

```ts
export function normalizeIdentities(raw: unknown): IdentityGroupConfig[]
```

`validateConfig` calls it right after the `channels` block: `config.identities = config.identities === undefined ? [] : normalizeIdentities(config.identities);`. Because env overrides already ran, YAML and `IDENTITIES` share this path.

Per account entry (field path `identities[i].accounts[j]`), after `const value = entry.trim()`:

1. `parseChannelId(value)` matches:
   - type `account` → `platform = match.platform`, `rest = match.value`; continue at step 4 (email) or step 5 (others).
   - type `channel` / `timeline` → reject.
2. Else, `value` contains `@` and no `/` → email address: `userId = normalizeEmailMailbox(value).userId`, platform `email`.
3. Else, `value` starts with `email/` → `rest = value.slice(6)`, continue at step 4.
4. Email remainder: if `/^e_[0-9a-f]{64}$/.test(rest)` → `userId = rest`; else `userId = normalizeEmailMailbox(rest).userId`.
5. Else split on the first `/` → `platform`, `userId`. Require `isValidPlatform(platform)`, non-empty `userId`, no `/` in `userId`, and `sanitizePathComponent(userId) === userId` (rejects `\`, `..`, leading `.`, inner leading/trailing whitespace).
6. Steps 1(account) for non-email platforms apply rule 5's `userId` checks to `rest`.
7. Canonical key `${platform}/${userId}`.

Every rejection, including any exception from `normalizeEmailMailbox`, is caught and rethrown as `new ConfigError(ErrorCode.CONFIG_INVALID, "<path> is not a supported identity account", { field: "<path>" })`. The original error and the value are never placed in the message or context.

Group checks, in order: `raw` is an array (`identities must be an array`); each group is a non-null, non-array object (`identities[i] must be a mapping`); `id` is a non-empty trimmed string (`identities[i].id must be a non-empty string`); `id` not seen before (`identities[i].id duplicates an earlier group id`); `accounts` is a non-empty array (`identities[i].accounts must be a non-empty array`); each entry is a string (`identities[i].accounts[j] must be a string`). A `Map<canonicalKey, path>` across all groups detects duplicates: `identities[i].accounts[j] duplicates identities[k].accounts[l]`. Group ids are stored trimmed.

Alternative considered: warn-and-skip like `loadChannels`. Rejected: a silently dropped account would silently change which memories are readable; the source design requires fail-fast.

Rule 5's `sanitizePathComponent(userId) === userId` check is an addition to the source design: it guarantees the canonical key equals `WorkspaceManager.computeWorkspaceKey()` output, so registry lookups by `workspace.key` cannot miss and two entries cannot collapse to one directory after sanitization.

### D3. Environment override

`src/utils/env.ts`: add `IDENTITIES: "identities"` to `ENV_MAPPINGS` (next to `CHANNELS`) and extend the `CHANNELS` JSON branch condition to `envName === "CHANNELS" || envName === "IDENTITIES"`, keeping its silent skip of invalid JSON / non-arrays. No warning is added, matching `CHANNELS` (the source design's "with a warning" wording is resolved toward the existing pattern; nothing prints the value either way).

### D4. `IdentityRegistry`

New file `src/core/identity-registry.ts`:

```ts
import { join } from "@std/path";
import type { IdentityGroupConfig } from "../types/config.ts";
import type { Platform } from "../types/events.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";

export class IdentityRegistry {
  constructor(groups: readonly IdentityGroupConfig[], workspaceManager: WorkspaceManager);
  groupOf(workspaceKey: string): string | undefined;
  linkedWorkspaces(current: WorkspaceInfo): WorkspaceInfo[];
  readonly groupCount: number;
}
```

Constructor builds `Map<workspaceKey, IdentityGroupConfig>`; for each account it splits on the first `/` and stores under `workspaceManager.computeWorkspaceKey({ platform, userId })`. If a key is already present it throws `Error("Identity account listed in more than one group: <groupId>")` (defensive; the loader already prevents this). `groupCount = groups.length`.

`linkedWorkspaces(current)`: look up `current.key`; return `[]` when absent; otherwise map every account of the group except the one whose computed key equals `current.key`, in configuration order, through private `workspaceInfoFor(accountKey, isDm)`:

```ts
const [platform, userId] = splitFirst(accountKey);
const key = this.workspaceManager.computeWorkspaceKey({ platform: platform as Platform, userId });
const path = this.workspaceManager.getWorkspacePath(key);
return { key, components: { platform: platform as Platform, userId }, path, tmpPath: join(path, "tmp"), isDm };
```

`isDm` is `current.isDm` ("private visibility allowed in this recall"). No `createdAt`. No filesystem call.

### D5. Review document

Documentation prose (`config.example.yaml` comments, `.env.example`, `helm/values.yaml`, `docs/reference/config-schema.md`, `docs/admin/configuration.md`) is reviewed by a human for accuracy and wording against this design; it is the named review document **"identity-groups documentation review"** and is not a test requirement. Each file keeps its existing language (`docs/reference/config-schema.md` and `docs/admin/configuration.md` are zh-TW).

## Risks / Trade-offs

- [Operator links someone else's account] → Documented as explicit authorization in `config.example.yaml`; no inference or defaults.
- [Email address leaks via logs] → Loader errors carry only field paths; `normalizeEmailMailbox` errors are swallowed and replaced.
- [Stricter user id rule rejects an exotic real id] → Real Discord/Misskey/email ids never contain the rejected characters; the error names the path so the operator can see which entry.

## Migration Plan

None. Pre-release; `identities` defaults to `[]` and nothing consumes it until `identity-linked-memory-recall`.
