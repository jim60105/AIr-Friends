// tests/core/base-scheduler.test.ts

import { assertEquals } from "@std/assert";
import { BaseScheduler } from "@core/base-scheduler.ts";

/** Concrete test implementation of BaseScheduler */
class TestScheduler extends BaseScheduler {
  public enabled = true;
  public delayMs = 100;
  public maxInterval = 100;
  public stateKey = "test";
  public callCount = 0;
  public shouldThrow = false;
  public onStartedCalled = false;
  public onFirstStartCalled = false;
  public callbackFn: (() => Promise<void>) | null = null;

  protected isEnabled(): boolean {
    return this.enabled;
  }

  protected getNextDelayMs(): number {
    return this.delayMs;
  }

  protected getMaxIntervalMs(): number {
    return this.maxInterval;
  }

  protected getStateKey(): string {
    return this.stateKey;
  }

  protected async executeCallback(): Promise<void> {
    this.callCount++;
    if (this.shouldThrow) {
      throw new Error("test error");
    }
    if (this.callbackFn) {
      await this.callbackFn();
    }
  }

  protected override onStarted(): void {
    this.onStartedCalled = true;
  }

  protected override onFirstStart(): void {
    this.onFirstStartCalled = true;
    super.onFirstStart();
  }

  // Expose protected members for testing
  get _started(): boolean {
    return this.started;
  }
  get _isRunning(): boolean {
    return this.isRunning;
  }
  get _timerId(): number | null {
    return this.timerId;
  }
}

Deno.test("BaseScheduler - start sets started flag and calls onStarted", () => {
  const scheduler = new TestScheduler();
  scheduler.delayMs = 999999;
  scheduler.start();
  assertEquals(scheduler._started, true);
  assertEquals(scheduler.onStartedCalled, true);
  assertEquals(scheduler.onFirstStartCalled, true);
  scheduler.stop();
});

Deno.test("BaseScheduler - start when disabled does nothing", () => {
  const scheduler = new TestScheduler();
  scheduler.enabled = false;
  scheduler.start();
  assertEquals(scheduler._started, false);
  assertEquals(scheduler.onStartedCalled, false);
});

Deno.test("BaseScheduler - double start is prevented", () => {
  const scheduler = new TestScheduler();
  scheduler.delayMs = 999999;
  scheduler.start();
  scheduler.onStartedCalled = false;
  scheduler.start(); // Should warn and return
  assertEquals(scheduler.onStartedCalled, false);
  scheduler.stop();
});

Deno.test("BaseScheduler - stop clears timer and resets state", () => {
  const scheduler = new TestScheduler();
  scheduler.delayMs = 999999;
  scheduler.start();
  assertEquals(scheduler._started, true);
  scheduler.stop();
  assertEquals(scheduler._started, false);
  assertEquals(scheduler._timerId, null);
  assertEquals(scheduler.getStatus().nextScheduledAt, null);
});

Deno.test("BaseScheduler - getStatus returns correct values", () => {
  const scheduler = new TestScheduler();
  const status = scheduler.getStatus();
  assertEquals(status.isRunning, false);
  assertEquals(status.lastExecutedAt, null);
  assertEquals(status.nextScheduledAt, null);
});

Deno.test("BaseScheduler - execute runs callback and records lastExecutedAt", async () => {
  const scheduler = new TestScheduler();
  scheduler.delayMs = 10;
  scheduler.start();

  // Wait for execution
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(scheduler.callCount >= 1, true);
  assertEquals(scheduler.getStatus().lastExecutedAt !== null, true);
  scheduler.stop();
});

Deno.test("BaseScheduler - execute handles callback errors gracefully", async () => {
  const scheduler = new TestScheduler();
  scheduler.delayMs = 10;
  scheduler.shouldThrow = true;
  scheduler.start();

  // Wait for execution — should not crash
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(scheduler.callCount >= 1, true);
  // lastExecutedAt should be null since callback threw
  assertEquals(scheduler.getStatus().lastExecutedAt, null);
  assertEquals(scheduler._isRunning, false);
  scheduler.stop();
});

Deno.test("BaseScheduler - concurrency guard skips overlapping execution", async () => {
  const scheduler = new TestScheduler();
  scheduler.delayMs = 20;

  let resolveBlock: (() => void) | undefined = undefined;
  scheduler.callbackFn = () =>
    new Promise<void>((resolve) => {
      resolveBlock = resolve;
    });

  scheduler.start();

  // Wait for first execution to start
  await new Promise((resolve) => setTimeout(resolve, 40));
  assertEquals(scheduler.callCount, 1);

  // Unblock
  resolveBlock!();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(scheduler._isRunning, false);
  scheduler.stop();
});

Deno.test("BaseScheduler - start with restored state uses resolveScheduleTime", async () => {
  const scheduler = new TestScheduler();
  scheduler.delayMs = 10;
  scheduler.maxInterval = 100000;

  // Restored state with past due time → should execute immediately
  const pastDue = new Date(Date.now() - 10000).toISOString();
  scheduler.start({ test: pastDue });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(scheduler.callCount >= 1, true);
  // onFirstStart should NOT be called when restored state is used
  assertEquals(scheduler.onFirstStartCalled, false);
  scheduler.stop();
});

Deno.test("BaseScheduler - state persistence via stateStore", async () => {
  const savedEntries: { key: string; nextAt: Date }[] = [];
  const mockStore = {
    load: () => Promise.resolve({}),
    save: (key: string, nextAt: Date) => {
      savedEntries.push({ key, nextAt });
      return Promise.resolve();
    },
    remove: () => Promise.resolve(),
  };

  const scheduler = new TestScheduler();
  scheduler.delayMs = 10;
  scheduler.setStateStore(
    mockStore as unknown as import("@core/scheduler-state-store.ts").SchedulerStateStore,
  );
  scheduler.start();

  // Wait for at least one execution + reschedule
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(savedEntries.length >= 1, true);
  assertEquals(savedEntries[0].key, "test");
  scheduler.stop();
});
