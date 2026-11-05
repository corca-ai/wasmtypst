use crate::{Engine, engine::offset, world::path_for};
use serde_json::{Value, json};
use typst::foundations::Value as TypstValue;
use typst::syntax::ast::AstNode;
use typst::syntax::{LinkedNode, Side, Source, Span, SyntaxKind, ast};
use typst::{World, WorldExt};
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

enum ImportBinding {
    Other,
    Resolved(Span),
    Unresolved,
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

    /// Rename follows a local alias binding; navigation still follows its export.
    /// All module values and scopes come from Typst's evaluator in this World.
    fn import_binding(&self, leaf: &LinkedNode) -> ImportBinding {
        if !matches!(leaf.kind(), SyntaxKind::Ident | SyntaxKind::MathIdent) {
            return ImportBinding::Other;
        }
        if let Some(parent) = leaf.parent() {
            let target = parent
                .cast::<ast::FieldAccess>()
                .filter(|access| access.field().span() == leaf.span())
                .map(|access| access.target().span())
                .or_else(|| {
                    parent
                        .cast::<ast::MathFieldAccess>()
                        .filter(|access| access.field().span() == leaf.span())
                        .map(|access| access.target().span())
                });
            if let Some(target) = target {
                let Some(target) = parent.find(target) else {
                    return ImportBinding::Unresolved;
                };
                let values = typst_ide::analyze_expr(&self.world, &target);
                if values.len() != 1 {
                    return ImportBinding::Unresolved;
                }
                let value = &values[0].0;
                let Some(native) = value
                    .scope()
                    .and_then(|scope| scope.get(leaf.get().leaf_text()))
                    .map(|binding| binding.span())
                else {
                    return ImportBinding::Other;
                };
                return self.export_binding(value, leaf.get().leaf_text(), native, 0);
            }
        }
        let wanted = leaf.get().leaf_text();
        let mut ancestor = leaf.parent().cloned();
        while let Some(node) = ancestor {
            if let Some(import) = node.cast::<ast::ModuleImport>() {
                if let Some(ast::Imports::Items(items)) = import.imports() {
                    for item in items.iter() {
                        if matches!(item, ast::ImportItem::Renamed(_))
                            && item.bound_name().span() == leaf.span()
                        {
                            return ImportBinding::Resolved(leaf.span());
                        }
                        if item.path().iter().any(|part| part.span() == leaf.span()) {
                            return self.import_path_binding(&node, import, item, leaf.span(), 0);
                        }
                    }
                }
                if import
                    .new_name()
                    .is_some_and(|name| name.span() == leaf.span())
                {
                    return ImportBinding::Resolved(leaf.span());
                }
                if node
                    .find(import.source().span())
                    .is_none_or(|source| source.find(leaf.span()).is_none())
                {
                    return ImportBinding::Other;
                }
            }
            ancestor = node.parent().cloned();
        }
        self.visible_import_binding(leaf, wanted, 0)
    }

    fn visible_import_binding(
        &self,
        leaf: &LinkedNode,
        wanted: &str,
        depth: usize,
    ) -> ImportBinding {
        if depth >= 64 {
            return ImportBinding::Unresolved;
        }
        // Native named_items exposes an import's bindings even while its source
        // expression is being evaluated. Match its import enumeration order to
        // exclude only these not-yet-visible bindings, retaining nested scopes.
        let mut exclusions = self.import_scope_exclusions(leaf, wanted).into_iter();
        // Ask the native scope walk first, so closure/loop/let shadowing wins.
        let imported = typst_ide::named_items(&self.world, leaf.clone(), |item| {
            let (name, target) = match item {
                NamedItem::Import(name, span, _) => {
                    if name.as_str() == wanted && exclusions.next().unwrap_or(true) {
                        return None;
                    }
                    (name, Some(span))
                }
                NamedItem::Module(name, _, _) => {
                    if name.as_str() == wanted && exclusions.next().unwrap_or(true) {
                        return None;
                    }
                    (name, None)
                }
                NamedItem::Var(ident) | NamedItem::Fn(ident) => (ident.get(), None),
            };
            (name.as_str() == wanted).then_some(target)
        });
        let Some(Some(target)) = imported else {
            return ImportBinding::Other;
        };
        let mut ancestor = Some(leaf.clone());
        while let Some(node) = ancestor {
            let mut sibling = Some(node.clone());
            while let Some(candidate) = sibling {
                if let Some(import) = candidate.cast::<ast::ModuleImport>() {
                    if candidate
                        .find(import.source().span())
                        .is_some_and(|source| source.find(leaf.span()).is_some())
                    {
                        sibling = candidate.prev_sibling();
                        continue;
                    }
                    match import.imports() {
                        Some(ast::Imports::Items(items)) => {
                            for item in items.iter() {
                                if item.bound_name().get().as_str() == wanted {
                                    return if matches!(item, ast::ImportItem::Renamed(_)) {
                                        ImportBinding::Resolved(item.bound_name().span())
                                    } else {
                                        self.import_path_binding(
                                            &candidate,
                                            import,
                                            item,
                                            item.original_name().span(),
                                            depth,
                                        )
                                    };
                                }
                            }
                        }
                        Some(ast::Imports::Wildcard) => {
                            if let Some(value) = self.import_value(&candidate, import)
                                && value
                                    .scope()
                                    .and_then(|scope| scope.get(wanted))
                                    .map(|binding| binding.span())
                                    == Some(target)
                            {
                                return self.export_binding(&value, wanted, target, depth);
                            }
                        }
                        None => {}
                    }
                }
                sibling = candidate.prev_sibling();
            }
            ancestor = node.parent().cloned();
        }
        ImportBinding::Unresolved
    }

