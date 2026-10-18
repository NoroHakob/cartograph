// The names a module exports, read from its own syntax. Two systems, read
// separately because a framework that serves one doesn't serve the other: a
// Next.js route handler is an ES module export, never `exports.GET`.

import { Node, SyntaxKind, type Expression, type SourceFile } from "ts-morph";

export interface ExportedName {
  name: string;
  /** 1-based line the name is exported on. */
  line: number;
}

/**
 * Every value name an ES module exports. Null when the file re-exports
 * everything from somewhere else, because then the list can't be read from
 * this file alone.
 */
export function esmExports(source: SourceFile): ExportedName[] | null {
  const names: ExportedName[] = [];
  for (const statement of source.getStatements()) {
    const line = statement.getStartLineNumber();
    if (Node.isExportDeclaration(statement)) {
      if (statement.isTypeOnly()) continue;
      if (!statement.hasNamedExports()) {
        const namespace = statement.getNamespaceExport();
        if (!namespace) return null; // export * from "x"
        names.push({ name: namespace.getName(), line });
        continue;
      }
      for (const spec of statement.getNamedExports()) {
        if (!spec.isTypeOnly()) names.push({ name: spec.getAliasNode()?.getText() ?? spec.getName(), line });
      }
    } else if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) {
      const name = statement.getName();
      if (name && statement.hasExportKeyword() && !statement.hasDefaultKeyword()) names.push({ name, line });
    } else if (Node.isVariableStatement(statement) && statement.hasExportKeyword()) {
      for (const decl of statement.getDeclarations()) {
        const nameNode = decl.getNameNode();
        // `export const { GET, POST } = handlers` names its exports too.
        const identifiers = Node.isIdentifier(nameNode) ? [nameNode] : nameNode.getDescendantsOfKind(SyntaxKind.BindingElement).map((b) => b.getNameNode());
        for (const id of identifiers) if (Node.isIdentifier(id)) names.push({ name: id.getText(), line: decl.getStartLineNumber() });
      }
    }
  }
  return names;
}

/**
 * Every name a CommonJS module exports, from top-level statements only:
 *
 *   exports.a = ...            module.exports.a = ...      exports["a"] = ...
 *   module.exports = { a, b }  Object.defineProperty(exports, "a", ...)
 *
 * Assigning anything other than an object literal to `module.exports` makes
 * that value the module itself, which ES module interop calls "default".
 * Null when the names can't be read from this file alone: the object has a
 * spread or a computed key, or `module.exports` is another module's exports.
 */
export function commonJsExports(source: SourceFile): ExportedName[] | null {
  const names = new Map<string, number>();
  const add = (name: string, line: number) => {
    if (!names.has(name)) names.set(name, line);
  };

  for (const statement of source.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const line = statement.getStartLineNumber();
    const expr = statement.getExpression();

    if (Node.isCallExpression(expr)) {
      const name = definedProperty(expr.getExpression(), expr.getArguments());
      if (name !== undefined) add(name, line);
      continue;
    }

    // `exports = module.exports = x` gives every target in the chain the last value.
    const targets: Node[] = [];
    let value: Expression = expr;
    while (Node.isBinaryExpression(value) && value.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      targets.push(value.getLeft());
      value = value.getRight();
    }
    for (const target of targets) {
      if (isModuleExports(target)) {
        const whole = wholeModule(value);
        if (whole === null) return null;
        for (const name of whole) add(name, line);
      } else {
        const member = exportsMember(target);
        if (member !== undefined) add(member, line);
      }
    }
  }
  return [...names].map(([name, line]) => ({ name, line }));
}

/** `module.exports` */
function isModuleExports(node: Node): boolean {
  return Node.isPropertyAccessExpression(node) && node.getName() === "exports" && node.getExpression().getText() === "module";
}

/** `exports` or `module.exports`, the object a CommonJS module exports through. */
function isExportsObject(node: Node): boolean {
  return (Node.isIdentifier(node) && node.getText() === "exports") || isModuleExports(node);
}

/** The name in `exports.a` / `exports["a"]` / `module.exports.a`, or undefined for any other target. */
function exportsMember(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node) && isExportsObject(node.getExpression())) return node.getName();
  if (Node.isElementAccessExpression(node) && isExportsObject(node.getExpression())) {
    const arg = node.getArgumentExpression();
    if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) return arg.getLiteralValue();
  }
  return undefined;
}

/** The name in `Object.defineProperty(exports, "a", ...)`. */
function definedProperty(callee: Node, args: Node[]): string | undefined {
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "defineProperty" || callee.getExpression().getText() !== "Object") return undefined;
  const [target, key] = args;
  if (!target || !isExportsObject(target) || !key) return undefined;
  return Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key) ? key.getLiteralValue() : undefined;
}

/** What `module.exports = value` exports, or null when this file can't say. */
function wholeModule(value: Expression): string[] | null {
  // Another module's exports, passed through: their names live in that file.
  if (Node.isCallExpression(value) && value.getExpression().getText() === "require") return null;
  if (!Node.isObjectLiteralExpression(value)) return ["default"];
  const names: string[] = [];
  for (const prop of value.getProperties()) {
    if (Node.isShorthandPropertyAssignment(prop)) names.push(prop.getName());
    else if (Node.isPropertyAssignment(prop) || Node.isMethodDeclaration(prop) || Node.isGetAccessorDeclaration(prop) || Node.isSetAccessorDeclaration(prop)) {
      const key = prop.getNameNode();
      if (Node.isIdentifier(key) || Node.isStringLiteral(key) || Node.isNumericLiteral(key)) names.push(Node.isIdentifier(key) ? key.getText() : key.getLiteralText());
      else return null; // [computed]: the key isn't in the syntax
    } else return null; // ...spread: its keys come from somewhere else
  }
  return names;
}
