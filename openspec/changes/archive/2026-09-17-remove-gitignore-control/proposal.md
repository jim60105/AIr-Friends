## Why

`GitBackupService.ensureGitignore()` force-overwrites `{dataDir}/.gitignore` with a hardcoded template on every `initialize()` branch and whenever it runs, silently clobbering any rules the operator maintains in the data repository. In production (bot0419/AIr-Friends_memory) this repeatedly erased operator-added rules, causing runtime artifacts (PNGs, `opencode-data/`, `channel-tmp/`, `skill-jwt/`) to be committed and tracked, and ultimately forced a git-filter-repo history rewrite to clean the remote. The code should not own a file it cannot merge with the operator's intent; the data repo's `.gitignore` belongs to the operator.

## What Changes

- **BREAKING** Remove `GitBackupService.ensureGitignore()` (`src/core/git-backup-service.ts:442-478`) and all three call sites (`initFromClone` ~109, `initFromExisting` ~170, `initFromGitRepo` ~192). The service will never create, overwrite, or modify `.gitignore` in the data directory again.
- The side effect bundled with the method — `git rm --cached --ignore-unmatch scheduler-state.json` — is removed with it. Keeping `scheduler-state.json` out of the index becomes purely operator responsibility, documented via the recommended baseline `.gitignore`.
- Delete/adjust tests asserting generated `.gitignore` content: remove `tests/core/git-backup-service.test.ts` "GitBackupService - ensureGitignore includes **/.git rule" (~687); strip the `.gitignore` assertion from "initialize creates .git and .gitignore" (~86) and rename it; fix the stale "initial commit with .gitignore" comment in the clone-fallback test (~410).
- Docs carry an operator-facing recommended baseline `.gitignore` (scheduler-state.json, `**/.git`, `**/tmp/**`, `.DS_Store`, `Thumbs.db`, `channel-tmp/`, `opencode-data/`, `channel-cwd/`, `skill-jwt/`, `skill-secret`, image/binary/office/html globs) in `docs/DESIGN.md`, `docs/DEVELOPMENT.md`, `config.example.yaml`, and `helm/values.yaml` comments.

## Capabilities

### New Capabilities

### Modified Capabilities
- `git-backup`: Remove the "Gitignore Management" requirement (service no longer writes `.gitignore` or untracks `scheduler-state.json`); drop `.gitignore` steps from the three Smart Initialization scenarios; add a requirement that the service MUST NOT create, overwrite, or modify `.gitignore` in the data directory.

## Impact

- `src/core/git-backup-service.ts` — delete `ensureGitignore()` + 3 call sites + stale `.gitignore` comment in `initFromClone`
- `tests/core/git-backup-service.test.ts` — remove/adjust `.gitignore` assertions (tests at ~687, ~86, ~410)
- `openspec/specs/git-backup/spec.md` — synced on archive of this change
- `docs/DESIGN.md` (Git Backup section), `docs/DEVELOPMENT.md` (Git Backup env section), `config.example.yaml` (gitBackup block), `helm/values.yaml` (GIT_BACKUP block comment) — operator-owned `.gitignore` guidance + recommended baseline
- `AGENTS.md` — Feature 21 Git Backup description (no generated-`.gitignore` claim remains; keep accurate)
- No config schema, env var, or deployment change; operators upgrading must ensure their data repo's `.gitignore` covers runtime artifacts (baseline provided in docs).

## Batch

- depends-on: (none)
- code-conflicts: touches only `src/core/git-backup-service.ts`, `tests/core/git-backup-service.test.ts`, docs/config/helm comment lines in the gitBackup blocks; no other in-flight changes expected in `openspec/changes/`.
