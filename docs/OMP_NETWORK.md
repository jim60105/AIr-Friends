# OMP Network Egress

The project-owned per-hop fetch adapter and the extension-registered `read` /
`web_search` replacement tools were deleted by the native-runtime cutover.
Restricted OMP sessions use the NATIVE `read` tool (local and URL) and the
native `web_search` tool again. There is no route table, transport adapter,
replacement registration, skill-URI authorization branch or per-hop decision
record any more; what governs egress is the shared deployment posture below,
applied by the native network stacks themselves.

## Native tools restored

`read` and `web_search` are native OMP tools. Restricted sessions admit both
names through the restricted capability inventory
(`src/acp/omp/tool-inventory.ts`), which blocks every unmapped tool name before
dispatch; see [`OMP_TOOL_POLICY.md`](OMP_TOOL_POLICY.md). Native-YOLO sessions
register no capability extension at all.

## Shared egress posture (unchanged)

This is the pre-existing F14 posture; the cutover did not change it. Full
semantics, the allowlist and the residual-gap honesty table live in
[`AGENT_PERMISSIONS.md`](AGENT_PERMISSIONS.md).

- **Default**: `sandbox.egressProxy: true` routes agent egress through the local
  validating forward proxy (`src/utils/egress-proxy.ts`), which reuses the
  `src/utils/ssrf.ts` rule set at the actual egress point — public destinations
  allowed, loopback / RFC1918 / link-local / unique-local / unspecified /
  multicast / cloud-metadata targets rejected, DNS answers validated.
- **`unrestrictedEgress: true`** is the explicit operator opt-in to raw,
  unmediated egress for trusted deployments that accept the SSRF risk.
- **Nothing configured** → the daemon fails closed rather than granting open
  egress.
- The launch points env-honoring clients at the proxy through
  `HTTP_PROXY`/`HTTPS_PROXY` plus a loopback `NO_PROXY`/`no_proxy`
  (`localhost,127.0.0.1,::1`, plus any operator `egressAllowHosts`). This
  env-var routing is a best-effort convenience layer, NOT a hard boundary: a
  client that ignores it escapes mediation, and the loopback carve-out is
  host-wide, not limited to the Skill API port.
- The daemon-side `safeFetch` SSRF guard is unchanged.

## Supported credentials

Exactly two provider credentials are supported for OMP: `GEMINI_API_KEY` (the
Gemini provider, id `google`) and `OPENROUTER_API_KEY`. They are the only
agent-type credentials the shared environment filter admits for OMP; no other
provider secret is passed.

## Authored provider header

`agent-config/omp/models.yml` (installed VERBATIM at the native config path
`~/.omp/agent/models.yml`) keeps `providers.openrouter.headers.X-Title:
AIr-Friends`.

## Pinned-source note: identity headers configuration cannot override

At the pin, native OMP builds its OpenRouter request identity headers itself:
`getOpenRouterHeaders()` (`packages/ai/src/utils/openrouter-headers.ts`) sets
`HTTP-Referer` and `X-OpenRouter-Title`, and they override the model/config
header map in `packages/ai/src/providers/openai-shared.ts`. This is pinned-source
evidence about the upstream binary — it is NOT a claim that this deployment
preserved or configured any of those headers. Only the authored `X-Title` rides
the supported header surface.

## Upstream-owned result differences

Native URL reads and native web search are upstream behaviours. Their result
shapes, provider selection, retry/redirect handling and error strings are owned
upstream and may differ from OpenCode's and from the removed adapters.

**Partly exercised.** The pinned-binary scripted-model suite
(`tests/integration/omp-native-runtime/native-runtime.integration.test.ts`,
[OMP_SPAWN.md](OMP_SPAWN.md) §7) drove a real native URL read against a fixed
LOOPBACK server and a real native `web_search` dispatch in both modes, recording
the ACTUAL provider outcome. Those are native-dispatch observations with a
scripted model and a loopback endpoint only: they prove the native tools run and
reach a result, NOT proxy-mediated egress, public-search backend success or
ranking, or platform delivery — those remain user-owned and unverified. The tool
mapping above and the shared egress posture stay source observations.

---

## Related Documentation

- [Agent Permissions Specification — F14 egress mediation (`docs/AGENT_PERMISSIONS.md`)](AGENT_PERMISSIONS.md)
- [OMP Restricted Tool Policy (`docs/OMP_TOOL_POLICY.md`)](OMP_TOOL_POLICY.md)
- [OMP Configuration Discovery (`docs/OMP_DISCOVERY.md`)](OMP_DISCOVERY.md)

> Runtime verification for this area is consolidated in the single checklist
> artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md).
