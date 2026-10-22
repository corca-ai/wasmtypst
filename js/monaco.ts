import type * as Monaco from "monaco-editor";
import type { Compiler } from "./compiler.js";
import type { CompileResult, SourceLocation } from "./types.js";

export interface MonacoOptions {
  pathForUri?: (uri: Monaco.Uri) => string;
  uriForPath?: (path: string) => Monaco.Uri;
}

/** Providers are editor adapters. The host synchronizes authorized project files. */
export function registerMonaco(
  monaco: typeof Monaco,
  compiler: Compiler,
  options: MonacoOptions = {},
): Monaco.IDisposable {
  const path =
    options.pathForUri ?? ((uri: Monaco.Uri) => uri.path.replace(/^\/+/, ""));
  const uri =
    options.uriForPath ??
    ((path: string) => monaco.Uri.parse(`file:///${path}`));
  const disposables: Monaco.IDisposable[] = [];
  const location = (
    target: SourceLocation,
  ): Monaco.languages.Location | null => {
    const targetUri = uri(target.path);
    const model = monaco.editor.getModel(targetUri);
    if (!model) return null;
    const from = model.getPositionAt(target.from);
    const to = model.getPositionAt(target.to);
    return {
      uri: targetUri,
      range: new monaco.Range(
        from.lineNumber,
        from.column,
        to.lineNumber,
        to.column,
      ),
    };
  };
  const range = (model: Monaco.editor.ITextModel, from: number, to: number) => {
    const a = model.getPositionAt(from);
    const b = model.getPositionAt(to);
    return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
  };
  monaco.languages.register({
    id: "typst",
    extensions: [".typ"],
    aliases: ["Typst"],
  });
  disposables.push(
    monaco.languages.registerCompletionItemProvider("typst", {
      triggerCharacters: ["#", ".", "@", "<", '"', "("],
      async provideCompletionItems(model, position, _context, token) {
        const version = model.getVersionId();
        const result = await compiler.completion(
          path(model.uri),
          model.getOffsetAt(position),
        );
        if (token.isCancellationRequested || version !== model.getVersionId())
          return { suggestions: [] };
        return {
          suggestions: result.items.map((item) => ({
            label: item.label,
            insertText: item.apply ?? item.label,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            kind: monaco.languages.CompletionItemKind.Text,
            ...(item.detail === null ? {} : { detail: item.detail }),
            range: range(model, result.from, result.to),
          })),
        };
      },
    }),
  );
  disposables.push(
    monaco.languages.registerSignatureHelpProvider("typst", {
      signatureHelpTriggerCharacters: ["(", ",", ":"],
      signatureHelpRetriggerCharacters: [")"],
      async provideSignatureHelp(model, position, token) {
        const version = model.getVersionId();
        const result = await compiler.signature(
          path(model.uri),
          model.getOffsetAt(position),
        );
        if (
          !result ||
          model.isDisposed() ||
          token.isCancellationRequested ||
          version !== model.getVersionId()
        )
          return null;
        return {
          value: {
            signatures: result.signatures.map((signature) => ({
              label: signature.label,
              ...(signature.documentation === null
                ? {}
                : { documentation: signature.documentation }),
              parameters: signature.parameters.map((parameter) => ({
                label: parameter.label,
                ...(parameter.documentation === null
                  ? {}
                  : { documentation: parameter.documentation }),
              })),
              activeParameter: signature.activeParameter ?? -1,
            })),
            activeSignature: result.activeSignature,
            activeParameter:
              result.signatures[result.activeSignature]?.activeParameter ?? -1,
          },
          dispose() {},
        };
      },
    }),
  );
  disposables.push(
    monaco.languages.registerHoverProvider("typst", {
      async provideHover(model, position, token) {
        const version = model.getVersionId();
        const result = await compiler.hover(
          path(model.uri),
          model.getOffsetAt(position),
        );
        if (
          !result ||
          token.isCancellationRequested ||
          version !== model.getVersionId()
        )
          return null;
        return {
          contents: [
            {
              value:
                result.kind === "code"
                  ? `\`\`\`typst\n${result.text}\n\`\`\``
                  : result.text,
              isTrusted: false,
            },
          ],
        };
      },
    }),
  );
  disposables.push(
    monaco.languages.registerDefinitionProvider("typst", {
      async provideDefinition(model, position, token) {
        const version = model.getVersionId();
        const result = await compiler.definition(
          path(model.uri),
          model.getOffsetAt(position),
        );
        return result &&
          !token.isCancellationRequested &&
          version === model.getVersionId()
          ? location(result)
          : null;
      },
    }),
  );
  disposables.push(
    monaco.languages.registerReferenceProvider("typst", {
      async provideReferences(model, position, _context, token) {
        const version = model.getVersionId();
        const results = await compiler.references(
          path(model.uri),
          model.getOffsetAt(position),
        );
        if (token.isCancellationRequested || version !== model.getVersionId())
          return [];
        return results
          .map(location)
          .filter(
            (value): value is Monaco.languages.Location => value !== null,
          );
      },
    }),
  );
  disposables.push(
    monaco.languages.registerRenameProvider("typst", {
      async provideRenameEdits(model, position, name, token) {
        const version = model.getVersionId();
        const plan = await compiler.rename(
          path(model.uri),
          model.getOffsetAt(position),
          name,
        );
        if (
          token.isCancellationRequested ||
          version !== model.getVersionId() ||
          plan.revision !== (await compiler.stats()).revision
        )
          return { edits: [], rejectReason: "Source changed" };
        const edits: Monaco.languages.IWorkspaceTextEdit[] = [];
        for (const edit of plan.edits) {
          const target = monaco.editor.getModel(uri(edit.path));
          if (!target)
            return {
              edits: [],
              rejectReason: "Open the affected file before applying the rename",
            };
          edits.push({
            resource: target.uri,
            versionId: target.getVersionId(),
            textEdit: {
              range: range(target, edit.from, edit.to),
              text: edit.text,
            },
          });
        }
        return { edits };
      },
    }),
  );
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider("typst", {
      async provideDocumentFormattingEdits(model, _options, token) {
        const version = model.getVersionId();
        const edit = await compiler.format(path(model.uri));
        if (
          token.isCancellationRequested ||
          version !== model.getVersionId() ||
          edit.revision !== (await compiler.stats()).revision
        )
          return [];
        return [{ range: range(model, edit.from, edit.to), text: edit.text }];
      },
    }),
  );
  const tokenTypes = [
    "comment",
    "string",
    "number",
    "variable",
    "label",
    "heading",
    "keyword",
  ];
  disposables.push(
    monaco.languages.registerDocumentSemanticTokensProvider("typst", {
      getLegend: () => ({ tokenTypes, tokenModifiers: [] }),
      releaseDocumentSemanticTokens() {},
      async provideDocumentSemanticTokens(model, _id, token) {
        const version = model.getVersionId();
        const tokens = await compiler.semanticTokens(path(model.uri));
        if (token.isCancellationRequested || version !== model.getVersionId())
          return null;
        const data: number[] = [];
        let lastLine = 0;
        let lastColumn = 0;
        for (const item of tokens) {
          const start = model.getPositionAt(item.from);
          const end = model.getPositionAt(item.to);
          // LSP semantic tokens cannot cross lines. Split comments and strings.
          for (let line = start.lineNumber; line <= end.lineNumber; line++) {
            const column = line === start.lineNumber ? start.column - 1 : 0;
            const length =
              (line === end.lineNumber
                ? end.column - 1
                : model.getLineLength(line)) - column;
            if (length <= 0) continue;
            data.push(
              line - 1 - lastLine,
              line - 1 === lastLine ? column - lastColumn : column,
              length,
              tokenTypes.indexOf(item.kind),
              0,
            );
            lastLine = line - 1;
            lastColumn = column;
          }
        }
        return { data: new Uint32Array(data) };
      },
    }),
  );
  return {
    dispose() {
      for (const disposable of disposables.splice(0)) disposable.dispose();
    },
  };
}

