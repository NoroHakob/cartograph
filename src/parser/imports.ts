import { Node, Project, ScriptKind, SyntaxKind, ts, type CallExpression, type SourceFile } from "ts-morph";
import type { ImportKind, Language } from "./types.ts";

/** An import as written, before resolution. */
export interface RawImport {
  specifier: string;
  /** False for import(expr) where expr isn't a string literal. */
  literal: boolean;
  kind: ImportKind;
  typeOnly: boolean;
  line: number;
}

export const SCRIPT_KIND: Record<Language, ScriptKind> = {
  ts: ScriptKind.TS,
  mts: ScriptKind.TS,
  cts: ScriptKind.TS,
  tsx: ScriptKind.TSX,
  // Plenty of .js files contain JSX; parsing them as JSX is harmless otherwise.
  js: ScriptKind.JSX,
  mjs: ScriptKind.JS,
  cjs: ScriptKind.JS,
  jsx: ScriptKind.JSX,
};

/**
 * Parses files one at a time in an in-memory project. Nothing is read from
 * disk here and nothing is type-checked: this is syntax only.
 */
export function createImportReader(): (path: string, language: Language, text: string) => RawImport[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
  });

  return (filePath, language, text) => {
    const sourceFile = project.createSourceFile(`/${filePath}`, text, {
      overwrite: true,
      scriptKind: SCRIPT_KIND[language],
    });
    try {
      return readImports(sourceFile);
    } finally {
      project.removeSourceFile(sourceFile);
    }
  };
}

function readImports(sourceFile: SourceFile): RawImport[] {
  const found: RawImport[] = [];
  const lineOf = (node: Node) => node.getStartLineNumber();
  const readRequires = sourceFile.getFullText().includes("require") && !shadowsRequire(sourceFile);

  for (const decl of sourceFile.getImportDeclarations()) {
    const named = decl.getNamedImports();
    const allNamedAreTypes =
      named.length > 0 && named.every((n) => n.isTypeOnly()) && !decl.getDefaultImport() && !decl.getNamespaceImport();
    found.push({
      specifier: decl.getModuleSpecifierValue(),
      literal: true,
      kind: "static",
      typeOnly: decl.isTypeOnly() || allNamedAreTypes,
      line: lineOf(decl),
    });
  }

  for (const decl of sourceFile.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier === undefined) continue; // export { a } with no `from`
    const named = decl.getNamedExports();
    found.push({
      specifier,
      literal: true,
      kind: "reexport",
      typeOnly: decl.isTypeOnly() || (named.length > 0 && named.every((n) => n.isTypeOnly())),
      line: lineOf(decl),
    });
  }

  sourceFile.forEachDescendant((node) => {
    // import x = require("x"), the TypeScript form of a plain import.
    if (Node.isImportEqualsDeclaration(node)) {
      const ref = node.getModuleReference();
      if (Node.isExternalModuleReference(ref)) {
        const expr = ref.getExpression();
        if (expr && Node.isStringLiteral(expr)) {
          found.push({
            specifier: expr.getLiteralValue(),
            literal: true,
            kind: "static",
            typeOnly: node.isTypeOnly(),
            line: lineOf(node),
          });
        }
      }
      return;
    }

    if (!Node.isCallExpression(node)) return;

    // require("x"): only with one literal argument. require(expr) loads
    // something, but nothing in the syntax says what, so it isn't collected.
    if (readRequires && isRequireCall(node)) {
      const [arg] = node.getArguments();
      if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
        found.push({ specifier: arg.getLiteralValue(), literal: true, kind: "require", typeOnly: false, line: lineOf(node) });
      }
      return;
    }

    if (node.getExpression().getKind() !== SyntaxKind.ImportKeyword) return;
    const [arg] = node.getArguments();
    if (!arg) return;
    if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
      found.push({ specifier: arg.getLiteralValue(), literal: true, kind: "dynamic", typeOnly: false, line: lineOf(node) });
    } else {
      found.push({ specifier: arg.getText(), literal: false, kind: "dynamic", typeOnly: false, line: lineOf(node) });
    }
  });

  return found;
}

/** `require(<one argument>)` called by its bare name; `require.resolve(...)` loads nothing. */
function isRequireCall(call: CallExpression): boolean {
  const callee = call.getExpression();
  return Node.isIdentifier(callee) && callee.getText() === "require" && call.getArguments().length === 1;
}

/**
 * Whether the file declares its own `require`, so a call to it may not be
 * Node's. Scope is ignored: one such declaration anywhere and no call in the
 * file is collected, because without a binder there's no telling which
 * `require` a call reaches. Two declarations still mean Node's: one made by
 * `createRequire(...)`, and an ambient `declare` that only types the global.
 */
function shadowsRequire(sourceFile: SourceFile): boolean {
  return sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => {
    if (id.getText() !== "require") return false;
    const parent = id.getParent();
    if (!parent) return false;
    if (Node.isVariableDeclaration(parent) && parent.getNameNode() === id) {
      if (parent.getVariableStatement()?.hasDeclareKeyword()) return false;
      const init = parent.getInitializer();
      if (init && Node.isCallExpression(init)) {
        const callee = init.getExpression();
        const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
        if (name === "createRequire") return false;
      }
      return true;
    }
    if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === id) return !parent.hasDeclareKeyword();
    if (Node.isParameterDeclaration(parent) || Node.isBindingElement(parent)) return parent.getNameNode() === id;
    if (Node.isImportSpecifier(parent) || Node.isImportClause(parent) || Node.isNamespaceImport(parent)) return true;
    if (Node.isImportEqualsDeclaration(parent)) return parent.getNameNode() === id;
    return false;
  });
}
