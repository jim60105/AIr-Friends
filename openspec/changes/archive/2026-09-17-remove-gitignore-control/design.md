## Context

`GitBackupService` maintains `{dataDir}/.gitignore` by force-writing a hardcoded template via `ensureGitignore()` (`src/core/git-backup-service.ts:442-478`) at the top of all three `initialize()` branches (`initFromClone` ~109, `initFromExisting` ~170, `initFromGitRepo` ~192). The write is unconditional (`Deno.writeTextFile`), so operator edits in the data repository are erased on every initialization, and since the file is committed by the subsequent `git add -A` + commit, the clobber also propagates to the remote. In the production memory repo this caused runtime artifacts (rendered PNGs, `opencode-data/`, `channel-tmp/`, `skill-jwt/`) to become tracked and required a git-filter-repo history rewrite.

The method also performs an unrelated index cleanup: `git rm --cached --ignore-unmatch scheduler-state.json`.

## Goals / Non-Goals

**Goals**
- The backup service never creates, overwrites, or modifies `.gitignore` in the data directory.
- Clean cutover: method, call sites, and content-asserting tests removed; no config flag, no "write only if absent" shim.
- Operators receive a documented recommended baseline `.gitignore` covering everything the code used to force, plus the runtime dirs that motivated the incident.

**Non-Goals**
- No migration tooling that pre-populates a `.gitignore` in the data dir (that would re-create the ownership problem).
- No changes to submodule deregistration, conflict resolution, auth, or scheduling behavior.

## Decisions

1. **Full removal, no opt-out flag.** A `manageGitignore: true|false` config option would keep two code paths and the same footgun one config away. The ownership question has one right answer: the data repo belongs to the operator. Removing the method entirely is smaller than gating it.
2. **`scheduler-state.json` untracking disappears with the method.** The `git rm --cached` side effect only existed because the code owned the ignore rule. With operator ownership, exclusion of `scheduler-state.json` is the operator's responsibility, covered by the documented baseline (the first line). Existing production repos already carry the rule post-incident; a fresh empty data dir will get whatever `.gitignore` the operator clones or creates.
3. **Recommended baseline lives in docs, not code.** `docs/DESIGN.md` Git Backup section gets a fenced baseline block (scheduler-state.json, `**/.git`, `**/tmp/**`, `.DS_Store`, `Thumbs.db`, `channel-tmp/`, `opencode-data/`, `channel-cwd/`, `skill-jwt/`, `skill-secret`, and image/binary/office/html globs such as `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.mp4`, `*.pdf`, `*.docx`, `*.xlsx`, `*.pptx`, `*.html`). The baseline is annotated as advisory for `**/.git`: `deregisterSubmodules()` only unregisters *registered* submodules, so an agent-created nested repo still appears as a gitlink entry unless its directory is explicitly ignored (git never tracks `.git` contents — noisy commits only, matching pre-change behavior). `config.example.yaml` (repo root) and `helm/values.yaml` gitBackup blocks gain a comment pointing operators at this section; `docs/DEVELOPMENT.md` gains the operator note beside the Git Backup env table; `AGENTS.md` Feature 21 gains a one-line operator-ownership note. Docs-only placement keeps the code free of ignore semantics.
4. **Tests follow the contract flip.** The dedicated `ensureGitignore` test is deleted; the "initialize creates .git and .gitignore" test keeps its `.git` assertion, loses the `.gitignore` assertion, and is renamed. New regression coverage: initialize on a data dir containing an operator-authored `.gitignore` MUST leave the file byte-identical (fails if any code path re-adds a write).

## Risks / Trade-offs

- **Fresh installs without a `.gitignore` will back up runtime artifacts** (tmp dirs, media, scheduler state). Accepted: the docs baseline is the supported remedy, and silently rewriting an operator's file is the worse failure. `deregisterSubmodules()` still prevents registered submodules from being tracked, and git never tracks `.git` contents, so the worst new failure mode is noisy commits and larger diffs, not history corruption.
- **`scheduler-state.json` may reappear in commits** (hourly churn, since the file is frequently updated) for operators who skip the baseline. Mitigated by naming it as the first baseline line in all five touched docs surfaces (`docs/DESIGN.md`, `docs/DEVELOPMENT.md`, `AGENTS.md`, `config.example.yaml`, `helm/values.yaml`).

## Migration Plan

No data migration. On upgrade, operators verify their data repo `.gitignore` matches (or extends) the documented baseline; the repo history has already been rewritten in production, so no cleanup commit is forced by the code — the next operator commit naturally leaves `.gitignore` alone.

## Open Questions

None.
