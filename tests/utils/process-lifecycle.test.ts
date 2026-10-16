// tests/utils/process-lifecycle.test.ts
//
// Bounded tool-child drain / quiescence evidence (design D2). The observation
// primitives are injected so disappearance, enumeration failure and survivor
// cases are deterministic — no sleep-based races — and one real process tree
// proves the production enumeration (pgrep + /proc) end to end.

import { assert, assertEquals } from "@std/assert";
import { awaitChildQuiescence, type ChildDrainDeps } from "../../src/utils/process-lifecycle.ts";

/** Fake PIDs far above any live process, so /proc lookups never match. */
const WRAPPER = 999_901;
const AGENT = 999_902;
const TOOL = 999_903;

/** A scripted process table: children per pid, alive set, and kill effects. */
function makeTree(options: {
  children: Map<number, number[]>;
  alive: Set<number>;
  /** Remove these PIDs when KILL reaches them (survivors otherwise). */
  killRemoves?: number[];
  /** Fail every `listChildPids` call from this 1-based call number onwards. */
  failEnumerationFromCall?: number;
  /** Report the wrapper as gone from this 1-based `processAlive` call onwards. */
  wrapperGoneFromAliveCall?: number;
  killRemovesOnTerm?: number[];
}): {
  deps: Partial<ChildDrainDeps>;
  killed: { pid: number; signal: "TERM" | "KILL" }[];
  aliveChecks: () => number;
} {
  const killed: { pid: number; signal: "TERM" | "KILL" }[] = [];
  const killRemoves = new Set(options.killRemoves ?? []);
  const killRemovesOnTerm = new Set(options.killRemovesOnTerm ?? []);
  const state = { listCalls: 0, aliveCalls: 0 };
  const deps: Partial<ChildDrainDeps> = {
    processAlive: (pid) => {
      state.aliveCalls++;
      if (
        options.wrapperGoneFromAliveCall !== undefined &&
        state.aliveCalls >= options.wrapperGoneFromAliveCall
      ) {
        options.alive.delete(pid);
      }
      return Promise.resolve(options.alive.has(pid));
    },
    listChildPids: (pid) => {
      state.listCalls++;
      if (
        options.failEnumerationFromCall !== undefined &&
        state.listCalls >= options.failEnumerationFromCall
      ) {
        return Promise.resolve({ ok: false, pids: [] });
      }
      return Promise.resolve({ ok: true, pids: options.children.get(pid) ?? [] });
    },
    killPids: (pids, signal) => {
      for (const pid of pids) {
        killed.push({ pid, signal });
        const removes = signal === "KILL" ? killRemoves.has(pid) : killRemovesOnTerm.has(pid);
        if (!removes) continue;
        // A signalled child disappears from its parent's child list too: the
        // enumeration must observe the removal, not just the alive set.
        options.alive.delete(pid);
        for (const [parent, children] of options.children) {
          options.children.set(parent, children.filter((child) => child !== pid));
        }
      }
      return Promise.resolve();
    },
    // Instant sleeps: the drain still exercises its bounded loops, but the test
    // never waits on wall-clock time for state it controls directly.
    sleep: () => Promise.resolve(),
  };
  return { deps, killed, aliveChecks: () => state.aliveCalls };
}

/** Short bounds so the bounded loops stay fast under instant sleeps. */
const FAST = { drainTimeoutMs: 5, killWindowMs: 5 } as const;

/** A wrapper whose only child is the long-lived agent: nothing to drain. */
Deno.test("awaitChildQuiescence - an agent-only wrapper is quiescent without signalling it", async () => {
  const tree = makeTree({
    children: new Map([[WRAPPER, [AGENT]]]),
    alive: new Set([WRAPPER, AGENT]),
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "quiescent", drained: "drained" });
  assertEquals(tree.killed.length, 0);
});

/** No children at all is the one observation reported as `no-child`. */
Deno.test("awaitChildQuiescence - a childless wrapper is quiescent", async () => {
  const tree = makeTree({
    children: new Map(),
    alive: new Set([WRAPPER]),
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "quiescent", drained: "no-child" });
});

Deno.test("awaitChildQuiescence - a tool child that exits on its own is drained", async () => {
  const children = new Map([[WRAPPER, [AGENT, TOOL]]]);
  const tree = makeTree({
    children,
    alive: new Set([WRAPPER, AGENT, TOOL]),
  });
  // The tool child exits after the first snapshot is taken.
  const originalList = tree.deps.listChildPids!;
  let calls = 0;
  tree.deps.listChildPids = (pid) => {
    calls++;
    if (calls > 1) children.set(WRAPPER, [AGENT]);
    return originalList(pid);
  };

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "quiescent", drained: "drained" });
  // The agent is never a drain target.
  assert(!tree.killed.some((k) => k.pid === AGENT), "the agent must never be signalled");
});

