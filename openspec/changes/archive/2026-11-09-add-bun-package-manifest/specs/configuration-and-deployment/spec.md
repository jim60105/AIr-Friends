# Spec Delta

## REMOVED Requirements

### Requirement: Deno Runtime with Explicit Permissions
**Reason**: The application runtime becomes Bun, which has no permission flags. Startup flags for Bun (`--no-env-file` and an explicit config file) are defined by the `bun-toolchain` scripts and the container command.
**Migration**: Start the application with `bun run start` (development) or the container command. No permission flags exist to configure.

### Requirement: Deno Project Structure
**Reason**: `deno.json` and `deno.lock` are replaced by `package.json`, `bun.lock`, `bunfig.toml` and `tsconfig.json`.
**Migration**: See the `bun-toolchain` capability for dependency installation and path aliases, and `adopt-dprint-oxlint-and-tsc` for formatting, linting and type checking.
