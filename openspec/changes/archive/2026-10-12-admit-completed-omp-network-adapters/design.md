# Design

## Context

The inventory distinguishes pending adapters from ordinary allows. Fetch and search route owners now supply completion data, but the composer rejects the entire pending disposition before consulting it. C4 makes the callback native; C1 removes the obsolete public-search contract.

## Goals / Non-Goals

**Goals:** Admit completed controlled replacements without weakening inventory, provenance, or per-hop egress policy.

**Non-Goals:** Treat a marker string as authorization, add a provider, permit arbitrary native fetch, or change unrestricted-egress/YOLO posture.

## Decisions

1. Keep inventory/provenance admission first. For a network-gated verdict, consult the corresponding typed completion decision from the existing route owner. Require the registered owned replacement and the exact completed route. Missing adapter or route denies with the existing bounded pending reason.
2. URL read uses the controlled read-URL route set. Web search uses the existing backend selection and credential-presence predicate; never read or log secret values in an admission result. No supported backend means a bounded capability error and zero requests, including under unrestricted egress.
3. Admission returns the completing transport authority, never plain allow. Execution remains in C2's registered replacement and performs the existing redirect/secondary-hop checks. Do not have both the callback and replacement dispatch a request, and do not retry through native transport on error.
4. Modify the existing URL-fetch route enumeration and both seam-completion requirements after C1. Remove permanent assertions that every search route remains pending and byte/marker-copy tests. Assert observable admission, zero-dispatch denial, route agreement, attribution, and honest transport failure instead.

## Risks / Trade-offs

- [An owned marker is applied to a foreign same-name tool] → Native origin admission must precede completion consumption; cover shadowed read/search registrations.
- [Search availability changes mid-session] → Consult current trusted backend availability for each call, not a session-start boolean.
- [Completion bypasses SSRF] → Drive allowed public hops and rejected redirect/secondary private hops through the real composer and controlled mock transport.

## Migration Plan

Apply/archive after C1/C4 and before C6's shared replacement edits. Rebuild/recut and update network/checklist/changelog text. No public configuration migration. Budget: decision composition 2.5h, behavior smoke 1.5h, docs/digests 1.0h, total 5.0h. Native traffic observation remains user-owned.
