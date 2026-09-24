// tests/core/git-backup-relative-cwd.ts
// Helper for the "converts relative path to absolute for safe.directory" test.
//
// Runs GitBackupService.initialize() with a genuinely RELATIVE data dir inside
// a child process whose cwd is a temp directory. The contract needs a relative
// path resolved against a foreign cwd, but doing that with Deno.chdir() in the
// test process would mutate the cwd of the entire (single-process, --parallel)
// test run and race every other file's relative-path resolution
// (observed as 13 ENOENT prompt-render failures in CI run 35964700812).
//
// argv: [bareRemoteUrl]
import { GitBackupService } from "@core/git-backup-service.ts";

await Deno.mkdir("./data", { recursive: true });

const service = new GitBackupService(
  {
    enabled: true,
    remoteUrl: Deno.args[0] ?? "",
    intervalMs: 3600000,
    authorName: "Test Author",
    authorEmail: "test@example.com",
  },
  "./data",
);
await service.initialize();
