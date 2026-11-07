# Migration material

`migration/bun/` holds the records and proof-of-concept material for the Deno-to-Bun
runtime migration. It is not part of the product: nothing in `src/` imports it, it is
not bundled into the image, and it can be deleted after a No-Go decision without
affecting the application.

## `migration/bun/baseline/`

Captures the Deno-era reference point that the migration is measured against and
records the deployed image as a rollback reference. Records live in
`migration/bun/baseline/records/`.

```bash
cd migration/bun/baseline
bun run --no-env-file capture.ts    # re-capture; refuses a drifted tree
bun run --no-env-file validate.ts   # prints `valid` or `invalid` with problems
bun test ./baseline.spec.ts         # tool tests
```

Tests use the `.spec.ts` suffix because bare `deno test` discovers `*_test.ts`,
`*.test.ts` and `test.ts` anywhere in the repository, including here, while
`bun test` matches `*.spec.ts`.
