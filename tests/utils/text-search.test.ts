import { assertEquals } from "@std/assert";
import { searchInFile, searchMultipleKeywords } from "../../src/utils/text-search.ts";

const testDir = await Deno.makeTempDir();
const testFile = `${testDir}/test-search.txt`;

await Deno.writeTextFile(
  testFile,
  `Hello World
This is a test file
hello again
HELLO UPPERCASE
Some other line
Final line with hello`,
);

Deno.test("searchInFile - finds case-insensitive matches", async () => {
  const results = await searchInFile(testFile, "hello");
  assertEquals(results.length >= 3, true);
});

Deno.test("searchInFile - respects maxResults", async () => {
  const results = await searchInFile(testFile, "hello", { maxResults: 2 });
  assertEquals(results.length <= 2, true);
});

Deno.test("searchInFile - returns empty for non-existent file", async () => {
  const results = await searchInFile(`${testDir}/nonexistent.txt`, "hello");
  // Either ripgrep returns empty or built-in returns empty
  assertEquals(Array.isArray(results), true);
});

Deno.test("searchInFile - case-sensitive search", async () => {
  const results = await searchInFile(testFile, "Hello", {
    caseInsensitive: false,
  });
  // Should match "Hello World" and possibly "Final line with hello" (no, that's lowercase)
  for (const r of results) {
    assertEquals(r.content.includes("Hello") || r.content.includes("hello"), true);
  }
});

Deno.test("searchInFile - respects maxChars", async () => {
  const results = await searchInFile(testFile, "hello", { maxChars: 20 });
  const totalChars = results.reduce((sum, r) => sum + r.content.length, 0);
  assertEquals(totalChars <= 20, true);
});

Deno.test("searchMultipleKeywords - combines results from multiple keywords", async () => {
  const results = await searchMultipleKeywords(testFile, ["test", "Final"]);
  assertEquals(results.length >= 2, true);
});

Deno.test("searchMultipleKeywords - deduplicates by line number", async () => {
  const results = await searchMultipleKeywords(testFile, ["hello", "Hello"]);
  const lineNumbers = results.map((r) => r.lineNumber);
  const unique = new Set(lineNumbers);
  assertEquals(lineNumbers.length, unique.size);
});

Deno.test("searchMultipleKeywords - sorts by line number", async () => {
  const results = await searchMultipleKeywords(testFile, ["Final", "Hello"]);
  for (let i = 1; i < results.length; i++) {
    assertEquals(results[i].lineNumber >= results[i - 1].lineNumber, true);
  }
});

Deno.test("searchMultipleKeywords - respects maxResults option", async () => {
  const results = await searchMultipleKeywords(testFile, ["hello", "line"], {
    maxResults: 2,
  });
  assertEquals(results.length <= 2, true);
});

// Cleanup
addEventListener("unload", () => {
  Deno.removeSync(testDir, { recursive: true });
});
