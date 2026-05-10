## Why

AIr-Friends does not call the Kubernetes API, so the default ServiceAccount token projected into every Pod is unnecessary attack surface. By defaulting `serviceAccount.create: false` and `automountServiceAccountToken: false`, we reduce the blast radius of any Pod compromise.

## What Changes

- Add `serviceAccount` section to `helm/values.yaml` with `create: false`, `name: ""`, `automount: false`, and `annotations: {}`
- Add optional ServiceAccount template `helm/templates/serviceaccount.yaml` rendered only when `serviceAccount.create: true`
- Set `automountServiceAccountToken: false` on the Pod spec in `helm/templates/deployment.yaml`
- Wire `serviceAccountName` in the Pod spec from the new helper

## Capabilities

### New Capabilities
- `helm-service-account-security`: Helm chart ServiceAccount configuration with secure defaults — `create: false` and token automount disabled by default.

### Modified Capabilities

## Impact

- `helm/values.yaml` — new `serviceAccount` block
- `helm/templates/deployment.yaml` — Pod spec gains `serviceAccountName` and `automountServiceAccountToken`
- `helm/templates/serviceaccount.yaml` — new optional template
- `helm/templates/_helpers.tpl` — new helper `air-friends.serviceAccountName`
- No application code changes required
