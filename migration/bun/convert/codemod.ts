// migration/bun/convert/codemod.ts

/**
 * Deno-to-Bun rewrite codemod for step 4 of the runtime migration.
 *
 * The rewrite scope is exactly the call-shape table in
 * `migration/bun/convert/README.md` (design D3). The high-risk symbol set
 * (design D4) is never rewritten: it is reported so the owning change ports it
 * by hand.
 *
 * Usage:
 *   bun run --no-env-file migration/bun/convert/codemod.ts [--check] [--no-src-helpers] <file>...
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import ts from "typescript";

export interface ManualEntry {
  line: number;
  text: string;
  reason: string;
}

export interface ConvertOptions {
  /** When false, every rewrite that needs a `src/` helper is reported instead. */
  srcHelpers?: boolean;
}

export interface ConvertResult {
  /** Rewritten source; identical to the input when `refused` is non-empty. */
  code: string;
  /** Number of Deno call/type/import rewrites applied (inserted imports excluded). */
  rewrites: number;
  manual: ManualEntry[];
  /** Non-empty when the file was left unchanged (name collision, parse error, non-convergence). */
  refused: string[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

type BindingKind =
  | "fs"
  | "fsp"
  | "test"
  | "Stats"
  | "Dirent"
  | "fsCompat"
  | "runtimePlatform";

interface Needs {
  fs: boolean;
  fsp: boolean;
  test: boolean;
  types: Set<string>;
  fsCompat: Set<string>;
  runtimePlatform: Set<string>;
  /** node:url imported name -> local name, e.g. `fileURLToPath` -> `fromFileUrl`. */
  url: Map<string, string>;
}

interface AnalysisContext {
  mode: "apply" | "diagnose";
  sourceFile: ts.SourceFile;
  options: Required<ConvertOptions>;
  fileName: string;
  edits: Edit[];
  rewrites: number;
  needs: Needs;
  refusals: Set<string>;
  manual: ManualEntry[];
  explained: Edit[];
  extraManual: ManualEntry[];
  typeRewritten: boolean;
}

const D4_SYMBOLS: Record<string, true> = {
  "Deno.Command": true,
  "Deno.CommandStatus": true,
  "Deno.ChildProcess": true,
  "Deno.serve": true,
  "Deno.HttpServer": true,
  "Deno.ServeHandlerInfo": true,
  "Deno.kill": true,
  "Deno.pid": true,
  "Deno.addSignalListener": true,
  "Deno.removeSignalListener": true,
  "Deno.exit": true,
  "Deno.args": true,
  "Deno.version": true,
  "Deno.connect": true,
  "Deno.listen": true,
  "Deno.Conn": true,
  "Deno.TcpConn": true,
  "Deno.NetAddr": true,
  "Deno.Listener": true,
  "Deno.resolveDns": true,
  "Deno.listenDatagram": true,
  "Deno.DatagramConn": true,
  "Deno.dlopen": true,
  "Deno.DynamicLibrary": true,
  "Deno.UnsafePointer": true,
  "Deno.UnsafePointerView": true,
  "Deno.open": true,
  "Deno.FsFile": true,
};

const NODE_PATH_NAMES: Record<string, true> = {
  join: true,
  resolve: true,
  dirname: true,
  isAbsolute: true,
  basename: true,
  relative: true,
  normalize: true,
  extname: true,
};

const STATS_PROPERTIES: Record<string, true> = {
  isFile: true,
  isDirectory: true,
  isSymlink: true,
};
const TIMESTAMP_PROPERTIES: Record<string, true> = {
  mtime: true,
  atime: true,
  birthtime: true,
};
const ITERATOR_MEMBERS: Record<string, true> = { next: true, return: true, throw: true };
const TEMP_HELPERS: Record<string, string> = {
  "Deno.makeTempDir": "makeTempDir",
  "Deno.makeTempDirSync": "makeTempDirSync",
  "Deno.makeTempFile": "makeTempFile",
  "Deno.makeTempFileSync": "makeTempFileSync",
};

const FILESYSTEM_CLASSIFIERS: Record<string, string> = {
  "Deno.errors.NotFound": "isNotFoundError",
  "Deno.errors.AlreadyExists": "isAlreadyExistsError",
  "Deno.errors.PermissionDenied": "isPermissionDeniedError",
};

const ASYNC_FILE_CALLS: Record<string, { name: string; args: number }> = {
  "Deno.stat": { name: "stat", args: 1 },
  "Deno.lstat": { name: "lstat", args: 1 },
  "Deno.realPath": { name: "realpath", args: 1 },
  "Deno.readLink": { name: "readlink", args: 1 },
  "Deno.rename": { name: "rename", args: 2 },
  "Deno.chmod": { name: "chmod", args: 2 },
  "Deno.copyFile": { name: "copyFile", args: 2 },
  "Deno.symlink": { name: "symlink", args: 0 },
};

const SYNC_FILE_CALLS: Record<string, { name: string; args: number }> = {
  "Deno.statSync": { name: "statSync", args: 1 },
  "Deno.lstatSync": { name: "lstatSync", args: 1 },
  "Deno.realPathSync": { name: "realpathSync", args: 1 },
  "Deno.readLinkSync": { name: "readlinkSync", args: 1 },
  "Deno.renameSync": { name: "renameSync", args: 2 },
  "Deno.chmodSync": { name: "chmodSync", args: 2 },
  "Deno.copyFileSync": { name: "copyFileSync", args: 2 },
  "Deno.symlinkSync": { name: "symlinkSync", args: 0 },
};

function emptyNeeds(): Needs {
  return {
    fs: false,
    fsp: false,
    test: false,
    types: new Set(),
    fsCompat: new Set(),
    runtimePlatform: new Set(),
    url: new Map(),
  };
}

function parseSource(text: string, fileName: string): ts.SourceFile {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
}

function parseErrors(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  const withDiagnostics = sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  };
  const diagnostics = withDiagnostics.parseDiagnostics;
  return Array.isArray(diagnostics) ? diagnostics : [];
}

/** The dotted property chain when it is rooted at the global `Deno` object. */
function denoChain(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text === "Deno" ? "Deno" : undefined;
  if (ts.isPropertyAccessExpression(node)) {
    const left = denoChain(node.expression);
    return left === undefined ? undefined : `${left}.${node.name.text}`;
  }
  if (ts.isQualifiedName(node)) {
    const left = denoChain(node.left);
    return left === undefined ? undefined : `${left}.${node.right.text}`;
  }
  return undefined;
}

function isDenoChain(node: ts.Node): boolean {
  return denoChain(node)?.startsWith("Deno") === true;
}

/** True when this Deno chain is the outermost node of its chain. */
function isOutermostDenoChain(node: ts.Node): boolean {
  const parent = node.parent;
  if (
    parent !== undefined &&
    ((ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
      (ts.isQualifiedName(parent) && parent.left === node))
  ) {
    return false;
  }
  return true;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) names.push(...bindingNames(element.name));
  }
  return names;
}

