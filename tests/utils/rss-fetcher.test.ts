// tests/utils/rss-fetcher.test.ts

import { assertEquals } from "@std/assert";
import { parseRssXml, pickRandom, stripXmlTags, truncateText } from "@utils/rss-fetcher.ts";

Deno.test("stripXmlTags - removes HTML/XML tags", () => {
  assertEquals(stripXmlTags("<p>Hello <b>world</b></p>"), "Hello world");
});

Deno.test("stripXmlTags - handles empty string", () => {
  assertEquals(stripXmlTags(""), "");
});

Deno.test("stripXmlTags - handles text without tags", () => {
  assertEquals(stripXmlTags("plain text"), "plain text");
});

Deno.test("stripXmlTags - handles self-closing tags", () => {
  assertEquals(stripXmlTags("before<br/>after"), "beforeafter");
});

Deno.test("truncateText - does not truncate short text", () => {
  assertEquals(truncateText("hello", 10), "hello");
});

Deno.test("truncateText - truncates long text with ellipsis", () => {
  const result = truncateText("a".repeat(400), 300);
  assertEquals(result.length, 300);
  assertEquals(result.endsWith("..."), true);
});

Deno.test("truncateText - exact length text is not truncated", () => {
  const text = "a".repeat(300);
  assertEquals(truncateText(text, 300), text);
});

Deno.test("pickRandom - returns correct count", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = pickRandom(items, 3);
  assertEquals(result.length, 3);
});

Deno.test("pickRandom - returns all items when count exceeds array length", () => {
  const items = [1, 2, 3];
  const result = pickRandom(items, 10);
  assertEquals(result.length, 3);
});

Deno.test("pickRandom - returns empty array for empty input", () => {
  const result = pickRandom([], 5);
  assertEquals(result.length, 0);
});

Deno.test("pickRandom - does not modify original array", () => {
  const items = [1, 2, 3, 4, 5];
  const original = [...items];
  pickRandom(items, 3);
  assertEquals(items, original);
});

Deno.test("pickRandom - returns 0 items when count is 0", () => {
  const result = pickRandom([1, 2, 3], 0);
  assertEquals(result.length, 0);
});

Deno.test("parseRssXml - parses RSS 2.0 format", () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article1</link>
      <description>This is article one description</description>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article2</link>
      <description><![CDATA[<p>HTML content</p>]]></description>
    </item>
  </channel>
</rss>`;

  const items = parseRssXml(xml, "Test");
  assertEquals(items.length, 2);
  assertEquals(items[0].title, "Article One");
  assertEquals(items[0].url, "https://example.com/article1");
  assertEquals(items[0].description, "This is article one description");
  assertEquals(items[0].sourceName, "Test");
  assertEquals(items[1].title, "Article Two");
  assertEquals(items[1].description, "HTML content");
});

Deno.test("parseRssXml - parses Atom format", () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Feed</title>
  <entry>
    <title>Atom Article</title>
    <link href="https://example.com/atom1" rel="alternate"/>
    <summary>Atom summary text</summary>
  </entry>
</feed>`;

  const items = parseRssXml(xml, "Atom Source");
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "Atom Article");
  assertEquals(items[0].url, "https://example.com/atom1");
  assertEquals(items[0].description, "Atom summary text");
  assertEquals(items[0].sourceName, "Atom Source");
});

Deno.test("parseRssXml - strips XML tags from description", () => {
  const xml = `<rss version="2.0"><channel>
    <item>
      <title>Test</title>
      <link>https://example.com</link>
      <description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description>
    </item>
  </channel></rss>`;

  const items = parseRssXml(xml, "Test");
  assertEquals(items.length, 1);
  assertEquals(items[0].description, "Hello world");
});

Deno.test("parseRssXml - truncates long description to 300 chars", () => {
  const longDesc = "a".repeat(500);
  const xml = `<rss version="2.0"><channel>
    <item>
      <title>Test</title>
      <link>https://example.com</link>
      <description>${longDesc}</description>
    </item>
  </channel></rss>`;

  const items = parseRssXml(xml, "Test");
  assertEquals(items[0].description.length, 300);
  assertEquals(items[0].description.endsWith("..."), true);
});

Deno.test("parseRssXml - returns empty array for invalid XML", () => {
  const items = parseRssXml("not xml at all", "Test");
  assertEquals(items.length, 0);
});

Deno.test("parseRssXml - handles empty feed", () => {
  const xml = `<rss version="2.0"><channel><title>Empty</title></channel></rss>`;
  const items = parseRssXml(xml, "Test");
  assertEquals(items.length, 0);
});

Deno.test("parseRssXml - decodes XML entities in description", () => {
  const xml = `<rss version="2.0"><channel>
    <item>
      <title>Test &amp; More</title>
      <link>https://example.com</link>
      <description>A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; text</description>
    </item>
  </channel></rss>`;

  const items = parseRssXml(xml, "Test");
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "Test & More");
  assertEquals(items[0].description, 'A bold & "quoted" text');
});

Deno.test("parseRssXml - handles CDATA in description", () => {
  const xml = `<rss version="2.0"><channel>
    <item>
      <title>CDATA Test</title>
      <link>https://example.com</link>
      <description><![CDATA[<p>Rich <em>content</em></p>]]></description>
    </item>
  </channel></rss>`;

  const items = parseRssXml(xml, "Test");
  assertEquals(items.length, 1);
  assertEquals(items[0].description, "Rich content");
});

Deno.test("parseRssXml - handles Atom entry with link element content", () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Entry with link tag</title>
    <link>https://example.com/entry1</link>
    <summary>A summary</summary>
  </entry>
</feed>`;

  const items = parseRssXml(xml, "Atom");
  assertEquals(items.length, 1);
  assertEquals(items[0].url, "https://example.com/entry1");
});

Deno.test("parseRssXml - handles Atom entry with content instead of summary", () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Content Entry</title>
    <link href="https://example.com/entry2"/>
    <content type="html">&lt;p&gt;Full content&lt;/p&gt;</content>
  </entry>
</feed>`;

  const items = parseRssXml(xml, "Atom");
  assertEquals(items.length, 1);
  assertEquals(items[0].description, "Full content");
});

Deno.test("parseRssXml - handles multiple RSS items", () => {
  const xml = `<rss version="2.0"><channel>
    <item><title>One</title><link>https://a.com</link><description>Desc 1</description></item>
    <item><title>Two</title><link>https://b.com</link><description>Desc 2</description></item>
    <item><title>Three</title><link>https://c.com</link><description>Desc 3</description></item>
  </channel></rss>`;

  const items = parseRssXml(xml, "Multi");
  assertEquals(items.length, 3);
  assertEquals(items[0].title, "One");
  assertEquals(items[1].title, "Two");
  assertEquals(items[2].title, "Three");
});

Deno.test("parseRssXml - handles numeric character references", () => {
  const xml = `<rss version="2.0"><channel>
    <item>
      <title>Test</title>
      <link>https://example.com</link>
      <description>Copyright &#169; 2024 &#x2603;</description>
    </item>
  </channel></rss>`;

  const items = parseRssXml(xml, "Test");
  assertEquals(items[0].description, "Copyright © 2024 ☃");
});

Deno.test("parseRssXml - item with title only (no link) is still parsed", () => {
  const xml = `<rss version="2.0"><channel>
    <item>
      <title>Title Only</title>
      <description>Some description</description>
    </item>
  </channel></rss>`;

  const items = parseRssXml(xml, "Test");
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "Title Only");
  assertEquals(items[0].url, "");
});
