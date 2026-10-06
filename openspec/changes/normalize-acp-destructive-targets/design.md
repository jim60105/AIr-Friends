## Context

See `proposal.md` — Why. Design §8 ("Destructive operations") and the capability matrix row for delete/move/destructive patch are the approved requirements; design §7 keeps the native ACP bash/destructive permission path active. Dependencies: `canonicalize-acp-filesystem-roots` (row 2, observation API), `enforce-acp-filesystem-authorization` (row 4, sink decision + `SessionGateContext`), with `establish-omp-compatibility-contracts` (row 1, P0) as data contract and application gate.

Current-state constraints that shape the approach:

- Live classification in `src/acp/client.ts` is `isEditWriteRequest(title, kind)` (`kind === "edit"` or legacy titles) followed by `locations.map(l => l.path)` and — only when locations are empty — `extractPathsFromRawInput()` field sniffing. Approval then applies shared-write/extension rules to *whatever paths arrived*, which is first/partial-target approval by construction. ACP `ToolKind` already includes `"delete"` and `"move"`, so OMP delete/move requests are distinguishable at the gate but currently fall through toward unknown-tool/default denial.
- P0 records the OMP destructive-intent boundary as native-location-list-incompatible and overall unresolved at the pin: `getPermissionIntent` handles native delete/move, `getEditDestructiveIntent` uses `fileOps.find` and returns only one delete or move, and `extractPermissionLocations` cannot recover omitted later operations. P0's `DestructiveIntentContract` is therefore the shape this change consumes (tool identity + exact raw input, parser/edit-mode provenance, ordered operations, complete target set, execution binding), and its blocked verdict gates *application* of this change exactly as it gates row 4.
- Row 4 supplies the decision the destructive targets must reuse: contextual expansion, root/target observations, one selected authorized role with read/overwrite/create intent, restricted staging/shared/extension rules, YOLO broad containment, trusted read-only skills denial, and the bounded rejection vocabulary. Row 3/2 supply prospective-target semantics (existing ancestor + missing suffix), which is why delete sources need an explicit existing-only requirement.

## Goals / Non-Goals

**Goals:** One pure normalizer that turns a destructive-shaped request into a complete ordered operation set or one bounded failure; an all-target authorization pass through row 4's existing decision, with delete/source existing-only and destination/mutation create-overwrite intents; a single module that both the client gate and (later, by its owner) the OMP restricted-tool adapter import so neither surface can authorize a superset of what it decoded; consumer-visible unit/mock/temp-filesystem evidence and permission docs, inside one engineer-day.

