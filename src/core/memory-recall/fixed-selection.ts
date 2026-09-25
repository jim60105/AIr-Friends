// src/core/memory-recall/fixed-selection.ts

import { estimateTokens } from "@utils/token-counter.ts";
import type { ResolvedMemory } from "../../types/memory.ts";

/**
 * Budgets that bound the fixed memory sections (Memory Recall v2 design, §9).
 */
export interface FixedMemoryBudgets {
  /** Token budget shared by the user and the channel core sections. */
  coreMaxTokens: number;
  /** Newest working-tier candidates considered per assembly. */
  workingMaxItems: number;
  /** Token budget shared by the user and the channel working entries. */
  workingMaxTokens: number;
}

/**
 * Fixed-loading candidates, one list per source, in store order.
 */
export interface FixedMemoryCandidates {
  userCore: readonly ResolvedMemory[];
  channelCore: readonly ResolvedMemory[];
  userWorking: readonly ResolvedMemory[];
  channelWorking: readonly ResolvedMemory[];
}

/**
 * The memories fixed loading injects, split the way the sections render them.
 */
export interface FixedMemorySelection {
  userCore: ResolvedMemory[];
  userWorking: ResolvedMemory[];
  channelCore: ResolvedMemory[];
  channelWorking: ResolvedMemory[];
  /**
   * Ids of the memories actually injected. Fast Recall excludes them, so a
   * memory dropped by these budgets stays eligible for retrieval (design, §9).
   */
  injectedIds: string[];
}

/** A working candidate tagged with the section it is rendered in. */
interface TaggedMemory {
  memory: ResolvedMemory;
  attributed: boolean;
}

/**
 * One fixed-memory line, exactly as the tiered sections render it: `N. <content>`,
 * or `N. [from <author>] <content>` for an attributed channel entry.
 *
 * Selection measures these lines, so the renderer MUST call this too: a budget
 * is only meaningful when the measured string is the rendered string.
 */
export function renderFixedMemoryLine(
  memory: ResolvedMemory,
  position: number,
  attributed: boolean,
): string {
  if (!attributed) return `${position}. ${memory.content}`;
  return `${position}. [from ${memory.author ?? "unknown contributor"}] ${memory.content}`;
}

/** Oldest first; ties by id, so the result never depends on input order. */
function byCreatedAtAscending(a: ResolvedMemory, b: ResolvedMemory): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Newest first; ties by id, so the result never depends on input order. */
function byCreatedAtDescending(a: ResolvedMemory, b: ResolvedMemory): number {
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Keep the entries whose rendered line fits the remaining budget, skip the ones
 * that do not, and still consider the entries after a skip (design, §9).
 *
 * `position` is the entry's 1-based position in its rendered section, which is
 * the position of the kept entries so far.
 */
function fitWithinBudget(
  ordered: readonly ResolvedMemory[],
  maxTokens: number,
  attributed: boolean,
): { kept: ResolvedMemory[]; tokens: number } {
  const kept: ResolvedMemory[] = [];
  let tokens = 0;

  for (const memory of ordered) {
    const lineTokens = estimateTokens(
      renderFixedMemoryLine(memory, kept.length + 1, attributed),
    );
    if (tokens + lineTokens > maxTokens) continue;
    kept.push(memory);
    tokens += lineTokens;
  }

  return { kept, tokens };
}

/**
 * Estimated tokens of the rendered working sections: the user entries numbered
 * from 1, and the channel entries numbered after the selected channel core
 * entries, because the channel section numbers one merged list.
 */
function workingSectionTokens(
  userWorking: readonly ResolvedMemory[],
  channelWorking: readonly ResolvedMemory[],
  channelCoreCount: number,
): number {
  const userTokens = userWorking.reduce(
    (sum, memory, i) => sum + estimateTokens(renderFixedMemoryLine(memory, i + 1, false)),
    0,
  );
  const channelTokens = channelWorking.reduce(
    (sum, memory, j) =>
      sum + estimateTokens(renderFixedMemoryLine(memory, channelCoreCount + j + 1, true)),
    0,
  );
  return userTokens + channelTokens;
}

/**
 * Select the memories fixed loading injects, within the configured budgets.
 *
 * Only tier decides fixed loading: the candidates are the enabled core and
 * working tier memories of each source, so an `importance: "high"` memory
 * outside the core tier is never injected. Core entries are considered user
 * first, then channel, each oldest first, under one shared budget. Working
 * entries are merged, newest `workingMaxItems` first, under a second shared
 * budget, and are presented chronologically (Memory Recall v2 design, §9).
 */
export function selectFixedMemories(
  candidates: FixedMemoryCandidates,
  budgets: FixedMemoryBudgets,
): FixedMemorySelection {
  const userCore = fitWithinBudget(
    [...candidates.userCore].sort(byCreatedAtAscending),
    budgets.coreMaxTokens,
    false,
  );
  const channelCore = fitWithinBudget(
    [...candidates.channelCore].sort(byCreatedAtAscending),
    budgets.coreMaxTokens - userCore.tokens,
    true,
  );

  // Only the newest `workingMaxItems` candidates across both sources are ever
  // considered, so an entry skipped for size is never replaced by an older one.
  const workingCandidates: TaggedMemory[] = [
    ...candidates.userWorking.map((memory) => ({ memory, attributed: false })),
    ...candidates.channelWorking.map((memory) => ({ memory, attributed: true })),
  ]
    .sort((a, b) => byCreatedAtDescending(a.memory, b.memory))
    .slice(0, budgets.workingMaxItems);

  const keptNewestFirst: TaggedMemory[] = [];
  let workingTokens = 0;
  for (const candidate of workingCandidates) {
    const lineTokens = estimateTokens(
      renderFixedMemoryLine(candidate.memory, keptNewestFirst.length + 1, candidate.attributed),
    );
    if (workingTokens + lineTokens > budgets.workingMaxTokens) continue;
    keptNewestFirst.push(candidate);
    workingTokens += lineTokens;
  }

  // The walk numbers the entries as it goes, but the sections render them
  // chronologically, and reaching ten entries in a section adds a digit to the
  // line prefix. Re-measure the rendered lines and drop the oldest entries
  // while the renumbered sections still overflow the budget.
  const chronological = keptNewestFirst.slice().reverse();
  let userWorking: ResolvedMemory[] = [];
  let channelWorking: ResolvedMemory[] = [];

  while (chronological.length > 0) {
    const user = chronological.filter((entry) => !entry.attributed).map((entry) => entry.memory);
    const channel = chronological.filter((entry) => entry.attributed).map((entry) => entry.memory);

    if (workingSectionTokens(user, channel, channelCore.kept.length) <= budgets.workingMaxTokens) {
      userWorking = user;
      channelWorking = channel;
      break;
    }
    chronological.shift();
  }

  return {
    userCore: userCore.kept,
    userWorking,
    channelCore: channelCore.kept,
    channelWorking,
    injectedIds: [
      ...userCore.kept,
      ...channelCore.kept,
      ...userWorking,
      ...channelWorking,
    ].map((memory) => memory.id),
  };
}
