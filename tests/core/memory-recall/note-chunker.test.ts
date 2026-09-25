// tests/core/memory-recall/note-chunker.test.ts

import { assert, assertEquals } from "@std/assert";
import { buildExcerpt, parseNote } from "@core/memory-recall/note-chunker.ts";

Deno.test("parseNote - chunks at level-2 and level-3 headings and keeps the heading path", () => {
  const content = [
    "# Guide",
    "",
    "Intro line.",
    "",
    "## First",
    "first body",
    "",
    "### Deep",
    "deep body",
    "",
    "## Second",
    "second body",
  ].join("\n");

  const note = parseNote(content, "/ws/notes/guide.md");

  assertEquals(note.title, "Guide");
  assertEquals(note.chunks, [
    {
      headingPath: ["Guide"],
      lineStart: 1,
      lineEnd: 3,
      text: "# Guide\n\nIntro line.",
    },
    {
      headingPath: ["Guide", "First"],
      lineStart: 5,
      lineEnd: 6,
      text: "## First\nfirst body",
    },
    {
      headingPath: ["Guide", "First", "Deep"],
      lineStart: 8,
      lineEnd: 9,
      text: "### Deep\ndeep body",
    },
    {
      headingPath: ["Guide", "Second"],
      lineStart: 11,
      lineEnd: 12,
      text: "## Second\nsecond body",
    },
  ]);
});

Deno.test("parseNote - a heading inside a fenced code block does not split the chunk", () => {
  const content = [
    "## Code",
    "text before",
    "```bash",
    "# not a heading",
    "## also not",
    "```",
    "text after",
  ].join("\n");

  const note = parseNote(content, "/ws/notes/code.md");

  assertEquals(note.chunks.length, 1);
  assertEquals(note.chunks[0].headingPath, ["Code"]);
  assertEquals(note.chunks[0].lineStart, 1);
  assertEquals(note.chunks[0].lineEnd, 7);
  assertEquals(note.chunks[0].text, content);
});

Deno.test("parseNote - a heading-less note is one chunk titled by its file name", () => {
  const note = parseNote("just text\nmore text\n", "/ws/journal/2026-09-20.md");

  assertEquals(note.title, "2026-09-20");
  assertEquals(note.chunks, [
    {
      headingPath: ["2026-09-20"],
      lineStart: 1,
      lineEnd: 2,
      text: "just text\nmore text",
    },
  ]);
});

Deno.test("parseNote - a note that starts with a level-2 heading has no intro chunk", () => {
  const note = parseNote("## Only\ntext", "/ws/notes/only.md");

  assertEquals(note.title, "only");
  assertEquals(note.chunks, [
    { headingPath: ["Only"], lineStart: 1, lineEnd: 2, text: "## Only\ntext" },
  ]);
});

Deno.test("parseNote - a chunk longer than 600 characters splits at blank lines", () => {
  const paragraphs = ["a".repeat(300), "b".repeat(300), "c".repeat(300)];
  const content = ["## Long", paragraphs[0], "", paragraphs[1], "", paragraphs[2]].join("\n");

  const note = parseNote(content, "/ws/notes/long.md");

  // The heading and the first paragraph fit one part; each following paragraph
  // would push its part past 600 characters, so it starts a new one.
  assertEquals(
    note.chunks.map((chunk) => [chunk.lineStart, chunk.lineEnd]),
    [[1, 2], [4, 4], [6, 6]],
  );
  for (const chunk of note.chunks) {
    assertEquals(chunk.headingPath, ["Long"]);
    assert(chunk.text.length <= 600, `chunk is ${chunk.text.length} characters`);
  }
});

Deno.test("parseNote - a paragraph longer than 600 characters stands alone", () => {
  const content = "x".repeat(700);

  const note = parseNote(content, "/ws/notes/huge.md");

  assertEquals(note.chunks.length, 1);
  assertEquals(note.chunks[0].text, content);
});

Deno.test("buildExcerpt - picks the sentence with the most distinct matched terms", () => {
  const text = "Alpha beta。Gamma delta epsilon.";

  assertEquals(buildExcerpt(text, ["gamma", "delta"], 320), "Gamma delta epsilon.");
});

Deno.test("buildExcerpt - a tie goes to the earliest sentence", () => {
  const text = "one alpha。two alpha。";

  // The limit leaves room for the first sentence only, so the tie is visible.
  assertEquals(buildExcerpt(text, ["alpha"], 12), "one alpha。");
});

Deno.test("buildExcerpt - appends the following sentences while under the limit", () => {
  const text = "First alpha。Second beta。Third gamma。";

  assertEquals(
    buildExcerpt(text, ["alpha"], 320),
    "First alpha。 Second beta。 Third gamma。",
  );
});

Deno.test("buildExcerpt - cuts around the first matched term and marks both ends", () => {
  const text = `${"x".repeat(200)} Portaly ${"y".repeat(200)}`;

  const excerpt = buildExcerpt(text, ["portaly"], 100);

  assert(excerpt.includes("Portaly"), `excerpt lost the matched term: ${excerpt}`);
  assert(excerpt.startsWith("…"), excerpt);
  assert(excerpt.endsWith("…"), excerpt);
  assert(excerpt.length <= 102, `excerpt is ${excerpt.length} characters`);
});

Deno.test("buildExcerpt - an unmatched note still yields an excerpt", () => {
  assertEquals(buildExcerpt("no terms here.", [], 320), "no terms here.");
});