/** Publish only a result the host has admitted against its current revision. */
export function publishDiagnostics(
  monaco: typeof Monaco,
  result: CompileResult,
  options: MonacoOptions = {},
): void {
  const uri =
    options.uriForPath ??
    ((path: string) => monaco.Uri.parse(`file:///${path}`));
  const markers = new Map<
    Monaco.editor.ITextModel,
    Monaco.editor.IMarkerData[]
  >();
  for (const model of monaco.editor.getModels())
    if (model.getLanguageId() === "typst") markers.set(model, []);
  for (const diagnostic of result.diagnostics) {
    if (!diagnostic.location) continue;
    const model = monaco.editor.getModel(uri(diagnostic.location.path));
    if (!model) continue;
    const from = model.getPositionAt(diagnostic.location.from);
    const to = model.getPositionAt(diagnostic.location.to);
    const list = markers.get(model) ?? [];
    list.push({
      startLineNumber: from.lineNumber,
      startColumn: from.column,
      endLineNumber: to.lineNumber,
      endColumn: to.column,
      message: [diagnostic.message, ...diagnostic.hints].join("\n"),
      severity:
        diagnostic.severity === "error"
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
      source: "Typst",
    });
    markers.set(model, list);
  }
  for (const [model, items] of markers)
    monaco.editor.setModelMarkers(model, "wasmtypst", items);
}
