# Tasks

Prerequisite: `rename-deno-runtime-identifiers` is applied and `podman` works rootless. Verify with `! grep -rq '/home/deno' src agent-config && podman info >/dev/null`.

Do not change OpenCode, OMP, Node.js or `dumb-init` versions or checksums.

## 1. Image

- [ ] 1.1 Apply design D1 and D2 to `Containerfile` and remove `.deno/` from `.containerignore`. Verify: `grep -niE 'deno' Containerfile .containerignore` prints nothing, and `podman build --target final -t air-friends:bun-local .` exits 0.
- [ ] 1.2 Copy the seccomp profile and create `tests/image/Containerfile` per design D3. Verify: `podman build -f tests/image/Containerfile --build-arg IMAGE=localhost/air-friends:bun-local -t air-friends:bun-test .` exits 0.

## 2. Smoke

- [ ] 2.1 Write `scripts/image-smoke.sh` per design D4. Verify: `sh scripts/image-smoke.sh localhost/air-friends:bun-local localhost/air-friends:bun-test` exits 0 and prints `ok` for all six checks; paste the output into the task report (P0-4 seccomp, P0-7, P0-9 amd64 evidence).
- [ ] 2.2 Confirm the immutability check can fail. Verify: `printf 'FROM localhost/air-friends:bun-local\nUSER 0\nRUN chown 1000 /opt/air\nUSER 1000\n' | podman build -t air-friends:bun-neg -f - . && sh scripts/image-smoke.sh --only skill-config localhost/air-friends:bun-neg localhost/air-friends:bun-test; echo "exit=$?"; podman rmi air-friends:bun-neg` prints a non-zero `exit=`.

## 3. Compose

- [ ] 3.1 Run the daemon the way `compose.yml` does, without platform credentials. Verify: `podman run -d --name air-bun-smoke --user 1000:0 --cap-drop ALL --security-opt no-new-privileges -e ENV=production localhost/air-friends:bun-local`, then within 30 s `podman logs air-bun-smoke` shows the `Bun version` line with `1.4.2` and no `Cannot find module`, `EACCES` or `ReferenceError` line; `time podman stop -t 15 air-bun-smoke` returns in under 15 s; `podman rm air-bun-smoke`. Paste the first 20 log lines.

## 4. Housekeeping

- [ ] 4.1 Verify: `git status --porcelain` lists only `Containerfile`, `.containerignore`, `scripts/image-smoke.sh`, `tests/image/Containerfile`, `tests/fixtures/seccomp/deny-openat2.json` and this change directory.
