#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
// scripts/migrate-memory-v2.ts
//
// Migration script: adds v2 fields (tier, category, scope, decay) to legacy memory entries.
// Safe to run multiple times (idempotent). Creates .backup.jsonl before modifying any file.
//
// Usage:
//   deno run --allow-read --allow-write scripts/migrate-memory-v2.ts --data-dir ./data

import { MemoryIndex } from "../src/core/memory-index.ts";
import { join } from "jsr:@std/path@^1/join";
import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import { exists } from "jsr:@std/fs@^1/exists";

interface MigrationStats {
  workspaces: number;
  files: number;
  entriesMigrated: number;
  entriesSkipped: number;
  errors: string[];
}

const MEMORY_FILES = ["memory.public.jsonl", "memory.private.jsonl"] as const;
const FILE_LABEL: Record<string, "public" | "private"> = {
  "memory.public.jsonl": "public",
  "memory.private.jsonl": "private",
};

function parseCliArgs(): { dataDir: string } {
  const args = parseArgs(Deno.args, {
    string: ["data-dir"],
    default: { "data-dir": "./data" },
  });
  return { dataDir: args["data-dir"] };
}

function migrateLine(line: string): { output: string; migrated: boolean } {
  const trimmed = line.trim();
  if (!trimmed) return { output: "", migrated: false };

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed);
  } catch {
    // Preserve malformed lines as-is
    return { output: trimmed, migrated: false };
  }

  if (event.type !== "memory") {
    return { output: trimmed, migrated: false };
  }

  // Idempotency: skip entries that already have the tier field
  if ("tier" in event && event.tier !== undefined) {
    return { output: trimmed, migrated: false };
  }

  const importance = event.importance as string;
  if (importance === "high") {
    event.tier = "core";
    event.decay = 1.0;
  } else {
    // "normal" or any other value defaults to archive
    event.tier = "archive";
    event.decay = 0.5;
  }
  event.category = "fact";
  event.scope = "user";

  return { output: JSON.stringify(event), migrated: true };
}

async function migrateFile(
  filePath: string,
): Promise<{ migrated: number; skipped: number }> {
  const content = await Deno.readTextFile(filePath);
  const lines = content.split("\n");

  let migrated = 0;
  let skipped = 0;
  const outputLines: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      outputLines.push(line);
      continue;
    }
    const result = migrateLine(line);
    outputLines.push(result.output);
    if (result.migrated) migrated++;
    else skipped++;
  }

  // Atomic write: write to temp file then rename
  const tmpPath = filePath + ".tmp";
  await Deno.writeTextFile(tmpPath, outputLines.join("\n"));
  await Deno.rename(tmpPath, filePath);

  return { migrated, skipped };
}

async function createBackup(filePath: string): Promise<void> {
  const backupPath = filePath.replace(/\.jsonl$/, ".backup.jsonl");
  if (await exists(backupPath)) {
    console.log(`  ⏭  Backup already exists: ${backupPath}`);
    return;
  }
  await Deno.copyFile(filePath, backupPath);
  console.log(`  📦 Backup created: ${backupPath}`);
}

async function discoverWorkspaces(dataDir: string): Promise<string[]> {
  const workspacesDir = join(dataDir, "workspaces");
  const workspacePaths: string[] = [];

  if (!(await exists(workspacesDir))) {
    console.error(`Workspaces directory not found: ${workspacesDir}`);
    return [];
  }

  // Enumerate {platform}/{userId} directories
  for await (const platformEntry of Deno.readDir(workspacesDir)) {
    if (!platformEntry.isDirectory) continue;
    const platformDir = join(workspacesDir, platformEntry.name);
    for await (const userEntry of Deno.readDir(platformDir)) {
      if (!userEntry.isDirectory) continue;
      workspacePaths.push(join(platformDir, userEntry.name));
    }
  }

  return workspacePaths;
}

async function rebuildIndex(workspacePath: string): Promise<void> {
  const memoryFiles: Array<{ path: string; file: "public" | "private" | "channel" }> = [];
  for (const fileName of MEMORY_FILES) {
    const filePath = join(workspacePath, fileName);
    if (await exists(filePath)) {
      memoryFiles.push({ path: filePath, file: FILE_LABEL[fileName] });
    }
  }
  // Also include channel file if present
  const channelPath = join(workspacePath, "memory.channel.jsonl");
  if (await exists(channelPath)) {
    memoryFiles.push({ path: channelPath, file: "channel" });
  }

  if (memoryFiles.length === 0) return;

  const index = new MemoryIndex(workspacePath);
  const count = await index.rebuild(memoryFiles);
  console.log(`  🔍 Index rebuilt: ${count} entries`);
}

async function main(): Promise<void> {
  const { dataDir } = parseCliArgs();
  console.log(`\n🚀 Memory v2 migration`);
  console.log(`   Data directory: ${dataDir}\n`);

  const stats: MigrationStats = {
    workspaces: 0,
    files: 0,
    entriesMigrated: 0,
    entriesSkipped: 0,
    errors: [],
  };

  const workspaces = await discoverWorkspaces(dataDir);
  if (workspaces.length === 0) {
    console.log("No workspaces found. Nothing to migrate.");
    return;
  }

  for (const wsPath of workspaces) {
    const relPath = wsPath.replace(dataDir + "/workspaces/", "");
    console.log(`📁 Workspace: ${relPath}`);
    stats.workspaces++;

    for (const fileName of MEMORY_FILES) {
      const filePath = join(wsPath, fileName);
      if (!(await exists(filePath))) continue;

      stats.files++;
      try {
        await createBackup(filePath);
        const result = await migrateFile(filePath);
        stats.entriesMigrated += result.migrated;
        stats.entriesSkipped += result.skipped;
        console.log(
          `  ✅ ${fileName}: ${result.migrated} migrated, ${result.skipped} skipped`,
        );
      } catch (error) {
        const msg = `${relPath}/${fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        stats.errors.push(msg);
        console.error(`  ❌ ${msg}`);
      }
    }

    // Rebuild index after migrating workspace files
    try {
      await rebuildIndex(wsPath);
    } catch (error) {
      const msg = `${relPath}/index: ${error instanceof Error ? error.message : String(error)}`;
      stats.errors.push(msg);
      console.error(`  ❌ Index rebuild failed: ${msg}`);
    }
  }

  // Summary
  console.log(`\n${"─".repeat(50)}`);
  console.log(`📊 Migration Summary`);
  console.log(`   Workspaces processed: ${stats.workspaces}`);
  console.log(`   Files processed:      ${stats.files}`);
  console.log(`   Entries migrated:     ${stats.entriesMigrated}`);
  console.log(`   Entries skipped:      ${stats.entriesSkipped}`);
  if (stats.errors.length > 0) {
    console.log(`   Errors:               ${stats.errors.length}`);
    for (const err of stats.errors) {
      console.log(`     - ${err}`);
    }
  } else {
    console.log(`   Errors:               0`);
  }
  console.log();
}

main();
