// Workflow code (TypeScript) → plain JavaScript the sandbox can run.
// Rules: no imports of any kind; must `export default` a function.
// Everything a workflow can do comes through the `sdk` argument.
import ts from "typescript";

export class CompileError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "CompileError";
  }
}

const MAX_CODE_LENGTH = 100_000;

export function compileWorkflow(source: string): string {
  if (source.length > MAX_CODE_LENGTH) throw new CompileError([`Code is longer than ${MAX_CODE_LENGTH} characters`]);

  const file = ts.createSourceFile("workflow.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  let hasDefaultExport = false;

  const where = (node: ts.Node) => {
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart());
    return `line ${line + 1}:${character + 1}`;
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      problems.push(`${where(node)}: imports are not allowed; use the sdk argument instead`);
    } else if (ts.isExportDeclaration(node)) {
      problems.push(`${where(node)}: re-exports are not allowed`);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      problems.push(`${where(node)}: import() is not allowed`);
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      problems.push(`${where(node)}: import.meta is not allowed`);
    }
    if (ts.isExportAssignment(node) && !node.isExportEquals) hasDefaultExport = true;
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      hasDefaultExport = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  if (!hasDefaultExport) problems.push("Code must `export default async function run(input, sdk) { ... }`");
  if (problems.length) throw new CompileError(problems);

  const out = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: false,
      removeComments: false,
    },
  });
  const syntaxErrors = (out.diagnostics ?? []).map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `line ${line + 1}:${character + 1}: ${msg}`;
    }
    return msg;
  });
  if (syntaxErrors.length) throw new CompileError(syntaxErrors);

  // Wrap the CommonJS output so evaluating it returns the default-exported function.
  // The user's code gets its own function scope, so its names (e.g. `run`) can't clash with ours.
  return `(function () {
  const __module = { exports: {} };
  (function (exports, module) {
${out.outputText}
  })(__module.exports, __module);
  const __default = __module.exports.default;
  if (typeof __default !== "function") throw new Error("The default export must be a function");
  return __default;
})()`;
}