    fn import_scope_exclusions(&self, position: &LinkedNode, wanted: &str) -> Vec<bool> {
        let mut exclusions = Vec::new();
        let mut ancestor = Some(position.clone());
        while let Some(node) = ancestor {
            let mut sibling = Some(node.clone());
            while let Some(candidate) = sibling {
                if let Some(import) = candidate.cast::<ast::ModuleImport>() {
                    let excluded = candidate
                        .find(import.source().span())
                        .is_some_and(|source| source.find(position.span()).is_some());
                    let module_name =
                        import
                            .new_name()
                            .map(|name| name.get().clone())
                            .or_else(|| {
                                import
                                    .imports()
                                    .is_none()
                                    .then(|| import.bare_name().ok())
                                    .flatten()
                            });
                    if module_name
                        .as_ref()
                        .is_some_and(|name| name.as_str() == wanted)
                    {
                        exclusions.push(excluded);
                    }
                    match import.imports() {
                        Some(ast::Imports::Items(items)) => {
                            for item in items.iter() {
                                if item.bound_name().get().as_str() == wanted {
                                    exclusions.push(excluded);
                                }
                            }
                        }
                        Some(ast::Imports::Wildcard)
                            if self.import_value(&candidate, import).is_some_and(|value| {
                                value
                                    .scope()
                                    .is_some_and(|scope| scope.get(wanted).is_some())
                            }) =>
                        {
                            exclusions.push(excluded);
                        }
                        _ => {}
                    }
                }
                sibling = candidate.prev_sibling();
            }
            ancestor = node.parent().cloned();
        }
        exclusions
    }

    fn import_value(&self, node: &LinkedNode, import: ast::ModuleImport) -> Option<TypstValue> {
        typst_ide::analyze_import(&self.world, &node.find(import.source().span())?)
    }

    fn import_path_binding(
        &self,
        node: &LinkedNode,
        import: ast::ModuleImport,
        item: ast::ImportItem,
        wanted: Span,
        depth: usize,
    ) -> ImportBinding {
        let Some(mut value) = self.import_value(node, import) else {
            return ImportBinding::Unresolved;
        };
        for part in item.path().iter() {
            let Some(binding) = value.scope().and_then(|scope| scope.get(part.get())) else {
                return ImportBinding::Unresolved;
            };
            if part.span() == wanted {
                return self.export_binding(&value, part.get(), binding.span(), depth);
            }
            value = binding.read().clone();
        }
        ImportBinding::Unresolved
    }

    fn export_binding(
        &self,
        value: &TypstValue,
        wanted: &str,
        native: Span,
        depth: usize,
    ) -> ImportBinding {
        // Module export values preserve their original declaration span even
        // across `as` reexports. Recover the local binding in the exporting
        // file's top-level native scope, never by matching its text globally.
        if let TypstValue::Module(module) = value
            && let Some(id) = module.file_id()
            && let Ok(source) = self.world.source(id)
            && let Some(position) = LinkedNode::new(source.root()).children().last()
        {
            match self.visible_import_binding(&position, wanted, depth + 1) {
                ImportBinding::Other => {}
                result => return result,
            }
        }
        ImportBinding::Resolved(native)
    }

    fn definition_span(&self, source: &Source, byte: usize) -> Option<Span> {
        let leaf = LinkedNode::new(source.root()).leaf_at(byte, Side::After)?;
        if leaf.kind() == SyntaxKind::Ident {
            let mut ancestor = leaf.parent().cloned();
            while let Some(node) = ancestor {
                let mut bindings = Vec::new();
                if let Some(binding) = node.cast::<ast::LetBinding>() {
                    bindings.extend(binding.kind().bindings());
                }
                if let Some(loop_) = node.cast::<ast::ForLoop>() {
                    bindings.extend(loop_.pattern().bindings());
                }
                if let Some(closure) = node.cast::<ast::Closure>() {
                    for parameter in closure.params().children() {
                        match parameter {
                            ast::Param::Pos(pattern) => bindings.extend(pattern.bindings()),
                            ast::Param::Named(named) => bindings.push(named.name()),
                            ast::Param::Spread(spread) => bindings.extend(spread.sink_ident()),
                        }
                    }
                }
                if bindings.iter().any(|binding| binding.span() == leaf.span()) {
                    return Some(leaf.span());
                }
                ancestor = node.parent().cloned();
            }
        }
        match self.import_binding(&leaf) {
            ImportBinding::Resolved(span) => return Some(span),
            ImportBinding::Unresolved => return None,
            ImportBinding::Other => {}
        }
        if let Some(Definition::Span(span)) = self.definition_at(source, byte) {
            return Some(span);
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
