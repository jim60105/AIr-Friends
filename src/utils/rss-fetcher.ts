// src/utils/rss-fetcher.ts

import { createLogger } from "@utils/logger.ts";
import type { RssFeedSource } from "../types/config.ts";

const logger = createLogger("RssFetcher");

/**
 * A single RSS item with cleaned content
 */
export interface RssItem {
  /** Article title */
  title: string;
  /** Article URL */
  url: string;
  /** Cleaned and truncated description (max 300 chars, XML tags stripped) */
  description: string;
  /** Feed source name */
  sourceName: string;
}

/**
 * Fetch items from multiple RSS feed sources.
 * Silently skips feeds that fail to fetch or parse.
 */
export async function fetchRssItems(sources: RssFeedSource[]): Promise<RssItem[]> {
  const allItems: RssItem[] = [];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: { "User-Agent": "AIr-Friends/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn("RSS fetch failed", { url: source.url, status: response.status });
        continue;
      }

      const xml = await response.text();
      const items = parseRssXml(xml, source.name ?? source.url);
      allItems.push(...items);
    } catch (error) {
      logger.warn("RSS fetch error", {
        url: source.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return allItems;
}

/**
 * Parse RSS/Atom XML and extract items.
 * Handles both RSS 2.0 (<item>) and Atom (<entry>) formats.
 * Uses regex-based parsing to avoid XML library dependencies.
 */
export function parseRssXml(xml: string, sourceName: string): RssItem[] {
  const items: RssItem[] = [];

  // Try RSS 2.0 format (<item>)
  const rssItemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = rssItemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const description = extractTag(block, "description") ||
      extractTag(block, "content:encoded");

    if (title || link) {
      items.push({
        title: decodeXmlEntities(stripXmlTags(title)).trim(),
        url: decodeXmlEntities(stripXmlTags(link)).trim(),
        description: truncateText(stripXmlTags(decodeXmlEntities(description)), 300),
        sourceName,
      });
    }
  }

  // If no RSS items found, try Atom format (<entry>)
  if (items.length === 0) {
    const atomEntryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;

    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = extractTag(block, "title");
      // Atom uses <link href="..."/> or <link rel="alternate" href="..."/>
      const link = extractAtomLink(block);
      const description = extractTag(block, "summary") || extractTag(block, "content");

      if (title || link) {
        items.push({
          title: decodeXmlEntities(stripXmlTags(title)).trim(),
          url: decodeXmlEntities(link).trim(),
          description: truncateText(stripXmlTags(decodeXmlEntities(description)), 300),
          sourceName,
        });
      }
    }
  }

  return items;
}

/**
 * Extract content between XML tags
 */
function extractTag(xml: string, tagName: string): string {
  // Handle CDATA sections
  const cdataRegex = new RegExp(
    `<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`,
    "i",
  );
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1];

  // Handle regular content
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = regex.exec(xml);
  return match ? match[1] : "";
}

/**
 * Extract link from Atom entry (handles <link href="..." /> format)
 */
function extractAtomLink(xml: string): string {
  // Try <link rel="alternate" href="..."/>
  const altMatch = /<link[^>]*rel\s*=\s*["']alternate["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(
    xml,
  );
  if (altMatch) return altMatch[1];

  // Try any <link href="..."/>
  const linkMatch = /<link[^>]*href\s*=\s*["']([^"']+)["']/i.exec(xml);
  if (linkMatch) return linkMatch[1];

  // Try <link>...</link>
  return extractTag(xml, "link");
}

/**
 * Decode common XML entities
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Strip XML/HTML tags from a string
 */
export function stripXmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim();
}

/**
 * Truncate text to maxLength characters, adding "..." if truncated
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Randomly pick N items from an array (Fisher-Yates shuffle)
 */
export function pickRandom<T>(items: T[], count: number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