function importBindingNames(clause: ts.ImportClause): string[] {
  const names: string[] = [];
  if (clause.name !== undefined) names.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings !== undefined) {
    if (ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
    else names.push(...bindings.elements.map((element) => element.name.text));
  }
  return names;
}

/** Top-level (module-scope) names declared by non-import statements. */
function moduleDeclarationNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) names.add(name);
      }
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      if (statement.name !== undefined) names.add(statement.name.text);
    }
  }
  return names;
}

/** Local name -> module specifier for every top-level import binding. */
function importSources(sourceFile: ts.SourceFile): Map<string, string> {
  const sources = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
    const moduleName = statement.moduleSpecifier.getText(sourceFile).replace(/^["']|["']$/g, "");
    for (const name of importBindingNames(statement.importClause)) {
      sources.set(name, moduleName);
    }
  }
  return sources;
}

function statementDeclaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      bindingNames(declaration.name)
    );
  }
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  ) {
    return statement.name === undefined ? [] : [statement.name.text];
  }
  return [];
}

function functionOwnName(node: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    return node.name?.text;
  }
  return undefined;
}

function forInitializerNames(node: ts.Node): string[] {
  if (ts.isForStatement(node)) {
    const initializer = node.initializer;
    if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
      return initializer.declarations.flatMap((declaration) => bindingNames(declaration.name));
    }
  }
  if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    const initializer = node.initializer;
    if (ts.isVariableDeclarationList(initializer)) {
      return initializer.declarations.flatMap((declaration) => bindingNames(declaration.name));
    }
  }
  return [];
}

/**
 * Whether `name` is declared in a scope between `node` and the module scope.
 * A rewritten call must not resolve the identifier it starts to use to a local
 * binding: Node's `fs` object or `bun:test`'s `test` would be shadowed.
 */
function isShadowedBelowModule(node: ts.Node, name: string): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isBlock(current) || ts.isModuleBlock(current)) {
      for (const statement of current.statements) {
        if (statementDeclaredNames(statement).includes(name)) return true;
      }
    } else if (ts.isFunctionLike(current)) {
      if (functionOwnName(current) === name) return true;
      for (const parameter of current.parameters) {
        if (bindingNames(parameter.name).includes(name)) return true;
      }
    } else if (ts.isCatchClause(current)) {
      if (
        current.variableDeclaration !== undefined &&
        bindingNames(current.variableDeclaration.name).includes(name)
      ) {
        return true;
      }
    } else {
      if (forInitializerNames(current).includes(name)) return true;
    }
    current = current.parent;
  }
  return false;
}

