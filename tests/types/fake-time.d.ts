// `@std/testing`'s FakeTime implements `[Symbol.dispose]` at run time (its
// bundled declaration file omits it), so `using clock = new FakeTime()` needs
// the instance type completed for `tsc`.
import "@std/testing/time";

declare module "@std/testing/time" {
  interface FakeTime {
    [Symbol.dispose](): void;
  }
}
