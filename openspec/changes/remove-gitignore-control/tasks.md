## 1. Remove code-owned .gitignore

- [x] 1.1 Delete `ensureGitignore()` (`src/core/git-backup-service.ts:442-478`) — including its bundled `git rm --cached --ignore-unmatch scheduler-state.json` side effect — and verify `grep -n "ensureGitignore" src/core/git-backup-service.ts` returns nothing
- [x] 1.2 Remove the three `await this.ensureGitignore();` call sites — `initFromClone` (~109), `initFromExisting` (~170), `initFromGitRepo` (~192) — plus the stale `// Remote had commits: commit .gitignore changes if any, and push` comment in `initFromClone` (~147); verify `deno check src/main.ts` passes with no unused-symbol errors

## 2. Tests follow the contract

- [ ] 2.1 Delete `Deno.test("GitBackupService - ensureGitignore includes **/.git rule", ...)` (~line 687) in `tests/core/git-backup-service.test.ts`; keep the `assertStringIncludes` import — it is still used by the `getAuthenticatedUrl` tests (~777, ~790, ~821)
- [ ] 2.2 Retitle `Deno.test("GitBackupService - initialize creates .git and .gitignore", ...)` (~86) to `... creates .git and no .gitignore`; delete its `.gitignore` read/assertion (~97-98) and assert instead that `{dataDir}/.gitignore` does NOT exist after `initialize()` (covers the ADDED "No .gitignore present" scenario); verify the test passes
- [ ] 2.3 Fix the stale `// Should have an initial commit with .gitignore` comment (~410) in the clone-fallback test; verify `deno test tests/core/git-backup-service.test.ts` passes
- [ ] 2.4 Add regression tests "GitBackupService - leaves operator .gitignore untouched": (a) Case B — write an operator `.gitignore` (custom rule, e.g. `*.png`) into the temp data dir before `initialize()`, run a `performBackup()` afterwards, assert byte-identity; (b) Case C — initialize, then write a custom `.gitignore`, then re-initialize with a fresh service instance (pattern of the existing test ~495-536), assert byte-identity. Verify both fail if any `.gitignore` write is reintroduced and pass on the fixed code

## 3. Operator documentation

- [ ] 3.1 Add an operator-owned `.gitignore` paragraph and the recommended baseline fenced block to the Git Backup section of `docs/DESIGN.md`: `scheduler-state.json`, `**/.git`, `**/tmp/**`, `.DS_Store`, `Thumbs.db`, `channel-tmp/`, `opencode-data/`, `channel-cwd/`, `skill-jwt/`, `skill-secret`, and media/binary globs (`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.mp4`, `*.pdf`, `*.docx`, `*.xlsx`, `*.pptx`, `*.html`). Annotate that `**/.git` is advisory for unregistered nested repos — `deregisterSubmodules()` only unregisters registered submodules, so an agent-created nested repo appears as a gitlink entry unless its directory is ignored (no content is ever tracked; noisy commits only, matching pre-change behavior). Verify the section states the service never writes `.gitignore`
- [ ] 3.2 Add the operator note (own your `.gitignore`; baseline lives in `docs/DESIGN.md`) beside the Git Backup env table in `docs/DEVELOPMENT.md`
- [ ] 3.3 Add a comment to the `gitBackup:` block in the root `config.example.yaml` stating the data dir `.gitignore` is operator-maintained and linking the DESIGN.md baseline
- [ ] 3.4 Add the equivalent one-line comment to the `GIT_BACKUP_*` block in `helm/values.yaml`
- [ ] 3.5 Add a one-line note to `AGENTS.md` Feature 21 (Git Backup): the data dir `.gitignore` is operator-maintained; the service never writes it

## 4. Verification

- [ ] 4.1 Run project gates once at the end: `deno fmt src/ tests/`, `deno lint src/ tests/`, `deno check src/main.ts`, `deno test` — all green
- [ ] 4.2 Add a CHANGELOG.md entry under Unreleased (Removed: code-managed data-dir `.gitignore`; operator-owned going forward, see docs baseline) and verify the diff touches only the intended files
