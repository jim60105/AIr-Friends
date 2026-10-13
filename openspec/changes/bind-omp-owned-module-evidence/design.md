# Design

## Context

`extension/index.ts` passes observed launch cwd, module URL and a frozen resource generation to native registration, but no `NativeSessionContext`. Registration derives `baseRoot` from the mutable `omp-agent/<mode>/cwd` namespace. The actual bundle is `/opt/air/omp/extension/index.js` in the image or the resolved repository `build/omp-extension/index.js` in development. It is neither the old base-root-relative `.ts` source nor a child of the state root.

`tool-provenance.ts` currently demands `canonicalTarget` from optional session context, even for context-free controlled networking. Its pure ownership consumer loses `closureRoots` that the translator used. This change follows issue 1's direct `api.getAllTools()` roster cutover and accepted local native approval/ambient-OS posture; it is not a confined native-filesystem broker.

## Goals / Non-Goals

Give genuine owned replacement registrations a production evidence producer. Use physical deployment-module evidence independently of mutable process state and destructive-session grants. Keep exact owned source, epoch and resource generation binding on every call.

Do not mint `CanonicalTarget` values with invented ACP/skill session ids or shared/trusted-skills roles. Do not add credentials, runtime fields, global readiness, native network fallback, new permission grants or alternative filesystem policies. Native-YOLO still registers no restricted handlers or controlled replacements.

## Decisions

### Three distinct identities

1. Process launch identity contains observed cwd, mode and the mode-scoped state namespace. It establishes restricted versus native-YOLO wiring and never supplies module ownership.
2. Deployment module identity contains the exact selected generated artifact, declared canonical module root, and permitted dependency closure. Image deployment retains its immutable owned-source contract; development retains the declared build-owned source contract. The existing selected image/development path resolver and owned constants supply it; `import.meta.url` must match that artifact. Never infer an owned root from any arbitrary loaded module's directory.
3. Session filesystem context remains acquired from existing trusted session producers for destructive/other session-bound completion. Absence continues to deny those operations; module admission gives no filesystem grant.

Keep the source `.ts` constant as build-input identity where needed, not as a launch-module predicate. Use one declaration type for the generated loaded artifact and closure, shared by launch argument assembly and the runtime verifier. The image artifact is the existing fixed constant. For development, extend the existing build-time bundler's deterministic transformation to embed its canonical absolute source checkout's `build/omp-extension/index.js` declaration in the emitted artifact. Derive that declaration from the canonical source checkout, independently of the existing bundler's output target used for packaging. Arbitrary output targets remain permitted and gain no runtime module authority until installed at a declared image or development path. The image face remains fixed, so the same generated artifact can be installed in the image. A moved development checkout must rebuild its artifact; no runtime path override is introduced. This build-owned declaration prevents deriving trust from an arbitrary module URL parent or mutable launch cwd. Migrate existing ownership callsites/tests to the declaration without old baseRoot aliases. Do not broaden ownership to the whole repository, `/opt/air`, workspaces, caches or moduleURL parents.

### Context-free owned-module observation

Introduce a deployment-specific physical observation value rather than overloading `CanonicalTarget`: selected artifact and canonical root, link-free component evidence, root and file dev/ino identities, file metadata replacement fingerprint, deployment/source ownership posture, accepted resource generation and current registry epoch. Types cannot implicitly convert this observation to session read/write/destructive authority.

Reuse the existing canonical identity/containment decision from `discovery-guard.ts` and filesystem ownership helpers. Extract its deployment-relevant comparison into the existing canonical policy so it can consume a module observation without session-role requirements. The producer uses the pinned Bun host's supported `node:fs` `lstatSync` and `realpathSync` surfaces, following the runtime-portable metadata-reader pattern already in `read-replacement.ts`; no `Deno`-only call runs under Bun. Add only the observer facade necessary for this producer, not another lexical ownership algorithm.

