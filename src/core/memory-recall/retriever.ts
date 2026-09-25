// src/core/memory-recall/retriever.ts

import { estimateMemorySectionTokens, estimateNoteSectionTokens } from "./fast-recall.ts";
import { buildExcerpt } from "./note-chunker.ts";
import { buildQuery, detectHints } from "./query-hints.ts";
import { compareScoredMemories, scoreMemories, scoreNoteFiles } from "./ranker.ts";
import type { ScoredNoteFile } from "./ranker.ts";
import { MemorySnapshotCache } from "./snapshot-cache.ts";
import type { DocumentLoader } from "./snapshot-cache.ts";
import { MemoryTokenizer } from "./tokenizer.ts";
import type { IndexedMemory, QueryHints, RecallQuery, ScoredMemory } from "./types.ts";
import type { MemoryStore } from "../memory-store.ts";
import type { MemoryRecallConfig } from "../../types/config.ts";
import type {
  MemoryCategory,
  MemoryScope,
  NoteRecallResult,
  ResolvedMemory,
} from "../../types/memory.ts";
import type { ChannelWorkspaceInfo, WorkspaceInfo } from "../../types/workspace.ts";

/** Recall mode (Memory Recall v2 design, §7). */
export type RecallMode = "fast" | "deep";

/** Deep Recall never returns more than this many memories. */
export const DEEP_RECALL_MAX_LIMIT = 10;

/** Characters of a note excerpt in Deep Recall (Memory Recall v2 design, §6). */
const DEEP_NOTE_EXCERPT_CHARS = 320;

/** Characters of a note excerpt in Fast Recall (Memory Recall v2 design, §8). */
const FAST_NOTE_EXCERPT_CHARS = 160;

/** Note chunks a Deep Recall pointer carries, in score order. */
const NOTE_CHUNK_LIMIT = 3;

/** Relation bonus of a related memory, as a fraction of its parent's score. */
const RELATED_BONUS_RATIO = 0.2;

/** Direct candidates that seed the `relatedTo` expansion. */
const RELATED_PARENT_LIMIT = 5;

/** Related memories one candidate may add. */
const RELATED_PER_PARENT_LIMIT = 2;

/** A DM recalls only the user's own memories. */
const USER_SCOPES: ReadonlySet<MemoryScope> = new Set<MemoryScope>(["user"]);

/** A guild channel recalls the user's memories and the channel's shared ones. */
const USER_AND_CHANNEL_SCOPES: ReadonlySet<MemoryScope> = new Set<MemoryScope>(["user", "channel"]);

/** One recall request (Memory Recall v2 design, §7). */
export interface MemoryRecallRequest {
  /** The current user message. */
  query: string;

  /** The user's previous message; contributes query tokens only. */
  previousUserMessage?: string;

  workspace: WorkspaceInfo;

  /** Channel workspace; its memories are in scope only outside a DM. */
  channelWorkspace?: ChannelWorkspaceInfo;

  /** Ids of memories already present in the context. */
  excludeIds?: ReadonlySet<string>;

  /** Agent workspace root; notes are searched only when it is given. */
  agentWorkspacePath?: string;

  mode: RecallMode;

  /** Deep Recall: requested result count, capped at `DEEP_RECALL_MAX_LIMIT`. */
  maxResults?: number;

  /** Restricts eligibility to one category. */
  category?: MemoryCategory;

  /** Restricts eligibility to one scope; omitted means every allowed scope. */
  scope?: MemoryScope;
}

/** One recalled memory with everything needed to render or return it. */
export interface MemoryRecallResult {
  kind: "memory";
  /** The complete resolved memory, so no further lookup is needed. */
  memory: ResolvedMemory;
  /** Final score, including the relation bonus. */
  score: number;
  /** Distinct matched query terms, sorted. */
  matchedTerms: string[];
}

/** What a recall request selected. */
export interface RecallResponse {
  memories: MemoryRecallResult[];
  /**
   * Note pointers: the Fast Recall selection, or the Deep Recall selection.
   * Empty without an agent workspace, and empty in Fast Recall when
   * `memory.recall.fastRecallNoteMaxResults` is 0.
   */
  notes: NoteRecallResult[];
}

/** A Fast Recall selection plus the token cost of rendering it. */
export interface MemorySelection {
  /** Selected memories, in ranking order. */
  memories: ScoredMemory[];
  /** `estimateTokens()` of the rendered lines plus the headings they need. */
  tokens: number;
}

/** Optional collaborators, injectable for tests. */
export interface MemoryRetrieverOptions {
  /** Clock used for recency bonuses; defaults to the system clock. */
  now?: () => Date;
  /** Shares its segmenter with the snapshot cache; defaults to a new instance. */
  tokenizer?: MemoryTokenizer;
}