Deno.test("awaitChildQuiescence - only a surviving tool child is TERM/KILLed, then observed empty", async () => {
  const alive = new Set([WRAPPER, AGENT, TOOL]);
  const tree = makeTree({
    children: new Map([[WRAPPER, [AGENT, TOOL]]]),
    alive,
    killRemoves: [TOOL],
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "quiescent", drained: "terminated" });
  assertEquals(tree.killed, [{ pid: TOOL, signal: "TERM" }, { pid: TOOL, signal: "KILL" }]);
  assert(alive.has(AGENT), "the long-lived agent is untouched");
});

Deno.test("awaitChildQuiescence - a tool child surviving termination is uncertain", async () => {
  const tree = makeTree({
    children: new Map([[WRAPPER, [AGENT, TOOL]]]),
    alive: new Set([WRAPPER, AGENT, TOOL]),
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "uncertain", reason: "survivors-remain" });
});

Deno.test("awaitChildQuiescence - an observable-then-gone wrapper is uncertain", async () => {
  const tree = makeTree({
    children: new Map([[WRAPPER, [AGENT, TOOL]]]),
    alive: new Set([WRAPPER, AGENT, TOOL]),
    // Alive for the initial check, gone from the first in-loop check onwards.
    wrapperGoneFromAliveCall: 2,
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "uncertain", reason: "wrapper-not-observable" });
});

Deno.test("awaitChildQuiescence - an unobservable wrapper is uncertain, not drained", async () => {
  const tree = makeTree({
    children: new Map(),
    alive: new Set([AGENT]),
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "uncertain", reason: "wrapper-not-observable" });
});

Deno.test("awaitChildQuiescence - an emptied child list is not trusted once the wrapper vanished", async () => {
  // The wrapper was alive for the initial check, then exited before the
  // enumeration returned "no children": its children re-parented away, so the
  // empty list proves nothing and must never be reported as quiescent.
  const tree = makeTree({
    children: new Map(),
    alive: new Set([WRAPPER]),
    wrapperGoneFromAliveCall: 2,
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "uncertain", reason: "wrapper-not-observable" });
});

Deno.test("awaitChildQuiescence - an emptied tool tree is not trusted once the wrapper vanished", async () => {
  // The wrapper's only remaining child is the agent (the tool already exited),
  // so the tool tree enumerates empty — but the wrapper disappeared while that
  // snapshot was taken, so it is uncertain, not drained.
  const tree = makeTree({
    children: new Map([[WRAPPER, [AGENT]]]),
    alive: new Set([WRAPPER, AGENT]),
    wrapperGoneFromAliveCall: 2,
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "uncertain", reason: "wrapper-not-observable" });
});

/** A live wrapper with one agent and one tool child, plus mutable drives for the two child phases. */
function makeToolTree(): {
  tree: ReturnType<typeof makeTree>;
  children: Map<number, number[]>;
  alive: Set<number>;
} {
  const children = new Map([[WRAPPER, [AGENT, TOOL]]]);
  const alive = new Set([WRAPPER, AGENT, TOOL]);
  return { tree: makeTree({ children, alive }), children, alive };
}

Deno.test("awaitChildQuiescence - a wrapper vanishing during the kill-loop snapshot is uncertain", async () => {
  const { tree, alive } = makeToolTree();
  const originalKill = tree.deps.killPids!;
  const originalList = tree.deps.listChildPids!;
  let terminated = false;
  tree.deps.killPids = (pids, signal) => {
    if (signal === "TERM") terminated = true;
    return originalKill(pids, signal);
  };
  // After the TERM the tools AND the wrapper disappear while the drain is
  // enumerating, so the empty snapshot that follows proves nothing.
  tree.deps.listChildPids = (pid) => {
    if (terminated && pid === WRAPPER) {
      alive.delete(WRAPPER);
      return Promise.resolve({ ok: true, pids: [] });
    }
    return originalList(pid);
  };

  // drainTimeoutMs 0 skips the drain loop, so the kill loop takes the snapshot.
  const verdict = await awaitChildQuiescence(WRAPPER, {
    drainTimeoutMs: 0,
    killWindowMs: 50,
    deps: tree.deps,
  });

  assertEquals(verdict, { status: "uncertain", reason: "wrapper-not-observable" });
});

