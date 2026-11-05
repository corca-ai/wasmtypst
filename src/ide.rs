use crate::{Engine, engine::offset, world::path_for};
use serde_json::{Value, json};
use typst::WorldExt;
use typst::syntax::ast::AstNode;
use typst::syntax::{LinkedNode, Side, Source, Span, SyntaxKind, ast};
use typst_ide::{Definition, NamedItem, Tooltip};

fn leaves<'a>(node: LinkedNode<'a>, out: &mut Vec<LinkedNode<'a>>) {
    if node.children().next().is_none() {
        out.push(node);
    } else {
        for child in node.children() {
            leaves(child, out);
        }
    }
}

struct SourceReferences {
    locations: Vec<Value>,
    has_math_identifiers: bool,
}

impl Engine {
    fn definition_at(&self, source: &Source, byte: usize) -> Option<Definition> {
        typst_ide::definition(&self.world, self.ide_document(), source, byte, Side::After).or_else(
            || {
                let leaf = LinkedNode::new(source.root()).leaf_at(byte, Side::After)?;
                let wanted = leaf.cast::<ast::MathIdent>()?.get();
                // A field is resolved through its value, never as a lexical name.
                if leaf
                    .parent()
                    .and_then(|node| node.cast::<ast::MathFieldAccess>())
                    .is_some_and(|access| access.field().span() == leaf.span())
                {
                    return None;
                }
                typst_ide::named_items(&self.world, leaf.clone(), |item| {
                    let (name, span) = match item {
                        NamedItem::Var(ident) | NamedItem::Fn(ident) => (ident.get(), ident.span()),
                        NamedItem::Module(name, span, _) | NamedItem::Import(name, span, _) => {
                            (name, span)
                        }
                    };
                    (name == wanted).then_some(Definition::Span(span))
                })
            },
        )
    }

    fn definition_span(&self, source: &Source, byte: usize) -> Option<Span> {
        if let Some(Definition::Span(span)) = self.definition_at(source, byte) {
            return Some(span);
        }
        let leaf = LinkedNode::new(source.root()).leaf_at(byte, Side::After)?;
        // Declaration identifiers are not always dereference targets. Use
        // actual AST bindings; an unresolved identifier on a RHS is not one.
        if leaf.kind() == SyntaxKind::Ident {
            let mut ancestor = leaf.parent().cloned();
            while let Some(node) = ancestor {
                if let Some(binding) = node.cast::<ast::LetBinding>()
                    && binding
                        .kind()
                        .bindings()
                        .iter()
                        .any(|ident| ident.to_untyped().span() == leaf.span())
                {
                    return Some(leaf.span());
                }
                ancestor = node.parent().cloned();
            }
        }
        None
    }

    fn ide_document(&self) -> Option<&typst_layout::PagedDocument> {
        self.current(self.revision).ok()
    }

    fn references_to(&self, target: Span) -> SourceReferences {
        let mut result = Vec::new();
        let mut has_math_identifiers = false;
        for source in self.world.parsed_sources() {
            let mut nodes = Vec::new();
            leaves(LinkedNode::new(source.root()), &mut nodes);
            for node in nodes {
                if !matches!(node.kind(), SyntaxKind::Ident | SyntaxKind::MathIdent) {
                    continue;
                }
                if (node.span() == target
                    || self.definition_span(source, node.offset()) == Some(target))
                    && let Some(location) = self.location(source.id(), node.range())
                {
                    result.push(location);
                    has_math_identifiers |= node.kind() == SyntaxKind::MathIdent;
                }
            }
        }
        result.sort_by(|a, b| {
            a["path"]
                .as_str()
                .cmp(&b["path"].as_str())
                .then(a["from"].as_u64().cmp(&b["from"].as_u64()))
        });
        SourceReferences {
            locations: result,
            has_math_identifiers,
        }
    }