/**
 * Memory Recall v2 retriever: scope and visibility resolution, eligibility
 * filtering, BM25 ranking through `ranker.ts`, one-hop `relatedTo` expansion and
 * per-mode selection (Memory Recall v2 design, §5 and §8).
 *
 * The engine is CPU-only and deterministic: for the same stored data, query,
 * previous message, configuration and clock, `search()` returns identical
 * results with identical scores. It makes no network request, invokes no
 * language model and persists no index.
 */
export class MemoryRetriever {
  private readonly cache: MemorySnapshotCache;
  private readonly tokenizer: MemoryTokenizer;
  private readonly now: () => Date;

  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly recallConfig: MemoryRecallConfig,
    options: MemoryRetrieverOptions = {},
  ) {
    this.tokenizer = options.tokenizer ?? new MemoryTokenizer();
    this.cache = new MemorySnapshotCache(this.tokenizer);
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Deep Recall budget of the whole skill output, resolved from
   * `memory.recall`. The skill measures its serialized memory and note entries
   * against it, because the budget is shared by both kinds (Memory Recall v2
   * design, §8).
   */
  get deepRecallMaxTokens(): number {
    return this.recallConfig.deepRecallMaxTokens;
  }

  /** Runs one recall request and returns what its mode selected. */
  async search(request: MemoryRecallRequest): Promise<RecallResponse> {
    const hints = detectHints(request.query);
    const query = buildQuery(request.query, request.previousUserMessage);
    const ranked = await this.rank(request, query, hints);
    if (request.mode === "fast") {
      return {
        memories: this.selectFast(ranked).memories.map(toRecallResult),
        // Notes are selected by their own rule and their own budget, so a note
        // can never displace a memory and the note walk is skipped entirely
        // when note pointers are off.
        notes: request.agentWorkspacePath === undefined
          ? []
          : await this.selectFastNotes(request.agentWorkspacePath, query),
      };
    }

    // Deep Recall takes the caller's limit, capped by the engine; its token
    // budget is the skill's, because memories and notes share it.
    const limit = Math.min(
      Math.max(request.maxResults ?? DEEP_RECALL_MAX_LIMIT, 0),
      DEEP_RECALL_MAX_LIMIT,
    );
    return {
      memories: this.selectDeep(ranked, limit).map(toRecallResult),
      notes: request.agentWorkspacePath === undefined
        ? []
        : await this.selectDeepNotes(request.agentWorkspacePath, query, limit),
    };
  }

  /**
   * Fast Recall selection: precision first (Memory Recall v2 design, §8). At
   * most two memories are ever selected — the rule defines the first and the
   * second only, and `fastRecallMaxResults` is an upper bound on them. Nothing
   * is added to fill an unused slot.
   */
  selectFast(ranked: readonly ScoredMemory[]): MemorySelection {
    const config = this.recallConfig;
    if (ranked.length === 0 || config.fastRecallMaxResults < 1) return { memories: [], tokens: 0 };

    const top = ranked[0];
    if (top.score < config.minRecallScore) return { memories: [], tokens: 0 };

    const candidates = [top];
    const second = ranked[1];
    if (
      config.fastRecallMaxResults >= 2 &&
      second !== undefined &&
      second.score >= config.secondRecallScore &&
      second.score >= config.secondResultRatio * top.score
    ) {
      candidates.push(second);
    }

    return this.fitBudget(candidates, config.fastRecallMaxResults, config.fastRecallMaxTokens);
  }

  /**
   * Fast Recall note selection: the same rule as the memory selection
   * (`noteMinRecallScore`, `secondNoteRecallScore`, the shared
   * `secondResultRatio`) over the note files, with its own result limit and its
   * own token budget (Memory Recall v2 design, §8).
   */
  private async selectFastNotes(
    agentWorkspacePath: string,
    query: RecallQuery,
  ): Promise<NoteRecallResult[]> {
    const config = this.recallConfig;
    // `0` is the note off-switch: no note is selected and the walk is skipped.
    if (config.fastRecallNoteMaxResults < 1 || config.fastRecallNoteMaxTokens < 1) return [];

    const files = await this.cache.getNotes(agentWorkspacePath);
    const ranked = scoreNoteFiles(files, query);
    const top = ranked[0];
    if (top === undefined || top.best.score < config.noteMinRecallScore) return [];

    const candidates = [top];
    const second = ranked[1];
    if (
      config.fastRecallNoteMaxResults >= 2 &&
      second !== undefined &&
      second.best.score >= config.secondNoteRecallScore &&
      second.best.score >= config.secondResultRatio * top.best.score
    ) {
      candidates.push(second);
    }

    return this.fitNoteBudget(
      candidates,
      config.fastRecallNoteMaxResults,
      config.fastRecallNoteMaxTokens,
    );
  }

  /**
   * Deep Recall selection: every memory at or above `deepMinRecallScore` (0 by
   * default, so eligibility alone qualifies) up to the capped limit, admitted in
   * ranking order. Superseded memories stay eligible. The token budget is left
   * to the caller, because it is shared with the note results and measured on
   * the serialized output entries.
   */
  selectDeep(ranked: readonly ScoredMemory[], limit: number): ScoredMemory[] {
    const capped = Math.min(Math.max(limit, 0), DEEP_RECALL_MAX_LIMIT);
    return ranked
      .filter((item) => item.score >= this.recallConfig.deepMinRecallScore)
      .slice(0, capped);
  }

  /**
   * Deep Recall note selection: the workspace notes at or above
   * `deepMinRecallScore`, best first, up to the capped limit.
   */
  private async selectDeepNotes(
    agentWorkspacePath: string,
    query: RecallQuery,
    limit: number,
  ): Promise<NoteRecallResult[]> {
    const files = await this.cache.getNotes(agentWorkspacePath);
    return scoreNoteFiles(files, query)
      .filter((item) => item.best.score >= this.recallConfig.deepMinRecallScore)
      .slice(0, limit)
      .map((item) => toNoteResult(item, DEEP_NOTE_EXCERPT_CHARS, NOTE_CHUNK_LIMIT));
  }

  /**
   * Admits candidates in rank order while fewer than `limit` are admitted and
   * the rendered section still fits `maxTokens`, headings included. A candidate
   * that does not fit is skipped and a later, smaller one is still considered;
   * nothing is added to fill a gap.
   */
  private fitBudget(
    candidates: readonly ScoredMemory[],
    limit: number,
    maxTokens: number,
  ): MemorySelection {
    const memories: ScoredMemory[] = [];
    for (const candidate of candidates) {
      if (memories.length >= limit) break;
      const next = [...memories, candidate];
      if (estimateMemorySectionTokens(next.map((item) => item.indexed.memory)) > maxTokens) {
        continue;
      }
      memories.push(candidate);
    }
    return {
      memories,
      tokens: estimateMemorySectionTokens(memories.map((item) => item.indexed.memory)),
    };
  }

  /**
   * Admits note candidates in rank order while fewer than `limit` are admitted
   * and the rendered sub-section still fits `maxTokens`, heading included. A
   * note that does not fit is skipped and a later, smaller one is still
   * considered; nothing is added to fill a gap.
   */
  private fitNoteBudget(
    candidates: readonly ScoredNoteFile[],
    limit: number,
    maxTokens: number,
  ): NoteRecallResult[] {
    const results = candidates.map((item) => toNoteResult(item, FAST_NOTE_EXCERPT_CHARS, 0));
    const notes: NoteRecallResult[] = [];
    for (const result of results) {
      if (notes.length >= limit) break;
      const next = [...notes, result];
      if (estimateNoteSectionTokens(next) > maxTokens) continue;
      notes.push(result);
    }
    return notes;
  }

  /** Ranked, eligible memories of a request, before mode selection. */
  private async rank(
    request: MemoryRecallRequest,
    query: RecallQuery,
    hints: QueryHints,
  ): Promise<ScoredMemory[]> {
    const documents = await this.loadDocuments(request);
    const allowedScopes = request.workspace.isDm || request.channelWorkspace === undefined
      ? USER_SCOPES
      : USER_AND_CHANNEL_SCOPES;
    const inScope = documents.filter((doc) =>
      doc.memory.enabled &&
      (doc.memory.visibility !== "private" || request.workspace.isDm) &&
      allowedScopes.has(doc.memory.scope)
    );

    // The supersede map covers every enabled memory in scope and deliberately
    // ignores the request's category and scope filters, so a superseder outside
    // the filtered population still marks its target (Memory Recall v2 design,
    // §5.2). The population itself is what BM25 statistics are computed over.
    const supersededIds = collectSupersededIds(inScope);
    const supersededAllowed = hints.historical || request.mode === "deep";
    const population = inScope.filter((doc) =>
      (request.category === undefined || doc.memory.category === request.category) &&
      (request.scope === undefined || doc.memory.scope === request.scope) &&
      (supersededAllowed || !supersededIds.has(doc.memory.id))
    );

    const scored = scoreMemories(population, query, hints, this.now(), supersededIds);
    // Excluded memories stay in the population so their terms still count toward
    // `df`; only the results drop them.
    const eligible = scored.filter((item) =>
      !request.excludeIds?.has(item.indexed.memory.id) && matchesOverlap(item.indexed, query)
    );
    return expandRelated(eligible);
  }

  /**
   * The memory files a conversation may recall from (Memory Recall v2 design,
   * §5.2): the user's public file always, the private file in a DM, and the
   * channel file of the current channel outside a DM.
   */
  private async loadDocuments(request: MemoryRecallRequest): Promise<IndexedMemory[]> {
    const sources: Array<{ path: string; load: DocumentLoader }> = [{
      path: this.memoryStore.getMemoryFilePathFor(request.workspace, "public"),
      load: () => this.memoryStore.loadAllMemories(request.workspace, "public"),
    }];

    if (request.workspace.isDm) {
      sources.push({
        path: this.memoryStore.getMemoryFilePathFor(request.workspace, "private"),
        load: () => this.memoryStore.loadAllMemories(request.workspace, "private"),
      });
    } else if (request.channelWorkspace !== undefined) {
      const channelWorkspace = request.channelWorkspace;
      sources.push({
        path: this.memoryStore.getChannelMemoryFilePathFor(channelWorkspace),
        load: () => this.memoryStore.loadChannelMemories(channelWorkspace),
      });
    }

    const documents: IndexedMemory[] = [];
    for (const source of sources) {
      documents.push(...await this.cache.getDocuments(source.path, source.load));
    }
    return documents;
  }
}