Deno.test("awaitChildQuiescence - a wrapper vanishing at the first final observation is uncertain", async () => {
  const { tree, alive } = makeToolTree();
  const originalKill = tree.deps.killPids!;
  const originalList = tree.deps.listChildPids!;
  let finalEnumerations = 0;
  tree.deps.killPids = (pids, signal) => {
    if (signal === "TERM") finalEnumerations = 0; // the post-termination phase starts here
    return originalKill(pids, signal);
  };
  tree.deps.listChildPids = (pid) => {
    if (pid !== WRAPPER) return originalList(pid);
    if (++finalEnumerations === 1) {
      alive.delete(WRAPPER);
      return Promise.resolve({ ok: true, pids: [] });
    }
    return originalList(pid);
  };

  // Both loops are skipped (0 waits), so the FIRST final observation is the one
  // taken while the wrapper disappears.
  const verdict = await awaitChildQuiescence(WRAPPER, {
    drainTimeoutMs: 0,
    killWindowMs: 0,
    deps: tree.deps,
  });

  assertEquals(verdict, { status: "uncertain", reason: "wrapper-not-observable" });
});

Deno.test("awaitChildQuiescence - a wrapper vanishing at the second final observation is uncertain", async () => {
  const { tree, alive } = makeToolTree();
  const originalKill = tree.deps.killPids!;
  const originalList = tree.deps.listChildPids!;
  let finalEnumerations = 0;
  tree.deps.killPids = (pids, signal) => {
    if (signal === "TERM") finalEnumerations = 0;
    return originalKill(pids, signal);
  };
  tree.deps.listChildPids = (pid) => {
    if (pid !== WRAPPER) return originalList(pid);
    // First final observation still sees the surviving tool (a KILL follows);
    // the second one runs while the wrapper disappears.
    if (++finalEnumerations === 1) return originalList(pid);
    alive.delete(WRAPPER);
    return Promise.resolve({ ok: true, pids: [] });
  };

  const verdict = await awaitChildQuiescence(WRAPPER, {
    drainTimeoutMs: 0,
    killWindowMs: 0,
    deps: tree.deps,
  });

  assertEquals(verdict, { status: "uncertain", reason: "wrapper-not-observable" });
});

Deno.test("awaitChildQuiescence - failed enumeration at any level is uncertain", async () => {
  const tree = makeTree({
    children: new Map([[WRAPPER, [AGENT, TOOL]]]),
    alive: new Set([WRAPPER, AGENT, TOOL]),
    // Call 1 = the wrapper's direct children; call 2 = the tool-tree walk.
    failEnumerationFromCall: 2,
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "uncertain", reason: "enumeration-failed" });
});

Deno.test("awaitChildQuiescence - descendant-enumeration failure is uncertain", async () => {
  const tree = makeTree({
    children: new Map([[WRAPPER, [AGENT]], [AGENT, [TOOL]]]),
    alive: new Set([WRAPPER, AGENT, TOOL]),
    // Call 1 = wrapper children, call 2 = agent children, call 3 = the failing
    // walk of the agent's own descendant subtree.
    failEnumerationFromCall: 3,
  });

  const verdict = await awaitChildQuiescence(WRAPPER, { ...FAST, deps: tree.deps });

  assertEquals(verdict, { status: "uncertain", reason: "enumeration-failed" });
});

Deno.test("awaitChildQuiescence - real process tree: agent child excluded, tool child waited for", async () => {
  // Wrapper = this shell; its OLDEST child is a long-lived "agent", and the
  // younger child is the tool that exits shortly after — the production
  // pgrep + /proc enumeration must resolve both and drain only the tool.
  const wrapper = new Deno.Command("sh", {
    args: ["-c", "sleep 2 & sleep 0.6; wait"],
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    // Child-ready handshake: the production enumeration needs BOTH children to
    // exist before the drain starts, otherwise the test would prove nothing
    // about how the pair is resolved. The kernel's own answer is the barrier.
    await waitForDirectChildren(wrapper.pid, 2);
    const verdict = await awaitChildQuiescence(wrapper.pid, {
      drainTimeoutMs: 3_000,
      killWindowMs: 1_000,
    });
    assertEquals(verdict, { status: "quiescent", drained: "drained" });
  } finally {
    try {
      wrapper.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    await wrapper.status;
  }
});

/**
 * Bounded readiness barrier: wait until `pid` has at least `expected` children.
 * A real delay is unavoidable here (the sanctioned exception): deterministic
 * time control cannot make a spawned kernel process observable, so this polls
 * the kernel's own answer with a bounded deadline instead of guessing a sleep.
 */
async function waitForDirectChildren(pid: number, expected: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const out = await new Deno.Command("pgrep", { args: ["-P", String(pid)] }).output();
    const count = new TextDecoder()
      .decode(out.stdout)
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "").length;
    if (out.success && count >= expected) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await promise;
  }
  throw new Error(`wrapper ${pid} never reached ${expected} direct children`);
}