**Non-Goals:** No native edit-syntax parser invented or extended beyond P0-established supported parsers; no proof of native OMP decoding mechanism (P0's job and gate); no extension `tool_call` handler wiring, tool inventory, provenance, default-deny or alternate-entry blocking and no generic-command argument-gate hardening (`enforce-omp-restricted-tool-policy`); no new IO primitive, delete/rename syscall, or recursive-directory semantics (`secure-acp-filesystem-access`); no change to roots, token expansion, ordinary write policy, trusted-skills provenance, or the `.jsonl`/`.md`/`.txt` read rules (rows 2/4); no readiness gating (row 13), LSP change (row 15), staging recipe change (row 16), network/packaging/lifecycle/docs-package work (rows 17–22). No new config/env field, shim, migration, dependency change, or claim that mocks demonstrate native enforcement.

## Decisions

### 1. Destructive routing precedes the location-list approval, inside the existing edit/write branch

`requestPermission()` gains a destructive classification step *before* `isEditWriteRequest` handling: ACP `kind` of `"delete"`/`"move"`, a decoded multi-operation patch shape in the bound input, or a recognized native delete/move tool identity. Rationale: the locations path is the first-target-only approval mechanism, so leaving destructive shapes anywhere below it reintroduces the vulnerability; keeping it in the same branch preserves the existing ordering contract (registered-skill auto-approve above, command gate below) rather than creating a second gate. Rejected alternative: harden `extractPathsFromRawInput` to gather more fields — it still cannot recover operations a native location list omitted, and it would blur ordinary edits with destructive semantics. Alternative rejected: reject every delete/move request outright — that hides whether the boundary actually holds, silently breaks legitimate staging-local cleanup, and is the scope cut the approved design forbids.

The ordinary edit/write path keeps its current location-list + `rawInput` extraction behavior for non-destructive single-target shapes; this change only diverts destructive-shaped requests and adds the reason codes. The generic-command path gate (`referencesOutOfWorkspacePath`, `DANGEROUS_GENERIC_FLAGS`, fd-redirect tolerance) is untouched, and its lexical character is documented as unchanged — its hardening is row 14's.

### 2. Pure normalizer keyed on the P0 contract shape, with completeness checks as the product

`src/acp/destructive-policy.ts` exports a normalization entry that accepts the P0 `DestructiveIntentContract`-shaped input (tool identity, exact raw input, parser/edit-mode provenance, operations, execution binding) plus the already-expanded target spellings, and returns `{ operations: [{ op, targets: [...] }] }` or one failure of a finite set: `incomplete_operation` (missing move endpoint, absent target), `unsupported_syntax` (unknown/incompatible edit mode), `unparseable_input`, `binding_mismatch` (decoded operations inconsistent with the bound execution input or with the supplied location list), `title_only_intent`. Normalization never guesses: an incomplete location list against a raw input carrying more operations is `incomplete_operation`, not a narrowing to the intersection — authorizing the intersection would silently approve a patch whose remainder executes unexamined. Move destination may be prospective (new file), while a move source or delete target must be an existing-target observation; that asymmetry comes from row 2's prospective-target semantics and is enforced here as an intent flag consumed by the authorization pass, not by touching the filesystem.

For fixtures, the tests decode native-shaped inputs in the shapes P0's destructive fixtures already use, and any syntax whose complete decoding P0 does not establish is exercised as an expected `unsupported_syntax`/`incomplete_operation` denial — no speculative parser is written to make a fixture pass, and a passing local suite never clears P0's blocked verdict.

### 3. Authorization is a loop over row 4's decision, with per-target intents

The all-target pass calls row 4's `filesystem-policy.ts` decision per target with `delete` intent for deletion targets and move sources, and `overwrite`/`create` intent for move destinations and patch mutation targets — the same function the `writeTextFile` sink uses, so restricted staging/shared/extension rules, YOLO broad containment, trusted-skills read-only denial and escaping-symlink denial cannot diverge between an ordinary write and the same path as a destructive target. Approval requires every target authorized; the denial reason identifies the first disallowed target index while the decision remains all-or-nothing (partial approval is meaningless for one patch). A second destructive-specific authorization table was rejected: it would become a second convention the moment row 14's adapter imports one and the client the other. Recursive-directory or special-node deletion semantics stay with rows 2/3 (their observation and access layers already fail on type mismatch and special nodes); this layer only refuses to widen them.

### 4. YOLO stays native permissive

Destructive normalization runs, but restricted completeness/target-scope results do not feed YOLO approval: YOLO permission requests remain auto-approved with `yolo_mode` (D6), and destructive *callback/sink* targets keep row 4's broad-containment-plus-escape-denial rule. Rationale: the approved design explicitly forbids copying restricted clamps into native YOLO; the genuine boundary that remains is the documented one — ACP callbacks do not constrain non-ACP native execution. Tests assert both directions: YOLO destructive approval, and YOLO destructive denial for escaping/external/read-only targets.

### 5. One shared module, row-14 conformance without extension wiring

The module exports normalization, the per-target decision and a machine-readable conformance table (fixture id → completeness verdict, enumerated targets, outcome reason). Row 14's adapter must import it; this change ships the module, the client consumption, and a mock "adapter-side" test that invokes the same exports so divergence is caught by a test rather than by review. Wiring the OMP `tool_call` handler here was rejected — its registration, provenance and readiness context are row 14/13 deliverables that do not exist yet, and faking them would contradict P0's evidence discipline.

### 6. Diagnostics reuse the existing bounded vocabulary

New reason codes are additive and finite: `rejected_destructive_incomplete`, `rejected_destructive_target` (with the existing target/root mapping reused where the row-4 code already names the cause), `rejected_destructive_binding`. They flow through `recordPermissionRejection()` and `writePermissionAudit()` exactly as row 4's sink reasons do, with sanitized length-bounded fields, one record per denial, and static `acp.RequestError` messages carrying no content or raw platform error text, so the retry-prompt section is unchanged in shape.

## Risks / Trade-offs

- **P0 destructive verdict is unresolved/incompatible at the pin** → This change is drafted and locally verifiable regardless, but its application is gated: if no supported complete decoding exists, the honest delivery is the normalizer plus `unsupported_syntax`/`incomplete_operation` denial for those shapes and zero mutation, and the native delete/move capability stays blocked for a user design decision rather than being emulated.
- **Classification drift** (a destructive shape that neither `delete`/`move` kind nor a recognized patch shape reveals) → mitigated by treating any decoded multi-operation mutation content as destructive-shaped, defaulting unmatched file-mutating requests to the existing default-deny, and keeping "approve because title looks harmless" impossible: titles are presentation only.
- **Shared-branch conflict with row 4** (both touch the `requestPermission` edit/write branch and `src/acp/client.ts`) → apply row 4 first; this change inserts routing ahead of the locations approval and reuses its helpers, so integration is one owner serializing the two edits. Same for `docs/AGENT_PERMISSIONS.md`, `CHANGELOG.md`, the reason vocabulary and additive `acp-integration` requirements.
- **False-assurance risk** → unit/mock/temp-filesystem evidence proves the client's decision logic only; it does not show the official OMP binary emits complete intent or enforces anything. Docs state that, and P0's ledger plus row 21's combined mocks own the rest.
- **Per-target reason leakage** → the identifying target field goes through the existing sanitizer/length bound and audit mirroring; no file content, secret, or unbounded agent-supplied text in emitted messages.

## Migration Plan

Single-pass cutover with no data migration and no config change: land the module, route destructive-shaped requests through it, add reason codes, replace the fall-through expectations in existing tests. Rollback is reverting the routing commit; no persisted state, on-disk format, or configuration field is touched.

## Open Questions

None that affect the specs or approach. Whether P0's final verdict names a supported complete decoder is a downstream application-gate input, already handled by Decision 2's fail-closed branch.