/**
 * The overlap rule of Memory Recall v2 design §5.2: at least one matched word or
 * entity token, or at least two distinct matched bigram tokens. Index keys are
 * `kind:term`, so the query token decides the kind of a matched key.
 */
function matchesOverlap(doc: IndexedMemory, query: RecallQuery): boolean {
  let bigrams = 0;
  for (const key of doc.tf.keys()) {
    const token = query.tokens.get(key);
    if (token === undefined) continue;
    if (token.kind !== "bigram") return true;
    if (++bigrams >= 2) return true;
  }
  return false;
}

/** Ids named by any document's `supersedes`. */
function collectSupersededIds(documents: readonly IndexedMemory[]): Set<string> {
  const ids = new Set<string>();
  for (const doc of documents) {
    for (const id of doc.memory.supersedes) ids.add(id);
  }
  return ids;
}

/**
 * One-hop `relatedTo` expansion (Memory Recall v2 design, §5.5). The top direct
 * candidates seed it, each adding at most two related memories; a related memory
 * must already be eligible with a positive lexical score, so the eligible ranked
 * list is the complete lookup set. A related memory keeps the larger of its own
 * score and `own + 0.20 × parentScore`, and a parent's own direct score is used,
 * which is what stops the boost from propagating a second hop.
 */
