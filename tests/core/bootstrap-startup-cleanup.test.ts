// tests/core/bootstrap-startup-cleanup.test.ts
//
// Startup ordering for workspace temporary-file reclamation
// (reap-orphan-workspace-staging D3).
//
// The composition itself is covered by a static wiring assertion, following the
// existing house pattern for `bootstrap.ts` ordering (`tests/utils/
// opencode-skill-discovery-declaration.test.ts`): `bootstrap()` has no
// dependency-injection seam for `AgentCore`, and RUNNING it in a unit test would
// write the OpenCode skill-discovery declaration into the developer's HOME, a
// relative `data/skill-secret` under the cwd and (via `startPlatforms`) log into
// Discord. The behavioral half below therefore replays EXACTLY the call
// `bootstrap()` makes, against a real workspace tree.

import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { WorkspaceManager } from "@core/workspace-manager.ts";

const BOOTSTRAP_SOURCE = Deno.readTextFileSync(
  new URL("../../src/bootstrap.ts", import.meta.url),
);
const MAIN_SOURCE = Deno.readTextFileSync(new URL("../../src/main.ts", import.meta.url));

/** Locate one startup-wiring anchor, failing loudly when it is refactored away. */
function anchor(source: string, needle: string): number {
  const index = source.indexOf(needle);
  assert(index >= 0, `startup-wiring anchor not found: ${needle}`);
  return index;
}

Deno.test("bootstrap - awaited startup reclamation precedes every session-producing ingress", () => {
  // The step itself: the AWAIT is part of the anchor, so a fire-and-forget
  // cleanup (which would race the ingress below) fails this test.
  const reclamation = anchor(
    BOOTSTRAP_SOURCE,
    "await agentCore.getWorkspaceManager().reclaimOrphanTmpDirs(",
  );
  const coreConstruction = anchor(
    BOOTSTRAP_SOURCE,
    "const agentCore = new AgentCore(config, yolo, skillApiSecret);",
  );
  const schedulerStarts = anchor(BOOTSTRAP_SOURCE, "export async function startPlatforms(");

  // Built after the core exists, before anything can produce a session.
  assert(
    coreConstruction < reclamation,
    "startup reclamation must run after the agent core it uses is constructed",
  );

  // Platform ingress (adapter construction AND registration).
  for (
    const ingress of [
      "const discordAdapter = new DiscordAdapter(config.platforms.discord);",
      "const misskeyAdapter = new MisskeyAdapter(config.platforms.misskey);",
      "platformRegistry.register(",
    ]
  ) {
    assert(
      reclamation < anchor(BOOTSTRAP_SOURCE, ingress),
      `startup reclamation must finish before: ${ingress}`,
    );
  }

  // Dashboard ingress.
  assert(
    reclamation < anchor(BOOTSTRAP_SOURCE, "dashboardServer.start();"),
    "startup reclamation must finish before the dashboard starts",
  );

  // Scheduler ingress: every scheduler start lives in `startPlatforms()`, which
  // `bootstrap()` cannot reach because it is defined after the reclamation.
  for (
    const scheduler of [
      "context.spontaneousScheduler.start(",
      "context.channelLurkScheduler.start(",
      "context.selfResearchScheduler.start(",
      "context.memoryMaintenanceScheduler.start(",
      "context.gitBackupScheduler.start(",
      "context.reminderScheduler.start()",
      "context.auditRetentionScheduler.start(",
    ]
  ) {
    assert(
      reclamation < anchor(BOOTSTRAP_SOURCE, scheduler),
      `startup reclamation must finish before: ${scheduler}`,
    );
    assert(
      schedulerStarts < anchor(BOOTSTRAP_SOURCE, scheduler),
      `${scheduler} must stay inside startPlatforms()`,
    );
  }
});

Deno.test("main - bootstrap is awaited before platforms are connected", () => {
  assert(
    anchor(MAIN_SOURCE, "await bootstrap(") < anchor(MAIN_SOURCE, "await startPlatforms("),
    "platform/scheduler ingress must start only after bootstrap resolved",
  );
});

Deno.test("bootstrap - the startup pass is one awaited, idempotent reclamation over the real layout", async () => {
  const repoPath = await Deno.makeTempDir();
  try {
    // A previous, stopped process tree left a workspace with disposable data,
    // reserved engine state and persistent memory files behind.
    const workspacePath = join(repoPath, "workspaces", "discord", "u1");
    const tmpPath = join(workspacePath, "tmp");
    Deno.mkdirSync(join(tmpPath, "sess_orphan"), { recursive: true });
    Deno.writeTextFileSync(join(tmpPath, "sess_orphan", "payload.json"), "orphan");
    Deno.writeTextFileSync(join(tmpPath, "browser-profile"), "orphan");
    Deno.mkdirSync(join(tmpPath, "omp-agent", "restricted", "xdg-data", "omp"), {
      recursive: true,
    });
    Deno.writeTextFileSync(
      join(tmpPath, "omp-agent", "restricted", "xdg-data", "omp", "sessions.db"),
      "native",
    );
    Deno.mkdirSync(join(tmpPath, "opencode-data", "sess_old"), { recursive: true });
    Deno.writeTextFileSync(join(tmpPath, "opencode-data", "sess_old", "out.txt"), "native");
    Deno.writeTextFileSync(join(workspacePath, "memory.public.jsonl"), "memory");

    const manager = new WorkspaceManager({ repoPath, workspacesDir: "workspaces" });

    // EXACTLY the invocation `bootstrap()` performs right after AgentCore
    // construction: awaited, and with startup-only busy evidence.
    const report = await manager.reclaimOrphanTmpDirs({ isWorkspaceBusy: () => false });

    assertEquals(report.workspaces, 1);
    assertEquals(report.skipped, 0);
    assertEquals(report.budgetExhausted, false);
    assert(report.removed >= 2);
    assertEquals(await exists(join(tmpPath, "sess_orphan")), false, "orphan staged dir is gone");
    assertEquals(await exists(join(tmpPath, "browser-profile")), false, "orphan profile is gone");
    // Reserved engine state and the tmp root survive; memory never moves.
    assertEquals(
      Deno.readTextFileSync(
        join(tmpPath, "omp-agent", "restricted", "xdg-data", "omp", "sessions.db"),
      ),
      "native",
    );
    assertEquals(
      Deno.readTextFileSync(join(tmpPath, "opencode-data", "sess_old", "out.txt")),
      "native",
    );
    assertEquals(Deno.lstatSync(tmpPath).isDirectory, true);
    assertEquals(Deno.readTextFileSync(join(workspacePath, "memory.public.jsonl")), "memory");

    // A second startup pass over the same tree is a bounded no-op.
    const again = await manager.reclaimOrphanTmpDirs({ isWorkspaceBusy: () => false });
    assertEquals(again.removed, 0);
    assertEquals(again.retained, 0);
    assertEquals(again.skipped, 0);
  } finally {
    await Deno.remove(repoPath, { recursive: true });
  }
});
