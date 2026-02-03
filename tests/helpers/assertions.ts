// tests/helpers/assertions.ts

import { assert, assertEquals, assertExists } from "@std/assert";

/**
 * Assert that an array contains an item matching the predicate
 */
export function assertContains<T>(
  array: T[],
  predicate: (item: T) => boolean,
  message?: string,
): void {
  const found = array.find(predicate);
  assertExists(found, message ?? "Array does not contain matching item");
}

/**
 * Assert that a function throws an error with specific message
 */
export async function assertThrowsWithMessage(
  fn: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await fn();
    assert(false, "Expected function to throw");
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(expectedMessage),
      `Expected error message to contain "${expectedMessage}", got "${error}"`,
    );
  }
}

/**
 * Assert that a reply was sent with specific content
 */
export function assertReplySent(
  sentReplies: { content: string }[],
  expectedContent: string,
): void {
  const found = sentReplies.find((r) => r.content.includes(expectedContent));
  assertExists(
    found,
    `Expected reply containing "${expectedContent}" but got: ${JSON.stringify(sentReplies)}`,
  );
}

/**
 * Assert approximate equality for timing tests
 */
export function assertApproximatelyEqual(
  actual: number,
  expected: number,
  tolerance: number,
  message?: string,
): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    message ?? `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}
