export const POC_PINS = {
  bunVersion: "1.4.2",
  bunRevisionPrefix: "744846f84",
  baseImageDigest: "sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73",
  opencodeVersion: "1.18.21",
  ompVersion: "18.6.1",
} as const;
export const PRODUCT_SOURCES = [
  "src/acp/filesystem-access-linux.ts",
  "src/acp/command-syntax.ts",
  "src/utils/ssrf.ts",
] as const;
