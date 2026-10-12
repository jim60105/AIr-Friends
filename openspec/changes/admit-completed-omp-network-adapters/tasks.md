# Tasks

C1 and C4 are prerequisites (C5). Run build/format/lint/affected tests once after all implementation edits, not between tasks. Automated acceptance is deterministic source/API-shaped smoke only; native runtime, providers, platforms, and containers remain user-owned.

## 1. Consume completion at the existing enforcement seam

- [x] 1.1 Connect typed URL-read/web-search route completion to the composer after inventory and fresh provenance admission; keep unavailable/unsupported/uncovered cases blocked. Verify a supported owned route reaches only the registered controlled replacement, while a marker on foreign or unregistered provenance cannot dispatch.
  <!-- Consumed AT the existing clamp in extension/enforcement.ts (consumeNetworkAdapterCompletion),
       strictly after inventory + live-provenance admission + pair screening; webfetch/web-fetch never
       admits; unregistered/foreign cases keep the byte-identical rejected_pending_adapter block; the
       foreign/shadow same-name path denies at provenance BEFORE the clamp (pinned in native suite). -->
- [x] 1.2 Use current trusted backend availability for search, reconcile both route tables, and preserve existing redirect/secondary-hop authorization and operator egress posture. Verify no credentials are logged, absent backend produces zero requests even under unrestricted egress, and private hops deny before dispatch.
  <!-- Presence-only availability read fresh per call (booleans only); fetch-routes.ts deduped and
       reconciled with the cross-table completed-set pin; hop authorization untouched — private-redirect
       composite denies with zero private issue; credential-absent composite pins zero endpoint requests. -->
- [x] 1.3 Migrate affected behavioral coverage, deleting byte/marker-copy tests; update network/runtime docs and changelog, rebuild/recut owned artifacts, and retain no native fallback. Verify the documented active/pending boundaries agree with the real composed outcomes.
  <!-- No byte/marker-copy tests existed to delete; absence fixtures retained. Docs: OMP_NETWORK.md
       posture paragraphs, OMP_ENFORCEMENT.md seam row + production-limit prose, OMP_TOOL_POLICY.md
       rows 46/178, wiring seam disposition, CHANGELOG entry incl. the web_search reason shift.
       Bundle rebuilt (externals unchanged: @sinclair/typebox, node:dns/promises). Manifest recut per
       the repo convention (PACKAGE-MANIFEST.sha256 is NOT repo-tracked; regenerated over final
       content at image build): recut over the simulated owned root (config trio + prompt/SYSTEM.md +
       regenerated extension/index.js), sha256sum -c all OK, 5 digests; extension/index.js =
       22c785f59e827a7570b1b6e4317e883f9fd1bc995fce9b094d7e1db7c68653b5 from index.ts =
       2697027e96d73bb52fdcb033639e2fd78b48a49378d5619b0f600bbf32ecaba1. No native fallback retained. -->

## 2. Composed transport proof

- [x] 2.1 After all edits, drive the C4 native callback and C2 replacement with real composer/controlled transport plus mock endpoints/DNS in a throwaway smoke; observe attributed success, unavailable-backend denial, and private redirect/secondary-hop denial. Run affected behavior suites once; verify zero real network/provider traffic and no duplicate dispatch.
  <!-- Composed coverage lands in the existing behavior suites (same harness discipline: recording
       mock transports + injected DNS, no throwaway duplicate): native-suite composed callback drives
       the real C2 replacements through the real composer (URL read proceeds on the completed route
       set; web_search blocks pending with zero dispatch); private-redirect and credential-absent
       composites pin deny-before-dispatch with zero endpoint requests; full suite 2787 pass / 0 fail. -->

## Workflow follow-up

- Archive and sync after implementation/review gates; leave historical archives unchanged.
- Apply successors in the correction index order; rebuild/recut owned outputs for each affected successor.
