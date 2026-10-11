#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write
// Test fixture helper (NOT production code): the 3.5 auth-failure scenario
// spawns this as the FIRST invocation of its scripted step, mid-run, so the
// SUBJECT session's credential file is poisoned with a validly-signed token
// bound to a DIFFERENT session before the scripted send-reply runs. The
// rejection under test is the REAL Skill API server's JWT binding check
// (`sub == sessionId`), so the vector must exist inside the live run — this
// helper is the only moving part the harness needs.
//
// Identity resolution mirrors the client's own sources, read-only except for
// the single overwritten credential file:
//   - pooled/shared shape: {SKILL_JWT_DIR}/active.json pointer (sole source)
//   - per-spawn shape: the unique {id}.jwt filename inside SKILL_JWT_DIR
//
// Input: FORGED_CRED_FILE env var — path of the file whose content replaces
// {SKILL_JWT_DIR}/{subject}.jwt. Prints the resolved subject id.

const jwtDir = Deno.env.get("SKILL_JWT_DIR");
const forgedFile = Deno.env.get("FORGED_CRED_FILE");
if (!jwtDir || !forgedFile) {
  console.error("skill-credential-swap: SKILL_JWT_DIR and FORGED_CRED_FILE are required");
  Deno.exit(2);
}

let subjectId: string | undefined;
try {
  const pointer = JSON.parse(Deno.readTextFileSync(`${jwtDir}/active.json`)) as {
    sessionId?: unknown;
  };
  if (typeof pointer.sessionId === "string" && pointer.sessionId.length > 0) {
    subjectId = pointer.sessionId;
  }
} catch {
  // No pointer (per-spawn shape): fall through to the unique credential file.
}
if (!subjectId) {
  const ids: string[] = [];
  for (const entry of Deno.readDirSync(jwtDir)) {
    if (entry.isFile && entry.name.endsWith(".jwt")) ids.push(entry.name.slice(0, -4));
  }
  if (ids.length === 1) subjectId = ids[0];
}
if (!subjectId) {
  console.error(
    "skill-credential-swap: subject session id unresolvable (no pointer, no unique jwt)",
  );
  Deno.exit(2);
}

Deno.writeTextFileSync(`${jwtDir}/${subjectId}.jwt`, Deno.readTextFileSync(forgedFile));
console.log(subjectId);