function expandRelated(ranked: readonly ScoredMemory[]): ScoredMemory[] {
  if (ranked.length === 0) return [];

  const byId = new Map(ranked.map((item) => [item.indexed.memory.id, item]));
  const boosted = new Map<string, number>();

  for (const parent of ranked.slice(0, RELATED_PARENT_LIMIT)) {
    let added = 0;
    for (const relatedId of parent.indexed.memory.relatedTo) {
      if (added >= RELATED_PER_PARENT_LIMIT) break;
      const related = byId.get(relatedId);
      if (related === undefined || related === parent) continue;
      added++;
      const candidate = related.score + RELATED_BONUS_RATIO * parent.score;
      const current = boosted.get(relatedId) ?? related.score;
      if (candidate > current) boosted.set(relatedId, candidate);
    }
  }

  if (boosted.size === 0) return [...ranked];
  return ranked
    .map((item) => {
      const score = boosted.get(item.indexed.memory.id);
      return score === undefined ? item : { ...item, score };
    })
    .sort(compareScoredMemories);
}

function toRecallResult(item: ScoredMemory): MemoryRecallResult {
  return {
    kind: "memory",
    memory: item.indexed.memory,
    score: item.score,
    matchedTerms: item.matchedTerms,
  };
}

/**
 * Pointer of one note file (Memory Recall v2 design, §6 and §8). Deep Recall
 * carries its best `chunkLimit` chunks; Fast Recall passes `0` and the key is
 * omitted, because a Fast pointer is a single excerpt.
 */
function toNoteResult(
  item: ScoredNoteFile,
  excerptChars: number,
  chunkLimit: number,
): NoteRecallResult {
  const best = item.best;
  return {
    path: item.file.path,
    title: item.file.title,
    headingPath: best.chunk.headingPath,
    lineStart: best.chunk.lineStart,
    lineEnd: best.chunk.lineEnd,
    excerpt: buildExcerpt(best.chunk.text, best.matchedTerms, excerptChars),
    fileTokens: item.file.fileTokens,
    modifiedAt: item.file.modifiedAt,
    score: best.score,
    matchedTerms: best.matchedTerms,
    ...(chunkLimit > 0
      ? {
        chunks: item.chunks.slice(0, chunkLimit).map((scored) => ({
          headingPath: scored.chunk.headingPath,
          lineStart: scored.chunk.lineStart,
          lineEnd: scored.chunk.lineEnd,
          excerpt: buildExcerpt(scored.chunk.text, scored.matchedTerms, excerptChars),
        })),
      }
      : {}),
  };
}
