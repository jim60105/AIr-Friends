import { resolve } from "node:path";
import { validateBaselineDir } from "./records-schema.ts";

const recordsDir = process.argv[2] ?? resolve(import.meta.dir, "records");
const { state, problems } = validateBaselineDir(recordsDir);

console.log(state);
for (const problem of problems) console.log(`- ${problem}`);

process.exit(state === "valid" ? 0 : 1);
