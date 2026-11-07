export type Arch = "x86_64" | "aarch64";
export type SuiteName =
  | "process"
  | "acp"
  | "acp-failure"
  | "ffi"
  | "ffi-enosys"
  | "egress"
  | "injection"
  | "injection-noconfig";
export type P0Id =
  | "P0-1"
  | "P0-2"
  | "P0-3"
  | "P0-4"
  | "P0-5"
  | "P0-6"
  | "P0-7"
  | "P0-8"
  | "P0-9"
  | "P0-10";

export interface Criterion {
  id: string;
  p0: P0Id;
  suite: SuiteName;
  archs: readonly Arch[];
  check: string;
  minTests: number; // the fewest passing tests that prove this criterion
}

export interface Deferral {
  p0: P0Id;
  scope: string;
  owner: string;
}

export const ARCHS: readonly Arch[] = ["x86_64", "aarch64"];
export const SUITES: readonly SuiteName[] = [
  "process",
  "acp",
  "acp-failure",
  "ffi",
  "ffi-enosys",
  "egress",
  "injection",
  "injection-noconfig",
];

/** The P0 release blockers, in the order of design section 9. */
export const P0_BLOCKERS: Record<P0Id, string> = {
  "P0-1": "child environments",
  "P0-2": "ACP transport",
  "P0-3": "process cleanup",
  "P0-4": "openat2/statx",
  "P0-5": "egress proxy",
  "P0-6": "injection suite",
  "P0-7": "sandbox detection",
  "P0-8": "restart persistence",
  "P0-9": "native dependencies",
  "P0-10": "CI and rollback",
};

export const P0_IDS = Object.keys(P0_BLOCKERS) as P0Id[];

function processCriterion(id: string, p0: P0Id, check: string): Criterion {
  return { id, p0, suite: "process", archs: ["x86_64"], check, minTests: 1 };
}

function acpCriteria(n: string, p0: P0Id, suite: SuiteName, check: string): Criterion[] {
  return ["OC", "OMP"].map((agent) => ({
    id: `ACP-${n}-${agent}`,
    p0,
    suite,
    archs: ["x86_64"],
    check,
    minTests: 1,
  }));
}

function ffiCriteria(n: string, suite: SuiteName, check: string, minTests = 1): Criterion {
  return { id: `FFI-${n}`, p0: "P0-4", suite, archs: ["x86_64", "aarch64"], check, minTests };
}

function egressCriterion(n: string, check: string, minTests = 1): Criterion {
  return { id: `EGR-${n}`, p0: "P0-5", suite: "egress", archs: ["x86_64"], check, minTests };
}

function injectionCriterion(n: string, suite: SuiteName, check: string): Criterion {
  return { id: `INJ-${n}`, p0: "P0-6", suite, archs: ["x86_64"], check, minTests: 1 };
}

