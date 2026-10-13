/**
 * Generated OMP skill-root declaration (`align-omp-skill-trust-to-shared-root`
 * task 3.1): single-key content, the symlink-refusing unconditional overwrite,
 * and the fail-closed write surface. The parsed content is validated against
 * the daemon's RESOLVED root by `assertOwnedSettingsDocument` — a value that no
 * constant, default or fallback can supply.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  ompSkillRootDeclarationContent,
  writeOmpSkillRootDeclaration,
} from "../../src/acp/omp/skill-root-declaration.ts";
import { assertOwnedSettingsDocument } from "../../src/acp/omp-settings.ts";

const ROOT = "/srv/deployment/shared-skills";

Deno.test("declaration content - exactly one key holding the resolved root", () => {
  const document = parseYaml(ompSkillRootDeclarationContent(ROOT)) as Record<string, unknown>;
  assertEquals(Object.keys(document), ["skills"]);
  assertEquals(document["skills"], { customDirectories: [ROOT] });
  // It validates against that root in both modes, and against no other root.
  assertOwnedSettingsDocument(document, "restricted", [ROOT]);
  assertOwnedSettingsDocument(document, "native-yolo", [ROOT]);
  assertThrows(
    () => assertOwnedSettingsDocument(document, "restricted", ["/other/skills"]),
    Error,
    "exactly declare the resolved skill root",
  );
  // A relative, empty or multi-line value never renders: there is no
  // default-falling-back key and no relative spelling.
  assertThrows(() => ompSkillRootDeclarationContent("relative/skills"), Error, "absolute path");
  assertThrows(() => ompSkillRootDeclarationContent(""), Error, "empty or malformed");
  assertThrows(
    () => ompSkillRootDeclarationContent(`${ROOT}\nskills:`),
    Error,
    "empty or malformed",
  );
});

Deno.test("declaration content - a YAML-significant resolved root round-trips exactly", () => {
  // The root is serialized as a quoted YAML scalar: a legitimate canonical
  // directory containing `#`, `: `, spaces or a quote must parse back to the
  // same string and validate against it, never become a comment or another type.
  for (
    const root of [
      "/srv/shared # skills",
      "/srv/skills: prod",
      "/srv/dir with space/skills",
      '/srv/quote"dir/skills',
      "/srv/tab\tdir/skills",
    ]
  ) {
    const document = parseYaml(ompSkillRootDeclarationContent(root)) as Record<string, unknown>;
    assertEquals(document["skills"], { customDirectories: [root] }, root);
    assertOwnedSettingsDocument(document, "restricted", [root]);
  }
});

Deno.test("declaration carrier - the wrong carrier shape never validates", () => {
  // A declaration missing the key, carrying a second entry, or carrying a
  // non-absolute/non-canonical root rejects against the resolved root.
  assertThrows(
    () => assertOwnedSettingsDocument({}, "restricted", [ROOT]),
    Error,
    "exactly declare the resolved skill root",
  );
  assertThrows(
    () =>
      assertOwnedSettingsDocument(
        { skills: { customDirectories: [ROOT, "/srv/second"] } },
        "restricted",
        [ROOT],
      ),
    Error,
    "exactly declare the resolved skill root",
  );
  assertThrows(
    () =>
      assertOwnedSettingsDocument(
        { skills: { customDirectories: ["relative/skills"] } },
        "restricted",
        ["relative/skills"],
      ),
    Error,
    "exactly declare the resolved skill root",
  );
  assertThrows(
    () =>
      assertOwnedSettingsDocument(
        { skills: { customDirectories: ["/srv/skills/../skills"] } },
        "restricted",
        ["/srv/skills/../skills"],
      ),
    Error,
    "exactly declare the resolved skill root",
  );
  // An authored mode document (carrier `null`) must declare NO directory, even
  // when the directory it declares is the resolved root.
  assertThrows(
    () =>
      assertOwnedSettingsDocument(
        { skills: { enabled: true, customDirectories: [ROOT] } },
        "restricted",
        null,
      ),
    Error,
    "must declare no skill directory",
  );
});

Deno.test("declaration write - overwrites unconditionally and refuses links, non-files and non-canonical paths", async () => {
  const baseRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "omp-declaration-" }));
  const declarationPath = `${baseRoot}/omp-overlays/restricted-skill-root.yml`;
  try {
    // Creates the directory and the document.
    writeOmpSkillRootDeclaration(declarationPath, ROOT);
    assertEquals(Deno.readTextFileSync(declarationPath), ompSkillRootDeclarationContent(ROOT));

    // Unconditional overwrite: a stale (pooled) document is REPLACED, never
    // merged, so a later launch can never inherit an earlier resolved root.
    Deno.writeTextFileSync(declarationPath, "skills:\n  customDirectories:\n    - /stale\n");
    writeOmpSkillRootDeclaration(declarationPath, "/srv/deployment/other-skills");
    assertEquals(
      Deno.readTextFileSync(declarationPath),
      ompSkillRootDeclarationContent("/srv/deployment/other-skills"),
    );

    // A symlinked TARGET refuses: the write never follows a planted link.
    Deno.removeSync(declarationPath);
    Deno.symlinkSync("/etc/hostname", declarationPath);
    assertThrows(
      () => writeOmpSkillRootDeclaration(declarationPath, ROOT),
      Error,
      "link or not a regular file",
    );
    Deno.removeSync(declarationPath);

    // A non-canonical spelling refuses before any filesystem effect.
    assertThrows(
      () => writeOmpSkillRootDeclaration(`${baseRoot}/omp-overlays/../elsewhere.yml`, ROOT),
      Error,
      "absolute canonical path",
    );

    // A symlinked declaration DIRECTORY refuses (no write through a relocated
    // parent), and a directory target refuses too.
    Deno.removeSync(`${baseRoot}/omp-overlays`);
    Deno.mkdirSync(`${baseRoot}/elsewhere`);
    Deno.symlinkSync(`${baseRoot}/elsewhere`, `${baseRoot}/omp-overlays`);
    assertThrows(
      () => writeOmpSkillRootDeclaration(declarationPath, ROOT),
      Error,
      "directory is a link or not a directory",
    );
    Deno.removeSync(`${baseRoot}/omp-overlays`);
    Deno.mkdirSync(declarationPath, { recursive: true });
    assertThrows(
      () => writeOmpSkillRootDeclaration(declarationPath, ROOT),
      Error,
      "link or not a regular file",
    );
  } finally {
    await Deno.remove(baseRoot, { recursive: true });
  }
});