function moduleSource(fileName: string, modulePath: string): string {
  const from = dirname(fileName === "" ? "." : fileName);
  const specifier = relative(from, modulePath).split("\\").join("/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function expectedModule(
  kind: BindingKind,
  fileName: string,
): string {
  switch (kind) {
    case "fs":
      return "node:fs";
    case "fsp":
      return "node:fs/promises";
    case "test":
      return "bun:test";
    case "Stats":
    case "Dirent":
      return "node:fs";
    case "fsCompat":
      return moduleSource(fileName, "src/utils/fs-compat.ts");
    case "runtimePlatform":
      return moduleSource(fileName, "src/utils/runtime-platform.ts");
  }
}

function isSrcHelperModule(kind: BindingKind): boolean {
  return kind === "fsCompat" || kind === "runtimePlatform";
}

function moduleMatches(kind: BindingKind, actual: string, expected: string): boolean {
  if (actual === expected) return true;
  if (isSrcHelperModule(kind)) {
    const tail = kind === "fsCompat" ? "src/utils/fs-compat.ts" : "src/utils/runtime-platform.ts";
    return actual.endsWith(tail) || actual === `@utils/${tail.slice("src/utils/".length)}`;
  }
  return false;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function nodeText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function addManual(
  context: AnalysisContext,
  node: ts.Node,
  reason: string,
  explainedNode: ts.Node = node,
): void {
  if (context.mode !== "diagnose") return;
  context.manual.push({
    line: lineOf(context.sourceFile, node),
    text: nodeText(context.sourceFile, node),
    reason,
  });
  context.explained.push({
    start: explainedNode.getStart(context.sourceFile),
    end: explainedNode.end,
    text: "",
  });
}

function addExtraManual(context: AnalysisContext, node: ts.Node, reason: string): void {
  context.extraManual.push({
    line: lineOf(context.sourceFile, node),
    text: nodeText(context.sourceFile, node),
    reason,
  });
}

function emitEdit(context: AnalysisContext, node: ts.Node, text: string, start?: number): void {
  context.rewrites += 1;
  if (context.mode !== "apply") return;
  context.edits.push({ start: start ?? node.getStart(context.sourceFile), end: node.end, text });
}

interface BindingCheck {
  ok: boolean;
  reason?: string;
}

function requireBinding(
  context: AnalysisContext,
  node: ts.Node,
  kind: BindingKind,
  localName?: string,
): BindingCheck {
  const name = localName ??
    (kind === "fs"
      ? "fs"
      : kind === "fsp"
      ? "fsp"
      : kind === "test"
      ? "test"
      : kind === "Stats"
      ? "Stats"
      : kind === "Dirent"
      ? "Dirent"
      : kind);

  if (isShadowedBelowModule(node, name)) {
    return { ok: false, reason: `${name} is shadowed at this usage` };
  }

  const expected = expectedModule(kind, context.fileName);
  const sources = importSources(context.sourceFile);
  const importedFrom = sources.get(name);
  if (importedFrom !== undefined) {
    if (moduleMatches(kind, importedFrom, expected)) return { ok: true };
    if (kind === "test") {
      return {
        ok: false,
        reason: `local test binding imported from "${importedFrom}" collides with bun:test`,
      };
    }
    context.refusals.add(
      `top-level binding "${name}" is imported from "${importedFrom}", which collides with "${expected}"`,
    );
    return { ok: false, reason: `${name} collides with an existing import` };
  }

  if (moduleDeclarationNames(context.sourceFile).has(name)) {
    if (kind === "test") {
      return {
        ok: false,
        reason: `local test binding collides with bun:test; convert this registration manually`,
      };
    }
    context.refusals.add(
      `top-level binding "${name}" collides with the import the codemod needs from "${expected}"`,
    );
    return { ok: false, reason: `${name} collides with a local binding` };
  }

  if (!context.options.srcHelpers && isSrcHelperModule(kind)) {
    return { ok: false, reason: "needs src/ helper (--no-src-helpers)" };
  }

  if (kind === "fs") context.needs.fs = true;
  else if (kind === "fsp") context.needs.fsp = true;
  else if (kind === "test") context.needs.test = true;
  else if (kind === "Stats" || kind === "Dirent") context.needs.types.add(kind);
  else if (kind === "fsCompat") context.needs.fsCompat.add(name);
  else context.needs.runtimePlatform.add(name);
  return { ok: true };
}

function requireFsCompat(context: AnalysisContext, node: ts.Node, name: string): BindingCheck {
  return requireBinding(context, node, "fsCompat", name);
}

function requireRuntime(context: AnalysisContext, node: ts.Node, name: string): BindingCheck {
  return requireBinding(context, node, "runtimePlatform", name);
}

function isObjectLiteral(node: ts.Expression): node is ts.ObjectLiteralExpression {
  return ts.isObjectLiteralExpression(node);
}

function propertyNameOf(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
    const name = property.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  }
  return undefined;
}

interface TestOptions {
  name?: ts.Expression;
  fn?: ts.Expression | ts.MethodDeclaration;
  ignore?: ts.Expression;
}

interface TestParse {
  ok: boolean;
  reason?: string;
  nameText?: string;
  fnText?: string;
  ignoreText?: string;
  skipRegistration?: boolean;
}

function functionParameterStep(node: ts.Expression | ts.MethodDeclaration): string | undefined {
  if (ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parameter = node.parameters[0];
    if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
    const parameterName = parameter.name.text;
    let found = false;
    const visit = (child: ts.Node): void => {
      if (found) return;
      if (
        ts.isCallExpression(child) &&
        ts.isPropertyAccessExpression(child.expression) &&
        child.expression.name.text === "step" &&
        ts.isIdentifier(child.expression.expression) &&
        child.expression.expression.text === parameterName
      ) {
        found = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found ? parameterName : undefined;
  }
  return undefined;
}

function methodAsFunction(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): string {
  const prefix = method.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    ? "async "
    : "";
  const parameters = method.parameters.map((parameter) => parameter.getText(sourceFile)).join(", ");
  return `${prefix}function (${parameters}) ${method.body?.getText(sourceFile) ?? "{}"}`;
}

function parseOptionsObject(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): { ok: true; options: TestOptions } | { ok: false; reason: string } {
  const options: TestOptions = {};
  for (const property of object.properties) {
    const name = propertyNameOf(property);
    if (name === undefined) {
      return {
        ok: false,
        reason: "Deno.test options contain a spread or computed property",
      };
    }
    if (name === "name") {
      if (!ts.isPropertyAssignment(property)) {
        return { ok: false, reason: "unsupported Deno.test name option" };
      }
      options.name = property.initializer;
    } else if (name === "fn") {
      if (ts.isPropertyAssignment(property)) options.fn = property.initializer;
      else if (ts.isMethodDeclaration(property)) options.fn = property;
      else return { ok: false, reason: "unsupported Deno.test fn option" };
    } else if (name === "ignore") {
      if (!ts.isPropertyAssignment(property)) {
        return { ok: false, reason: "unsupported Deno.test ignore option" };
      }
      options.ignore = property.initializer;
    } else if (name === "sanitizeOps" || name === "sanitizeResources") {
      continue;
    } else {
      return { ok: false, reason: `unsupported Deno.test option "${name}"` };
    }
  }
  return { ok: true, options };
}

function fnTextOf(
  fn: ts.Expression | ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
): string {
  return ts.isMethodDeclaration(fn) ? methodAsFunction(fn, sourceFile) : fn.getText(sourceFile);
}

function parseTestRegistration(
  call: ts.CallExpression,
  skip: boolean,
  sourceFile: ts.SourceFile,
  displayName: string,
): TestParse {
  const args = call.arguments;
  if (args.length === 1 && isObjectLiteral(args[0])) {
    const parsed = parseOptionsObject(args[0], sourceFile);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const { name, fn, ignore } = parsed.options;
    if (name === undefined) return { ok: false, reason: "Deno.test object form has no name" };
    if (fn === undefined) return { ok: false, reason: "Deno.test object form has no fn" };
    const parameter = functionParameterStep(fn);
    if (parameter !== undefined) {
      return {
        ok: false,
        reason: `t.step uses "${parameter}.step"; convert to describe/test (D5)`,
      };
    }
    return {
      ok: true,
      nameText: name.getText(sourceFile),
      fnText: fnTextOf(fn, sourceFile),
      ignoreText: skip ? undefined : ignore?.getText(sourceFile),
      skipRegistration: skip,
    };
  }

  if (args.length === 2 || args.length === 3) {
    const name = args[0];
    const nameIsLiteral = ts.isStringLiteralLike(name) || ts.isTemplateExpression(name);
    if (!nameIsLiteral) {
      return { ok: false, reason: `Deno.test name in ${displayName} is not a string or template literal` };
    }
    let fn: ts.Expression;
    let ignoreText: string | undefined;
    if (args.length === 2) {
      fn = args[1];
    } else {
      const options = args[1];
      if (!isObjectLiteral(options)) {
        return { ok: false, reason: "Deno.test options argument is not an object literal" };
      }
      const parsed = parseOptionsObject(options, sourceFile);
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      if (parsed.options.fn !== undefined) {
        return { ok: false, reason: "Deno.test options argument declares fn" };
      }
      ignoreText = parsed.options.ignore?.getText(sourceFile);
      fn = args[2];
    }
    const parameter = functionParameterStep(fn);
    if (parameter !== undefined) {
      return {
        ok: false,
        reason: `t.step uses "${parameter}.step"; convert to describe/test (D5)`,
      };
    }
    return {
      ok: true,
      nameText: name.getText(sourceFile),
      fnText: fn.getText(sourceFile),
      ignoreText: skip ? undefined : ignoreText,
      skipRegistration: skip,
    };
  }

  return { ok: false, reason: "unsupported Deno.test argument shape" };
}

function handleTestCall(
  context: AnalysisContext,
  call: ts.CallExpression,
  skip: boolean,
): boolean {
  const { sourceFile } = context;
  const displayName = denoChain(call.expression) ?? "Deno.test";
  const parsed = parseTestRegistration(call, skip, sourceFile, displayName);
  if (!parsed.ok) {
    addManual(context, call, parsed.reason ?? "unsupported Deno.test registration", call.expression);
    return false;
  }
  const binding = requireBinding(context, call, "test");
  if (!binding.ok) {
    addManual(context, call, binding.reason ?? "test binding unavailable", call.expression);
    return false;
  }
  const callee = parsed.skipRegistration === true
    ? "test.skip"
    : parsed.ignoreText !== undefined
    ? `test.skipIf(${parsed.ignoreText})`
    : "test";
  emitEdit(context, call, `${callee}(${parsed.nameText}, ${parsed.fnText})`);
  return true;
}

function objectHasOnlyOption(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  if (object.properties.length !== 1) return undefined;
  const property = object.properties[0];
  if (!ts.isPropertyAssignment(property)) return undefined;
  if (propertyNameOf(property) !== name) return undefined;
  return property.initializer;
}

function hasHazardousConsumer(
  call: ts.CallExpression,
  members: Record<string, true>,
): boolean {
  const parent = call.parent;
  return ts.isPropertyAccessExpression(parent) &&
    parent.expression === call &&
    parent.name.text in members;
}

function isSpreadOf(call: ts.CallExpression): boolean {
  return ts.isSpreadElement(call.parent) || ts.isSpreadAssignment(call.parent);
}

function handleFileCall(
  context: AnalysisContext,
  call: ts.CallExpression,
  chain: string,
  sync: boolean,
): boolean {
  const entry = (sync ? SYNC_FILE_CALLS : ASYNC_FILE_CALLS)[chain];
  if (entry === undefined) return false;
  const bindingName: BindingKind = sync ? "fs" : "fsp";
  const isSymlink = chain.endsWith("symlink") || chain.endsWith("symlinkSync");
  const maximum = isSymlink ? 3 : entry.args;
  if (call.arguments.length < entry.args || call.arguments.length > maximum) {
    addManual(context, call, `unsupported ${chain} argument count`, call.expression);
    return false;
  }
  if (hasHazardousConsumer(call, ITERATOR_MEMBERS)) {
    addManual(
      context,
      call,
      `${chain} result is not an iterator under Node; convert this consumer manually`,
      call.expression,
    );
    return false;
  }
  if (isSpreadOf(call)) {
    addManual(
      context,
      call,
      `spread of the ${chain} result loses prototype methods and fields`,
      call.expression,
    );
    return false;
  }
  const binding = requireBinding(context, call, bindingName);
  if (!binding.ok) {
    addManual(context, call, binding.reason ?? `${bindingName} unavailable`, call.expression);
    return false;
  }
  const args = call.arguments.map((argument) => argument.getText(context.sourceFile));
  const isStat = chain.endsWith("stat") || chain.endsWith("statSync") ||
    chain.endsWith("lstat") || chain.endsWith("lstatSync");
  if (isStat) context.typeRewritten = true;
  if (isSymlink && args.length === 3) {
    addExtraManual(context, call, "symlink type argument dropped; verify the link kind");
    args.pop();
  }
  const target = sync ? `fs.${entry.name}` : `fsp.${entry.name}`;
  emitEdit(context, call, `${target}(${args.join(", ")})`);
  return true;
}

function handleCall(context: AnalysisContext, call: ts.CallExpression): boolean {
  const { sourceFile } = context;
  const chain = denoChain(call.expression);
  if (chain === undefined) return false;
  const args = call.arguments.map((argument) => argument.getText(sourceFile));

  if (chain === "Deno.test") return handleTestCall(context, call, false);
  if (chain === "Deno.test.ignore") return handleTestCall(context, call, true);

  switch (chain) {
    case "Deno.env.get": {
      if (args.length !== 1) break;
      emitEdit(context, call, `process.env[${args[0]}]`);
      return true;
    }
    case "Deno.env.set": {
      if (args.length !== 2) break;
      if (!ts.isExpressionStatement(call.parent)) {
        addManual(context, call, "Deno.env.set outside an expression statement", call.expression);
        return false;
      }
      emitEdit(context, call, `process.env[${args[0]}] = ${args[1]}`);
      return true;
    }
    case "Deno.env.delete": {
      if (args.length !== 1) break;
      if (!ts.isExpressionStatement(call.parent)) {
        addManual(context, call, "Deno.env.delete outside an expression statement", call.expression);
        return false;
      }
      emitEdit(context, call, `delete process.env[${args[0]}]`);
      return true;
    }
    case "Deno.env.has": {
      if (args.length !== 1) break;
      emitEdit(context, call, `Object.hasOwn(process.env, ${args[0]})`);
      return true;
    }
    case "Deno.env.toObject": {
      if (args.length !== 0) break;
      emitEdit(context, call, "{ ...process.env }");
      addExtraManual(context, call, "env values may be undefined");
      return true;
    }
    case "Deno.cwd": {
      if (args.length !== 0) break;
      emitEdit(context, call, "process.cwd()");
      return true;
    }
    case "Deno.execPath": {
      if (args.length !== 0) break;
      emitEdit(context, call, "process.execPath");
      return true;
    }
    case "Deno.readTextFile":
    case "Deno.readTextFileSync": {
      if (args.length !== 1) break;
      const sync = chain.endsWith("Sync");
      const binding = requireBinding(context, call, sync ? "fs" : "fsp");
      if (!binding.ok) {
        addManual(context, call, binding.reason ?? "binding unavailable", call.expression);
        return false;
      }
      emitEdit(context, call, sync ? `fs.readFileSync(${args[0]}, "utf8")` : `fsp.readFile(${args[0]}, "utf8")`);
      return true;
    }
    case "Deno.readFile":
    case "Deno.readFileSync": {
      if (args.length !== 1) break;
      const sync = chain.endsWith("Sync");
      const binding = requireBinding(context, call, sync ? "fs" : "fsp");
      if (!binding.ok) {
        addManual(context, call, binding.reason ?? "binding unavailable", call.expression);
        return false;
      }
      emitEdit(context, call, sync ? `fs.readFileSync(${args[0]})` : `fsp.readFile(${args[0]})`);
      return true;
    }
    case "Deno.writeTextFile":
    case "Deno.writeTextFileSync":
    case "Deno.writeFile":
    case "Deno.writeFileSync": {
      if (args.length < 2 || args.length > 3) {
        addManual(context, call, `unsupported ${chain} argument count`, call.expression);
        return false;
      }
      const sync = chain.endsWith("Sync");
      const target = sync ? "fs" : "fsp";
      const writeName = sync ? "writeFileSync" : "writeFile";
      const appendName = sync ? "appendFileSync" : "appendFile";
      if (args.length === 3) {
        const option = call.arguments[2];
        if (!isObjectLiteral(option)) {
          addManual(context, call, `${chain} options are not an object literal`, call.expression);
          return false;
        }
        const append = objectHasOnlyOption(option, "append");
        if (append !== undefined && append.kind === ts.SyntaxKind.TrueKeyword) {
          const binding = requireBinding(context, call, sync ? "fs" : "fsp");
          if (!binding.ok) {
            addManual(context, call, binding.reason ?? "binding unavailable", call.expression);
            return false;
          }
          emitEdit(context, call, `${target}.${appendName}(${args[0]}, ${args[1]})`);
          return true;
        }
        const mode = objectHasOnlyOption(option, "mode");
        if (mode !== undefined) {
          const binding = requireBinding(context, call, sync ? "fs" : "fsp");
          if (!binding.ok) {
            addManual(context, call, binding.reason ?? "binding unavailable", call.expression);
            return false;
          }
          emitEdit(context, call, `${target}.${writeName}(${args[0]}, ${args[1]}, { mode: ${mode.getText(sourceFile)} })`);
          return true;
        }
        addManual(
          context,
          call,
          `unsupported ${chain} options; use "wx" explicitly for exclusive create`,
          call.expression,
        );
        return false;
      }
      const binding = requireBinding(context, call, sync ? "fs" : "fsp");
      if (!binding.ok) {
        addManual(context, call, binding.reason ?? "binding unavailable", call.expression);
        return false;
      }
      emitEdit(context, call, `${target}.${writeName}(${args[0]}, ${args[1]})`);
      return true;
    }
    case "Deno.mkdir":
    case "Deno.mkdirSync": {
      if (args.length < 1 || args.length > 2) break;
      const sync = chain.endsWith("Sync");
      const binding = requireBinding(context, call, sync ? "fs" : "fsp");
      if (!binding.ok) {
        addManual(context, call, binding.reason ?? "binding unavailable", call.expression);
        return false;
      }
      emitEdit(context, call, `${sync ? "fs.mkdirSync" : "fsp.mkdir"}(${args.join(", ")})`);
      return true;
    }
    case "Deno.remove":
    case "Deno.removeSync": {
      const sync = chain.endsWith("Sync");
      if (args.length === 2) {
        const option = call.arguments[1];
        if (isObjectLiteral(option) && objectHasOnlyOption(option, "recursive")?.kind === ts.SyntaxKind.TrueKeyword) {
          const binding = requireBinding(context, call, sync ? "fs" : "fsp");
          if (!binding.ok) {
            addManual(context, call, binding.reason ?? "binding unavailable", call.expression);
            return false;
          }
          emitEdit(context, call, `${sync ? "fs.rmSync" : "fsp.rm"}(${args[0]}, { recursive: true })`);
          return true;
        }
        addManual(context, call, `unsupported ${chain} options`, call.expression);
        return false;
      }
      if (args.length !== 1) break;
      const helper = sync ? "removePathSync" : "removePath";
      const binding = requireFsCompat(context, call, helper);
      if (!binding.ok) {
        addManual(context, call, binding.reason ?? "helper unavailable", call.expression);
        return false;
      }
      emitEdit(context, call, `${helper}(${args[0]})`);
      return true;
    }
    case "Deno.readDirSync": {
      if (args.length !== 1) break;
      if (hasHazardousConsumer(call, ITERATOR_MEMBERS)) {
        addManual(
          context,
          call,
          "readDirSync result is an array; iterator consumer needs manual conversion",
          call.expression,
        );
        return false;
      }
      const binding = requireBinding(context, call, "fs");
      if (!binding.ok) {
        addManual(context, call, binding.reason ?? "fs unavailable", call.expression);
        return false;
      }
      context.typeRewritten = true;
      emitEdit(context, call, `fs.readdirSync(${args[0]}, { withFileTypes: true })`);
      return true;
    }
    case "Deno.readDir": {
      addManual(context, call, "Deno.readDir outside a for-await loop", call.expression);
      return false;
    }
  }

  if (chain in TEMP_HELPERS) {
    const helper = TEMP_HELPERS[chain];
    if (args.length > 1) {
      addManual(context, call, `unsupported ${chain} argument count`, call.expression);
      return false;
    }
    const binding = requireFsCompat(context, call, helper);
    if (!binding.ok) {
      addManual(context, call, binding.reason ?? "helper unavailable", call.expression);
      return false;
    }
    emitEdit(context, call, `${helper}(${args.join(", ")})`);
    return true;
  }

  if (chain in SYNC_FILE_CALLS || chain in ASYNC_FILE_CALLS) {
    return handleFileCall(context, call, chain, chain.endsWith("Sync"));
  }
  return false;
}

function handleImport(context: AnalysisContext, node: ts.ImportDeclaration): boolean {
  const { sourceFile } = context;
  const moduleLiteral = node.moduleSpecifier;
  if (!ts.isStringLiteral(moduleLiteral)) return false;
  const moduleName = moduleLiteral.text;

  if (moduleName === "@std/path") {
    const clause = node.importClause;
    if (
      clause === undefined ||
      clause.name !== undefined ||
      clause.namedBindings === undefined ||
      !ts.isNamedImports(clause.namedBindings)
    ) {
      addManual(context, node, "@std/path import shape needs manual conversion");
      return false;
    }
    const pathSpecifiers: string[] = [];
    const urlSpecifiers: string[] = [];
    let blocked = false;
    for (const element of clause.namedBindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      const local = element.name.text;
      if (imported === "SEPARATOR") pathSpecifiers.push(`sep as ${local}`);
      else if (imported === "SEPARATOR_PATTERN") {
        blocked = true;
        addManual(context, node, "SEPARATOR_PATTERN has no node:path equivalent");
      } else if (imported === "fromFileUrl") urlSpecifiers.push(`fileURLToPath as ${local}`);
      else if (imported === "toFileUrl") urlSpecifiers.push(`pathToFileURL as ${local}`);
      else if (imported in NODE_PATH_NAMES) pathSpecifiers.push(element.getText(sourceFile));
      else {
        blocked = true;
        addManual(context, node, `unsupported @std/path import "${imported}"`);
      }
    }
    if (blocked) return false;
    const prefix = clause.isTypeOnly ? "import type" : "import";
    const replacement = pathSpecifiers.length === 0
      ? ""
      : `${prefix} { ${pathSpecifiers.join(", ")} } from "node:path";`;
    if (urlSpecifiers.length > 0) {
      for (const specifier of urlSpecifiers) {
        const [imported, local] = specifier.split(" as ");
        context.needs.url.set(imported, local);
      }
    }
    emitEdit(context, node, replacement);
    return true;
  }

  if (moduleName === "@std/fs") {
    const clause = node.importClause;
    const bindings = clause?.namedBindings;
    if (
      clause === undefined ||
      clause.isTypeOnly ||
      clause.name !== undefined ||
      bindings === undefined ||
      !ts.isNamedImports(bindings) ||
      bindings.elements.length !== 1 ||
      (bindings.elements[0].propertyName ?? bindings.elements[0].name).text !== "exists"
    ) {
      addManual(context, node, 'unsupported @std/fs import; use "node:fs" or the helper directly');
      return false;
    }
    if (!context.options.srcHelpers) {
      addManual(context, node, "needs src/ helper (--no-src-helpers)");
      return false;
    }
    const localName = bindings.elements[0].name.text;
    let optionsArgument = false;
    const visit = (child: ts.Node): void => {
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === localName &&
        child.arguments.length > 1
      ) {
        optionsArgument = true;
      }
      ts.forEachChild(child, visit);
    };
    visit(sourceFile);
    if (optionsArgument) {
      addManual(context, node, "@std/fs exists options have no helper equivalent");
      return false;
    }
    const specifier = moduleSource(context.fileName, "src/utils/fs-compat.ts");
    emitEdit(
      context,
      node,
      `import { pathExists as ${localName} } from "${specifier}";`,
    );
    return true;
  }

  if (moduleName === "@std/yaml") {
    const clause = node.importClause;
    const bindings = clause?.namedBindings;
    if (
      clause === undefined ||
      clause.isTypeOnly ||
      bindings === undefined ||
      !ts.isNamedImports(bindings)
    ) {
      addManual(context, node, 'unsupported @std/yaml import; use the "yaml" package directly');
      return false;
    }
    const names = bindings.elements.map((element) => (element.propertyName ?? element.name).text);
    if (!names.every((name) => name === "parse" || name === "stringify")) {
      addManual(context, node, 'unsupported @std/yaml import; use the "yaml" package directly');
      return false;
    }
    emitEdit(context, moduleLiteral, '"yaml"');
    return true;
  }

  if (moduleName === "ventojs/core/environment.ts") {
    emitEdit(context, moduleLiteral, '"ventojs/core/environment.js"');
    return true;
  }

  if (moduleName === "@std/fs/copy") {
    addManual(context, node, '@std/fs/copy is not converted; use fsp.cp (D5)');
    return false;
  }
  if (moduleName === "@std/flags") {
    addManual(context, node, "@std/flags is not converted");
    return false;
  }
  return false;
}

function handleForOf(context: AnalysisContext, node: ts.ForOfStatement): boolean {
  if (node.awaitModifier === undefined) return false;
  if (!ts.isCallExpression(node.expression) || node.expression.arguments.length !== 1) return false;
  const chain = denoChain(node.expression.expression);
  if (chain !== "Deno.readDir") return false;
  const binding = requireBinding(context, node, "fsp");
  if (!binding.ok) {
    addManual(context, node, binding.reason ?? "fsp unavailable", node.expression);
    return false;
  }
  context.typeRewritten = true;
  const argument = node.expression.arguments[0].getText(context.sourceFile);
  const initializer = node.initializer.getText(context.sourceFile);
  context.rewrites += 1;
  if (context.mode === "apply") {
    context.edits.push({
      start: node.awaitModifier.getStart(context.sourceFile),
      end: node.expression.end,
      text: `(${initializer} of await fsp.readdir(${argument}, { withFileTypes: true })`,
    });
  }
  // Convert the loop body in this pass; the header expression is replaced.
  walk(context, node.statement);
  return true;
}

function handleBinary(context: AnalysisContext, node: ts.BinaryExpression): boolean {
  if (node.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword) return false;
  const chain = denoChain(node.right);
  const helper = chain === undefined ? undefined : FILESYSTEM_CLASSIFIERS[chain];
  if (helper === undefined) return false;
  const binding = requireFsCompat(context, node, helper);
  if (!binding.ok) {
    addManual(context, node, binding.reason ?? "helper unavailable", node.right);
    return false;
  }
  const left = node.left.getText(context.sourceFile);
  emitEdit(context, node, `${helper}(${left})`);
  return true;
}

function handlePropertyAccess(context: AnalysisContext, node: ts.PropertyAccessExpression): boolean {
  const chain = denoChain(node);
  if (chain === "Deno.build.os" || chain === "Deno.build.arch") {
    const helper = chain === "Deno.build.os" ? "runtimeOs" : "runtimeArch";
    const binding = requireRuntime(context, node, helper);
    if (!binding.ok) {
      addManual(context, node, binding.reason ?? "helper unavailable");
      return false;
    }
    emitEdit(context, node, `${helper}()`);
    return true;
  }
  return false;
}

function handleQualifiedName(context: AnalysisContext, node: ts.QualifiedName): boolean {
  const chain = denoChain(node);
  const typeName = chain === "Deno.FileInfo"
    ? "Stats"
    : chain === "Deno.DirEntry"
    ? "Dirent"
    : undefined;
  if (typeName === undefined) return false;
  const binding = requireBinding(context, node, typeName as BindingKind);
  if (!binding.ok) {
    addManual(context, node, binding.reason ?? "type binding unavailable");
    return false;
  }
  context.typeRewritten = true;
  emitEdit(context, node, typeName);
  return true;
}

function walk(context: AnalysisContext, node: ts.Node): void {
  let skipChildren = false;
  if (ts.isSourceFile(node)) {
    // Source file is the walk root.
  } else if (ts.isForOfStatement(node)) {
    skipChildren = handleForOf(context, node);
  } else if (ts.isImportDeclaration(node)) {
    skipChildren = handleImport(context, node);
  } else if (ts.isCallExpression(node)) {
    skipChildren = handleCall(context, node);
  } else if (ts.isBinaryExpression(node)) {
    skipChildren = handleBinary(context, node);
  } else if (ts.isPropertyAccessExpression(node)) {
    skipChildren = handlePropertyAccess(context, node);
  } else if (ts.isQualifiedName(node)) {
    skipChildren = handleQualifiedName(context, node);
  }
  if (skipChildren) return;
  ts.forEachChild(node, (child) => walk(context, child));
}

function newContext(
  mode: "apply" | "diagnose",
  sourceFile: ts.SourceFile,
  fileName: string,
  options: Required<ConvertOptions>,
  needs: Needs,
): AnalysisContext {
  return {
    mode,
    sourceFile,
    options,
    fileName,
    edits: [],
    rewrites: 0,
    needs,
    refusals: new Set<string>(),
    manual: [],
    explained: [],
    extraManual: [],
    typeRewritten: false,
  };
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((left, right) => right.start - left.start);
  let result = text;
  let boundary = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.end > boundary) continue;
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    boundary = edit.start;
  }
  return result;
}