export const CRITERIA: readonly Criterion[] = [
  processCriterion(
    "PROC-01",
    "P0-2",
    "With the consumer stalled for 1 s, a producer child stops advancing and parent RSS grows under 32 MiB",
  ),
  processCriterion(
    "PROC-02",
    "P0-2",
    "A write to a child that does not read stays pending, then completes after the child starts reading",
  ),
  processCriterion("PROC-03", "P0-2", "64 MiB through `cat` returns byte-identical by SHA-256"),
  processCriterion(
    "PROC-04",
    "P0-2",
    "A child writing 8 MiB to stderr while writing stdout finishes with both streams fully read",
  ),
  processCriterion(
    "PROC-05",
    "P0-2",
    "Closing stdin ends `cat`, stdout reaches done, and `exited` reports code 0",
  ),
  processCriterion(
    "PROC-06",
    "P0-1",
    "The child's real environment holds exactly the passed variables and no parent sentinel",
  ),
  processCriterion(
    "PROC-07",
    "P0-3",
    "SIGTERM through `dumb-init` ends the child, `exited` resolves, and no descendant remains",
  ),
  processCriterion(
    "PROC-08",
    "P0-3",
    "With a child ignoring SIGTERM, SIGKILL follows the 2000 ms grace timer and the wrapper's exit is observed by 2500 ms",
  ),
  processCriterion(
    "PROC-09",
    "P0-3",
    "After 20 spawn and teardown cycles the open descriptor count is within 2 of the start and no descendant remains",
  ),
  ...acpCriteria(
    "01",
    "P0-2",
    "acp",
    "Handshake, session and prompt complete with stop reason `end_turn` and the scripted text",
  ),
  ...acpCriteria("02", "P0-2", "acp", "16 MiB of agent output arrives byte-identical by SHA-256"),
  ...acpCriteria("03", "P0-2", "acp", "A 1 MiB prompt reaches the provider intact"),
  ...acpCriteria(
    "04",
    "P0-2",
    "acp-failure",
    "With a 3 s consumer stall, 4 MiB of agent output arrives byte-identical by SHA-256",
  ),
  ...acpCriteria(
    "05",
    "P0-2",
    "acp-failure",
    "`session/cancel` during streaming ends the prompt with stop reason `cancelled` within 5 s",
  ),
  ...acpCriteria(
    "06",
    "P0-2",
    "acp-failure",
    "With a stalled provider, a 3 s client timeout rejects the call and teardown completes",
  ),
  ...acpCriteria(
    "07",
    "P0-2",
    "acp-failure",
    "SIGKILL of the agent during streaming rejects the pending prompt within 3 s and `exited` resolves",
  ),
  ...acpCriteria(
    "08",
    "P0-2",
    "acp-failure",
    "After teardown stdout reaches done and the ACP connection closes within 5 s",
  ),
  ...acpCriteria(
    "09",
    "P0-1",
    "acp",
    "The real agent environment holds the required variables and no parent sentinel",
  ),
  ...acpCriteria("10", "P0-3", "acp", "SIGTERM teardown of the real agent leaves no descendant"),
  ffiCriteria("01", "ffi", "A symlink component yields `ELOOP` and the failure reason `unsafe_traversal`"),
  ffiCriteria("02", "ffi", "A directory escape yields `EXDEV` and the failure reason `outside_roots`"),
  ffiCriteria("03", "ffi", "A missing target yields `ENOENT` and the production failure reason for its phase"),
  ffiCriteria("04", "ffi", "10,000 alternating failures with event-loop yields produce no errno mismatch"),
  ffiCriteria("05", "ffi", "`statx` type, inode and device agree with `node:fs` for a file and a directory"),
  ffiCriteria(
    "06",
    "ffi",
    "Read, exclusive create and overwrite round trip real files through `performLinuxSecureAccess`",
    3,
  ),
  ffiCriteria("07", "ffi", "An absent or unloadable libc fails closed with `secure_access_unavailable`"),
  ffiCriteria("08", "ffi-enosys", "`ENOSYS` from `openat2` fails closed with `secure_access_unavailable`"),
  ffiCriteria("09", "ffi", "1,000 mixed operations leave the open descriptor count unchanged"),
  egressCriterion("01", "A and AAAA answers are both consulted and any disallowed answer denies"),
  egressCriterion("02", "Metadata addresses stay blocked, including for an allowlisted host"),
  egressCriterion("03", "The upstream connection uses the validated IP with no second resolution"),
  egressCriterion("04", "A CONNECT tunnel carries 32 MiB each way byte-identical by SHA-256"),
  egressCriterion(
    "05",
    "A half-close is forwarded, the opposite direction keeps working until it ends, and a peer failure tears down both sides",
    3,
  ),
  egressCriterion(
    "06",
    "Plain HTTP is rewritten to origin form with `Connection: close`, and a pipelined second request is not answered",
  ),
  egressCriterion("07", "Allowlist exemption, neighbor rejection and malformed-entry rules hold"),
  egressCriterion("08", "Refused, malformed and unreachable targets return 403, 400 and 502"),
  injectionCriterion(
    "01",
    "injection",
    "`.env` and `.env.local` in the working directory change nothing, in both invocation forms",
  ),
  injectionCriterion(
    "02",
    "injection",
    "`bunfig.toml` in the working directory changes nothing, in both invocation forms",
  ),
  injectionCriterion(
    "03",
    "injection",
    "`tsconfig.json`, `package.json`, `node_modules` and a symlinked script spelling in the working directory change nothing, in both invocation forms",
  ),
  injectionCriterion("04", "injection", "The approval grammar denies a `BUN_OPTIONS` command prefix"),
  injectionCriterion(
    "05",
    "injection",
    "The approval grammar accepts exactly the two invocation forms and denies every other flag",
  ),
  injectionCriterion("06", "injection", "`/opt/air/skill-bunfig.toml` is empty, root-owned and read-only"),
  injectionCriterion(
    "07",
    "injection",
    "A `.bunfig.toml` in `$HOME` or `$XDG_CONFIG_HOME` changes nothing, in both invocation forms",
  ),
  injectionCriterion(
    "08",
    "injection-noconfig",
    "With the config file missing, neither the skill nor the attacker preload runs; if Bun itself does not stop, the launcher stops the direct form and the literal form is reported",
  ),
];

/** P0 scope this gate does not reach; it stays open after a Go. */
export const DEFERRALS: readonly Deferral[] = [
  {
    p0: "P0-1",
    scope:
      "Production variable set (skill token directory, provider keys); the suites prove only `PATH` and `HOME` as required variables",
    owner: "Step 5",
  },
  {
    p0: "P0-3",
    scope: "Container stop, pool cleanup, restart, and children that outlive a wrapper SIGKILL",
    owner: "Step 5 and step 8",
  },
  { p0: "P0-7", scope: "All of sandbox detection and fail-closed behavior", owner: "Steps 5 to 7" },
  { p0: "P0-8", scope: "All of restart persistence", owner: "Step 8" },
  { p0: "P0-9", scope: "All of native dependencies and external tools", owner: "Steps 3 and 7" },
  { p0: "P0-10", scope: "All of CI, container deployment and the rollback drill", owner: "Steps 7 and 8" },
];
