# Spec Delta

## ADDED Requirements

### Requirement: Controlled Transport DNS Runs in the Native Runtime

Controlled URL-read and web-search DNS SHALL execute through a resolver available in the pinned native runtime. It SHALL retain literal-IP handling, collect available IPv4/IPv6 answers, and fail closed on an empty or unresolvable address set. Every resulting request, redirect, and secondary hop SHALL use the existing shared SSRF classifier and selected egress posture. A missing Deno global SHALL NOT disable otherwise supported public-host resolution.

#### Scenario: One address family has no records
- **WHEN** a public hostname has valid answers in one family and a no-record response in the other
- **THEN** its available answers SHALL reach the existing address-policy decision
- **AND** the no-record response SHALL NOT discard the valid family

#### Scenario: Empty or private resolution remains denied
- **WHEN** resolution yields no usable addresses or prohibited private addresses under enforcing egress
- **THEN** the existing transport SHALL deny before endpoint dispatch
- **AND** no unvalidated DNS fallback SHALL execute

#### Scenario: Native URL read and search share resolution policy
- **WHEN** the two controlled tools resolve fixture hosts without a Deno runtime global
- **THEN** both SHALL use the supported resolver and the same existing address-policy decisions
- **AND** neither SHALL fabricate an empty successful result on resolution failure