    pub fn ide_request(&mut self, request: &Value) -> Result<Value, String> {
        let op = request["op"].as_str().ok_or("Missing op")?;
        let path = request["path"].as_str().ok_or("Missing path")?;
        let cursor = if matches!(op, "format" | "semanticTokens" | "symbols" | "folding") {
            0
        } else {
            offset(request)?
        };
        let (source, byte) = self.source(path, cursor)?;
        match op {
            "signature" => Ok(crate::signature::signature(
                &self.world,
                &source,
                byte,
                self.revision,
            )),
            "completion" => Ok(
                match typst_ide::autocomplete(&self.world, self.ide_document(), &source, byte, true)
                {
                    Some((from, items)) => {
                        json!({"from": source.lines().byte_to_utf16(from), "to": cursor, "items": items})
                    }
                    None => json!({"from": cursor, "to": cursor, "items": []}),
                },
            ),
            "hover" => Ok(
                match typst_ide::tooltip(
                    &self.world,
                    self.ide_document(),
                    &source,
                    byte,
                    Side::After,
                ) {
                    Some(Tooltip::Code(text)) => json!({"kind": "code", "text": text}),
                    Some(Tooltip::Text(text)) => json!({"kind": "text", "text": text}),
                    None => Value::Null,
                },
            ),
            "definition" => Ok(match self.definition_at(&source, byte) {
                Some(Definition::Span(span)) => span
                    .id()
                    .and_then(|id| {
                        self.world
                            .range(span)
                            .and_then(|range| self.location(id, range))
                    })
                    .unwrap_or(Value::Null),
                Some(Definition::File(id)) => json!({"path": path_for(id), "from": 0, "to": 0}),
                _ => Value::Null,
            }),
            "references" | "rename" => {
                let Some(target) = self.definition_span(&source, byte) else {
                    return if op == "references" {
                        Ok(json!([]))
                    } else {
                        Err("No renameable identifier at this position".into())
                    };
                };
                let found = self.references_to(target);
                let references = found.locations;
                if op == "references" {
                    return Ok(json!(references));
                }
                let name = request["newName"].as_str().ok_or("Missing newName")?;
                let candidate = Source::detached(format!("#let {name} = 0"));
                let mut tokens = Vec::new();
                leaves(LinkedNode::new(candidate.root()), &mut tokens);
                if candidate.root().diagnosis().errors
                    || tokens
                        .iter()
                        .filter(|n| n.kind() == SyntaxKind::Ident)
                        .count()
                        != 1
                    || tokens
                        .iter()
                        .find(|n| n.kind() == SyntaxKind::Ident)
                        .is_none_or(|n| n.get().leaf_text() != name)
                {
                    return Err("newName is not a valid Typst identifier".into());
                }
                if found.has_math_identifiers {
                    let math = Source::detached(format!("${name}$"));
                    let mut math_tokens = Vec::new();
                    leaves(LinkedNode::new(math.root()), &mut math_tokens);
                    if math.root().diagnosis().errors
                        || !math_tokens.iter().any(|node| {
                            node.kind() == SyntaxKind::MathIdent && node.get().leaf_text() == name
                        })
                    {
                        return Err("newName is not a native math identifier".into());
                    }
                }
                if references
                    .iter()
                    .any(|r| r["path"].as_str().is_some_and(|p| p.starts_with('@')))
                {
                    return Err("Package sources are read-only".into());
                }
                // Conservatively refuse collisions rather than silently capture
                // another binding. All edits are plans; the host applies them.
                for src in self.world.parsed_sources() {
                    let mut nodes = Vec::new();
                    leaves(LinkedNode::new(src.root()), &mut nodes);
                    if nodes.iter().any(|n| {
                        matches!(n.kind(), SyntaxKind::Ident | SyntaxKind::MathIdent)
                            && n.get().leaf_text() == name
                            && self.definition_span(src, n.offset()) != Some(target)
                    }) {
                        return Err("Rename could capture an existing identifier".into());
                    }
                }
                Ok(
                    json!({"revision": self.revision, "edits": references.iter().map(|r| json!({"path": r["path"], "from": r["from"], "to": r["to"], "text": name})).collect::<Vec<_>>()}),
                )
            }
            "format" => {
                let formatter = typstyle_core::Typstyle::default();
                let formatted = formatter
                    .format_source(source.clone())
                    .render()
                    .map_err(|e| e.to_string())?;
                Ok(
                    json!({"revision": self.revision, "path": path, "from": 0, "to": source.lines().len_utf16(), "text": formatted}),
                )
            }
            "semanticTokens" => {
                let mut nodes = Vec::new();
                leaves(LinkedNode::new(source.root()), &mut nodes);
                let tokens: Vec<_> = nodes.iter().filter_map(|node| {
                    let kind = match node.kind() {
                        SyntaxKind::LineComment | SyntaxKind::BlockComment | SyntaxKind::Shebang => "comment",
                        SyntaxKind::Str => "string",
                        SyntaxKind::Int | SyntaxKind::Float | SyntaxKind::Numeric => "number",
                        SyntaxKind::Ident | SyntaxKind::MathIdent => "variable",
                        SyntaxKind::Label | SyntaxKind::RefMarker => "label",
                        SyntaxKind::Raw | SyntaxKind::RawLang | SyntaxKind::RawDelim => "string",
                        SyntaxKind::HeadingMarker => "heading",
                        k if k.is_keyword() => "keyword",
                        _ => return None,
                    };
                    Some(json!({"from": source.lines().byte_to_utf16(node.range().start)?, "to": source.lines().byte_to_utf16(node.range().end)?, "kind": kind}))
                }).collect();
                Ok(json!(tokens))
            }
            "symbols" | "folding" => {
                fn walk(
                    engine: &Engine,
                    source: &Source,
                    node: LinkedNode<'_>,
                    op: &str,
                    out: &mut Vec<Value>,
                ) {
                    let is_symbol = matches!(
                        node.kind(),
                        SyntaxKind::Heading | SyntaxKind::LetBinding | SyntaxKind::Label
                    );
                    let is_fold = matches!(
                        node.kind(),
                        SyntaxKind::CodeBlock
                            | SyntaxKind::ContentBlock
                            | SyntaxKind::Heading
                            | SyntaxKind::Raw
                    );
                    if (op == "symbols" && is_symbol || op == "folding" && is_fold)
                        && let Some(mut location) = engine.location(source.id(), node.range())
                    {
                        location["kind"] = json!(format!("{:?}", node.kind()));
                        location["name"] = json!(
                            source.text()[node.range()]
                                .chars()
                                .take(100)
                                .collect::<String>()
                        );
                        out.push(location);
                    }
                    for child in node.children() {
                        walk(engine, source, child, op, out);
                    }
                }
                let mut result = Vec::new();
                walk(
                    self,
                    &source,
                    LinkedNode::new(source.root()),
                    op,
                    &mut result,
                );
                Ok(json!(result))
            }
            _ => Err(format!("Unknown operation: {op}")),
        }
    }
}
