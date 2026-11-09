// Type-only companion for the JS native-extension fixture. The fixture is
// loaded by URL at run time; TypeScript cannot infer its exports.
export const PARITY_UNKNOWN_TOOLS: {
  readonly direct: Readonly<{ name: string; marker: string; loadMode: string }>;
  readonly mounted: Readonly<{ name: string; marker: string; loadMode: string }>;
  readonly markerDirectory: string;
};

export function parityMarkerPath(cwd: string, marker: string): string;