/** Computes the import edits for the bindings the applied rewrites require. */
function finalizeImports(
  sourceFile: ts.SourceFile,
  fileName: string,
  needs: Needs,
): Edit[] {
  const edits: Edit[] = [];
  const newLines: string[] = [];

  const importsFrom = (moduleName: string): ts.ImportDeclaration[] =>
    sourceFile.statements.filter((statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName
    );

  const addNamed = (
    moduleName: string,
    specifiers: readonly string[],
    existingModules: readonly string[] = [moduleName],
  ): void => {
    const missing: string[] = [];
    for (const specifier of specifiers) {
      const localName = specifier.split(" as ").at(-1) ?? specifier;
      const already = importsFrom(existingModules[0]).some((declaration) =>
        declaration.importClause !== undefined &&
        declaration.importClause.namedBindings !== undefined &&
        ts.isNamedImports(declaration.importClause.namedBindings) &&
        declaration.importClause.namedBindings.elements.some((element) => element.name.text === localName)
      );
      if (!already) missing.push(specifier);
    }
    if (missing.length === 0) return;
    for (const declaration of importsFrom(moduleName)) {
      const clause = declaration.importClause;
      if (clause === undefined || clause.isTypeOnly) continue;
      const bindings = clause.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
      const separator = bindings.elements.length === 0 ? "" : ", ";
      edits.push({
        start: bindings.elements.end,
        end: bindings.elements.end,
        text: `${separator}${missing.join(", ")}`,
      });
      return;
    }
    newLines.push(`import { ${missing.join(", ")} } from "${moduleName}";`);
  };

  const addDefault = (moduleName: string, localName: string): void => {
    const existing = importsFrom(moduleName).some((declaration) =>
      declaration.importClause?.name?.text === localName
    );
    if (existing) return;
    newLines.push(`import ${localName} from "${moduleName}";`);
  };

  const addTypes = (types: readonly string[]): void => {
    const existingTypeImport = importsFrom("node:fs").find((declaration) =>
      declaration.importClause?.isTypeOnly === true &&
      declaration.importClause.namedBindings !== undefined &&
      ts.isNamedImports(declaration.importClause.namedBindings)
    );
    const already = new Set<string>();
    for (const declaration of importsFrom("node:fs")) {
      const bindings = declaration.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) already.add(element.name.text);
      }
    }
    const missing = types.filter((type) => !already.has(type));
    if (missing.length === 0) return;
    if (existingTypeImport !== undefined) {
      const bindings = existingTypeImport.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        const separator = bindings.elements.length === 0 ? "" : ", ";
        edits.push({
          start: bindings.elements.end,
          end: bindings.elements.end,
          text: `${separator}${missing.join(", ")}`,
        });
        return;
      }
    }
    newLines.push(`import type { ${missing.join(", ")} } from "node:fs";`);
  };

  if (needs.fs) addDefault("node:fs", "fs");
  if (needs.fsp) addDefault("node:fs/promises", "fsp");
  if (needs.types.size > 0) addTypes([...needs.types].sort());
  if (needs.test) addNamed("bun:test", ["test"]);
  if (needs.fsCompat.size > 0) {
    const moduleName = expectedModule("fsCompat", fileName);
    const specifiers = [...needs.fsCompat].sort();
    const existing = importsFrom(moduleName);
    if (existing.length === 0) {
      newLines.push(`import { ${specifiers.join(", ")} } from "${moduleName}";`);
    } else {
      addNamed(moduleName, specifiers);
    }
  }
  if (needs.runtimePlatform.size > 0) {
    const moduleName = expectedModule("runtimePlatform", fileName);
    const specifiers = [...needs.runtimePlatform].sort();
    const existing = importsFrom(moduleName);
    if (existing.length === 0) {
      newLines.push(`import { ${specifiers.join(", ")} } from "${moduleName}";`);
    } else {
      addNamed(moduleName, specifiers);
    }
  }
  if (needs.url.size > 0) {
    const specifiers = [...needs.url.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([imported, local]) => imported === local ? imported : `${imported} as ${local}`);
    addNamed("node:url", specifiers);
  }

  if (newLines.length > 0) {
    const imports = sourceFile.statements.filter(ts.isImportDeclaration);
    const last = imports.at(-1);
    const position = last !== undefined
      ? last.end
      : sourceFile.statements[0]?.getStart(sourceFile) ?? sourceFile.text.length;
    const insertion = last !== undefined
      ? newLines.map((line) => `\n${line}`).join("")
      : `${newLines.join("\n")}\n`;
    edits.push({ start: position, end: position, text: insertion });
  }
  return edits;
}