At initialization record the declared root and exact loaded regular-file identities after link-free containment and the declared image/development ownership checks. At each roster observation reobserve and compare against that accepted anchor, including metadata fingerprint against inode reuse; do not replace the anchor with whatever is present now. Missing metadata, absent declaration, wrong module URL, symlink/alias escape, hard-linked artifact, identity/replacement changes or stale generation deny. Observe the module root and its relative component ladder, never only the final file. Keep the permitted typebox/native dependency closure explicit under the existing host-facade packaging contract; no workspace package-cache closure is added.

Image identity comes from the existing root-owned non-agent-writable extension directory and artifact. Real development identity comes from the existing trusted canonical checkout/build workflow: the bundled exact development declaration, canonical root and loaded regular-file identities are physically observed and anchored, with owner/mode recorded and group/other-writable or unowned substitution rejected. Do not pretend the normal developer-owned artifact is root-owned or introduce a mandatory new read-only mount. Developer writability is not a claim of image immutability: later root/file replacement or metadata movement denies against the anchor, while trusted developer rebuilds require a fresh launch. Fixtures reproduce these actual image versus source-owned-development postures rather than fabricating read-only metadata. No changes to sandbox mounts or egress are authorized.

### Preserve origins and completion

The fresh direct native roster yields each replacement's real extension `sourceInfo.path`. It must equal the accepted loaded artifact, with matching epoch/generation and exact declaration. Carry the complete module declaration/observation through the pure provenance evaluator rather than dropping the accepted closure identity. Never relabel the replacement as builtin, admit by tool name or use a name-only `registeredOwned` flag as evidence.

Successful provenance then reaches existing completion. HTTP(S) read uses the owned adapter, each hop's classified destination and controlled transport; unsupported schemes and final denied addresses remain blocked. `web_search` uses the existing selected backend/credential probe and host/credential policy; no native provider fallback or new backend. Owned `skill://` read uses its separate exact instruction-root authorization then supported same-tool delegation with the original URI, with no path substitution. Ordinary local read delegates unchanged to the native reader under issue 1's accepted native approval/ambient-OS posture, with no fabricated daemon filesystem grant.

The default exported factory produces module evidence itself, without a fixture-injected `sessionContext`. Native read and web_search must reach transport/backend admission in production-shaped tests with no session filesystem context. Destructive calls lacking their separate trusted complete context still deny.

## Risks / Trade-offs

Physical evidence proves declared deployment ownership, not that the official host loaded the extension or invokes every callback. Keep that runtime result UNVERIFIED. Registration-time sourcePath is not authority alone; it must agree with the anchored loaded module and exclusion posture. A changed module or failed observation denies rather than inventing a new trusted generation. Source-owned development does not acquire the image's stronger immutable-source guarantee.

## Migration Plan

Clean cutover the owned-extension provenance payload and every canonical verifier consumer/fixture. Update the existing `scripts/omp/bundle-extension.ts` transform to emit the declaration from trusted build inputs, keeping emitted-edge auditing, locked dependencies and manifest coverage. No independently edited mirror, new public field or runtime environment selector is added. Update OMP_ENFORCEMENT, OMP_DISCOVERY, OMP_NETWORK, skill-URI documentation and CHANGELOG with module-versus-session evidence and accepted native local-IO residual risk. Budget: observer/verifier 2.5h, factory/provenance/completion wiring 2h, focused fixtures 2h, build declaration/docs/manifest input update 1.5h.

## Verification Plan

Use the default factory with direct roster and real-extension metadata, no api.ctx and no injected canonical target. Test image artifact with per-spawn workspace-derived state cwd, image artifact with pooled repository-derived state cwd, and the declared development generated bundle with a different state root. Temporary filesystem observations or realistic metadata-reader fixtures must anchor actual declared artifact/root identities and mutation snapshots, not synthetic session-role targets.

Require owned URL read to enter existing transport, owned search to enter configured backend and fail correctly without credentials, and owned skill URI to reach its separate guard. Cover module/root substitution, symlink and hardlink, missing declaration, violations of image or developer ownership/mode posture, stale epoch/generation, foreign same-name registration, changed inode/fingerprint and incomplete destructive context. Ordinary developer-owned writability remains permitted as described above. Denials perform no network/native delegation. Preserve cancelled readiness, YOLO no registration, existing sandbox/egress and LSP scope.
