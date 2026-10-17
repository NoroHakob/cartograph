import { Node, Project, ScriptKind, SyntaxKind, ts, type SourceFile } from "ts-morph";
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

    if (!Node.isCallExpression(node) || node.getExpression().getKind() !== SyntaxKind.ImportKeyword) return;
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