function residualReason(chain: string, options: Required<ConvertOptions>): string {
  if (chain in D4_SYMBOLS) return `high-risk symbol ${chain}; port by hand (D4)`;
  const helper = TEMP_HELPERS[chain];
  if (helper !== undefined && !options.srcHelpers) return "needs src/ helper (--no-src-helpers)";
  return `unhandled Deno usage ${chain}`;
}

function isExplained(context: AnalysisContext, node: ts.Node): boolean {
  const start = node.getStart(context.sourceFile);
  return context.explained.some((span) => start >= span.start && start < span.end);
}

function nullishComparison(node: ts.BinaryExpression): boolean {
  const operator = node.operatorToken.kind;
  if (
    operator !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    operator !== ts.SyntaxKind.EqualsEqualsToken &&
    operator !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    operator !== ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return false;
  }
  const sides = [node.left, node.right];
  return sides.some((side, index) => {
    const other = sides[1 - index];
    const timestamp = ts.isPropertyAccessExpression(side) &&
      side.name.text in TIMESTAMP_PROPERTIES;
    const nullish = other.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(other) && other.text === "undefined");
    return timestamp && nullish;
  });
}

function collectResidualAndFlags(
  context: AnalysisContext,
  typeRewritten: boolean,
): void {
  const { sourceFile } = context;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) &&
      isDenoChain(node) &&
      isOutermostDenoChain(node)
    ) {
      if (!isExplained(context, node)) {
        const chain = denoChain(node) ?? "Deno";
        context.manual.push({
          line: lineOf(sourceFile, node),
          text: nodeText(sourceFile, node),
          reason: residualReason(chain, context.options),
        });
      }
    }
    if (
      typeRewritten &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text in STATS_PROPERTIES &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      const reason = node.name.text === "isSymlink"
        ? ".isSymlink becomes isSymbolicLink() on Stats/Dirent (D5)"
        : `.${node.name.text} is a function on Stats/Dirent; call it (D5)`;
      context.manual.push({
        line: lineOf(sourceFile, node),
        text: nodeText(sourceFile, node),
        reason,
      });
    }
    if (ts.isBinaryExpression(node) && nullishComparison(node)) {
      context.manual.push({
        line: lineOf(sourceFile, node),
        text: nodeText(sourceFile, node),
        reason: "timestamp compared with null; Node returns a Date",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectYamlStringifyUses(context: AnalysisContext): void {
  const { sourceFile } = context;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (moduleName !== "@std/yaml" && moduleName !== "yaml") continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text !== "stringify") continue;
      const localName = element.name.text;
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === localName) {
          const parent = node.parent;
          const isImportSpecifier = parent !== undefined &&
            (ts.isImportSpecifier(parent) || ts.isImportClause(parent));
          if (!isImportSpecifier) {
            context.manual.push({
              line: lineOf(sourceFile, node),
              text: nodeText(sourceFile, node),
              reason: "yaml stringify output differs from @std/yaml",
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
}

function dedupeManual(entries: readonly ManualEntry[]): ManualEntry[] {
  const seen = new Map<string, ManualEntry>();
  for (const entry of entries) {
    const key = `${entry.line}|${entry.text}|${entry.reason}`;
    if (!seen.has(key)) seen.set(key, entry);
  }
  return [...seen.values()].sort((left, right) =>
    left.line - right.line || left.text.localeCompare(right.text) || left.reason.localeCompare(right.reason)
  );
}

const MAX_PASSES = 10;

/**
 * Rewrites one source text. `fileName` is used for the ATS script kind and for
 * the relative helper import path, so callers pass a repository-relative path.
 */
export function convertSource(
  text: string,
  fileName: string,
  options: ConvertOptions = {},
): ConvertResult {
  const resolvedOptions: Required<ConvertOptions> = { srcHelpers: options.srcHelpers ?? true };
  const initialSource = parseSource(text, fileName);
  const diagnostics = parseErrors(initialSource);
  if (diagnostics.length > 0) {
    return {
      code: text,
      rewrites: 0,
      manual: [],
      refused: [
        `parse error: ${diagnostics.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
        ).join("; ")}`,
      ],
    };
  }

  const needs = emptyNeeds();
  const refusals = new Set<string>();
  const applyNotes: ManualEntry[] = [];
  let current = text;
  let rewrites = 0;
  let typeRewritten = false;
  let converged = false;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const sourceFile = parseSource(current, fileName);
    const context = newContext("apply", sourceFile, fileName, resolvedOptions, needs);
    walk(context, sourceFile);
    for (const refusal of context.refusals) refusals.add(refusal);
    typeRewritten = typeRewritten || context.typeRewritten;
    applyNotes.push(...context.extraManual);
    if (context.edits.length === 0) {
      converged = true;
      break;
    }
    current = applyEdits(current, context.edits);
    rewrites += context.rewrites;
  }

  if (!converged) {
    return {
      code: text,
      rewrites: 0,
      manual: [],
      refused: [`did not converge after ${MAX_PASSES} passes`],
    };
  }

  if (refusals.size > 0) {
    return { code: text, rewrites: 0, manual: [], refused: [...refusals].sort() };
  }

  const beforeImports = parseSource(current, fileName);
  const importEdits = finalizeImports(beforeImports, fileName, needs);
  const lineCount = (value: string): number => value.split("\n").length;
  const linesBeforeImports = lineCount(current);
  if (importEdits.length > 0) current = applyEdits(current, importEdits);
  const insertedLines = lineCount(current) - linesBeforeImports;
  const shiftedNotes = applyNotes.map((note) => ({
    ...note,
    line: note.line + insertedLines,
  }));

  const finalSource = parseSource(current, fileName);
  const diagnose = newContext("diagnose", finalSource, fileName, resolvedOptions, emptyNeeds());
  walk(diagnose, finalSource);
  collectResidualAndFlags(diagnose, typeRewritten || diagnose.typeRewritten);
  collectYamlStringifyUses(diagnose);

  return {
    code: current,
    rewrites,
    manual: dedupeManual([...diagnose.manual, ...diagnose.extraManual, ...shiftedNotes]),
    refused: [],
  };
}

interface CliOptions {
  check: boolean;
  srcHelpers: boolean;
  files: string[];
}

function parseArguments(argv: readonly string[]): CliOptions {
  const options: CliOptions = { check: false, srcHelpers: true, files: [] };
  for (const argument of argv) {
    if (argument === "--check") options.check = true;
    else if (argument === "--no-src-helpers") options.srcHelpers = false;
    else if (argument.startsWith("--")) throw new Error(`unknown option: ${argument}`);
    else options.files.push(argument);
  }
  return options;
}

function runCli(argv: readonly string[]): number {
  let options: CliOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "usage: bun run --no-env-file migration/bun/convert/codemod.ts [--check] [--no-src-helpers] <file>...",
    );
    return 2;
  }
  if (options.files.length === 0) {
    console.error(
      "usage: bun run --no-env-file migration/bun/convert/codemod.ts [--check] [--no-src-helpers] <file>...",
    );
    return 2;
  }

  let refused = false;
  for (const file of options.files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (error) {
      refused = true;
      console.log(JSON.stringify({
        file,
        rewrites: 0,
        manual: [],
        refused: [`cannot read file: ${error instanceof Error ? error.message : String(error)}`],
      }));
      continue;
    }
    const result = convertSource(source, file, { srcHelpers: options.srcHelpers });
    if (result.refused.length > 0) refused = true;
    const record: Record<string, unknown> = {
      file,
      rewrites: result.rewrites,
      manual: result.manual,
    };
    if (result.refused.length > 0) record.refused = result.refused;
    console.log(JSON.stringify(record));
    if (!options.check && result.refused.length === 0 && result.code !== source) {
      writeFileSync(file, result.code);
    }
  }
  return refused ? 1 : 0;
}

if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)));
}
