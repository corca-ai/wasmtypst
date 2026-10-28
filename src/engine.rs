use crate::world::{MemoryWorld, file_id, path_for};
use serde::Serialize;
use serde_json::{Value, json};
use std::num::NonZeroUsize;
use typst::diag::SourceDiagnostic;
use typst::foundations::{Datetime, Dict};
use typst::introspection::PagedPosition;
use typst::layout::{Abs, Point};
use typst::syntax::{FileId, Source};
use typst::{World, WorldExt};
use typst_layout::PagedDocument;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileReport {
    pub revision: u32,
    pub success: bool,
    pub pages: Vec<PageInfo>,
    pub diagnostics: Vec<Value>,
    pub dependencies: Vec<String>,
    pub missing_files: Vec<String>,
    pub fingerprint: String,
    pub references: Vec<Value>,
}

#[derive(Clone, Serialize)]
pub struct PageInfo {
    pub width: f64,
    pub height: f64,
}

pub struct Engine {
    pub(crate) world: MemoryWorld,
    pub(crate) revision: u32,
    pub(crate) document: Option<PagedDocument>,
    compiled_revision: Option<u32>,
    report: Option<CompileReport>,
    pdf: Option<Vec<u8>>,
    html: Option<(bool, bool, Value)>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Self {
            world: MemoryWorld::new(),
            revision: 0,
            document: None,
            compiled_revision: None,
            report: None,
            pdf: None,
            html: None,
        }
    }

    fn changed(&mut self) {
        self.revision = self
            .revision
            .checked_add(1)
            .expect("Revision exhausted; create a new engine");
        self.pdf = None;
        self.html = None;
        self.document = None;
        self.report = None;
        self.compiled_revision = None;
    }

    pub fn put(&mut self, path: &str, bytes: Vec<u8>) -> Result<u32, String> {
        if self.world.put(path, bytes)? {
            self.changed();
        }
        Ok(self.revision)
    }

    /// Validate a replacement inventory in isolation; publish exactly one revision.
    pub fn snapshot(&mut self, files: Vec<(String, Vec<u8>)>, entry: &str) -> Result<u32, String> {
        let mut next = self.world.clone();
        let id = file_id(entry)?;
        if matches!(id.root(), typst::syntax::VirtualRoot::Package(_)) {
            return Err("Entry must be a project file".into());
        }
        let mut ids = std::collections::HashSet::new();
        for (path, _) in &files {
            if !ids.insert(file_id(path)?) {
                return Err("Duplicate snapshot path".into());
            }
        }
        let removed: Vec<_> = next
            .files
            .keys()
            .filter(|id| !ids.contains(id))
            .copied()
            .collect();
        for id in removed {
            next.remove(&path_for(id))?;
        }
        // Remove replaced bytes before admission so replacement isn't limited by old assets.
        for (path, bytes) in &files {
            let id = file_id(path)?;
            if next
                .files
                .get(&id)
                .is_some_and(|old| old.as_slice() != bytes)
            {
                next.files.remove(&id);
            }
        }
        for (path, bytes) in files {
            next.put(&path, bytes)?;
        }
        next.main = id;
        if self.world.fingerprint() != next.fingerprint() {
            self.world = next;
            self.changed();
        }
        Ok(self.revision)
    }

    /// Semantic HTML uses the same World but the HTML target has independent diagnostics.
    pub fn compile_html(&mut self) -> Value {
        self.compile_html_with_math(false)
    }

    pub fn compile_html_with_math(&mut self, include_math: bool) -> Value {
        self.compile_html_options(include_math, false)
    }

    fn compile_html_options(&mut self, include_math: bool, include_source_map: bool) -> Value {
        if let Some((cached_math, cached_sources, result)) = &self.html
            && *cached_math == include_math
            && *cached_sources == include_source_map
        {
            return result.clone();
        }
        let result = typst::compile::<typst_html::HtmlDocument>(&self.world);
        let mut diagnostics: Vec<_> = result.warnings.iter().map(|d| self.diagnostic(d)).collect();
        let mut math = Vec::new();
        let mut source_map = Vec::new();
        let mut references = Vec::new();
        let output = result.output.and_then(|mut doc| {
            references = self.html_references(&doc);
            if include_math {
                self.html_math(&doc, doc.root_node(), &mut math);
            }
            if include_source_map {
                source_map = self.html_source_map(doc.root_mut());
            }
            typst_html::html(&doc, &Default::default())
        });
        let html = match output {
            Ok(html) => Some(html),
            Err(errors) => {
                diagnostics.extend(errors.iter().map(|d| self.diagnostic(d)));
                None
            }
        };
        let mut dependencies: Vec<_> = self
            .world
            .accessed
            .lock()
            .unwrap()
            .iter()
            .map(|id| path_for(*id))
            .collect();
        dependencies.sort();
        let missing: Vec<_> = dependencies
            .iter()
            .filter(|path| !self.world.files.contains_key(&file_id(path).unwrap()))
            .cloned()
            .collect();
        let report = json!({"revision":self.revision, "success":html.is_some(), "html":html,
            "diagnostics":diagnostics, "dependencies":dependencies, "missingFiles":missing,
            "fingerprint": self.world.fingerprint(), "references": if html.is_some() { references } else { Vec::new() }, "math": if html.is_some() { math } else { Vec::new() }, "sourceMap": if html.is_some() { source_map } else { Vec::new() }});
        self.html = Some((include_math, include_source_map, report.clone()));
        comemo::evict(10);
        report
    }

    fn html_math(
        &self,
        document: &typst_html::HtmlDocument,
        node: &typst_html::HtmlNode,
        output: &mut Vec<Value>,
    ) {
        if let typst_html::HtmlNode::Element(element) = node {
            if element.tag == typst_html::tag::mathml::math {
                let location = element.span.id().and_then(|id| {
                    self.world
                        .range(element.span)
                        .and_then(|range| self.location(id, range))
                });
                if let Some(location) = location {
                    let mut fragment = document.clone();
                    // MathML alignment classes depend on the document's generated CSS.
                    // Keep head styles in the isolated fragment; these remain untrusted
                    // document output and must be sanitized or sandboxed by the host.
                    let mut root = typst_html::HtmlElement::new(typst_html::tag::div);
                    for child in &document.root().children {
                        if let typst_html::HtmlNode::Element(head) = child
                            && head.tag == typst_html::tag::head
                        {
                            for child in &head.children {
                                if let typst_html::HtmlNode::Element(style) = child
                                    && style.tag == typst_html::tag::style
                                {
                                    root.children.push(child.clone());
                                }
                            }
                        }
                    }
                    root.children.push(element.clone().into());
                    *fragment.root_mut() = root;
                    if let Ok(html) = typst_html::html(&fragment, &Default::default()) {
                        output.push(json!({"location": location, "html": html}));
                    }
                }
            } else {
                for child in &element.children {
                    self.html_math(document, child, output);
                }
            }
        }
    }

    pub fn remove(&mut self, path: &str) -> Result<u32, String> {
        if self.world.remove(path)? {
            self.changed();
        }
        Ok(self.revision)
    }

    pub fn entry(&mut self, path: &str) -> Result<u32, String> {
        let id = file_id(path)?;
        if matches!(id.root(), typst::syntax::VirtualRoot::Package(_)) {
            return Err("Entry must be a project file".into());
        }
        if id != self.world.main {
            self.world.main = id;
            self.changed();
        }
        Ok(self.revision)
    }

    pub fn add_font(&mut self, bytes: Vec<u8>) -> Result<u32, String> {
        if self.world.add_font(bytes)? {
            self.changed();
        }
        Ok(self.revision)
    }

    pub fn compile(&mut self) -> CompileReport {
        if self.compiled_revision == Some(self.revision) {
            return self.report.as_ref().unwrap().clone();
        }
        let result = typst::compile::<PagedDocument>(&self.world);
        let mut diagnostics: Vec<_> = result.warnings.iter().map(|d| self.diagnostic(d)).collect();
        let (document, success) = match result.output {
            Ok(doc) => (Some(doc), true),
            Err(errors) => {
                diagnostics.extend(errors.iter().map(|d| self.diagnostic(d)));
                (None, false)
            }
        };
        let pages = document
            .as_ref()
            .map(|d| {
                d.pages()
                    .iter()
                    .map(|p| PageInfo {
                        width: p.frame.width().to_pt(),
                        height: p.frame.height().to_pt(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut dependencies: Vec<_> = self
            .world
            .accessed
            .lock()
            .unwrap()
            .iter()
            .map(|id| path_for(*id))
            .collect();
        dependencies.sort();
        let mut missing_files: Vec<_> = self
            .world
            .accessed
            .lock()
            .unwrap()
            .iter()
            .filter(|id| !self.world.files.contains_key(id))
            .map(|id| path_for(*id))
            .collect();
        missing_files.sort();
        let report = CompileReport {
            revision: self.revision,
            success,
            pages,
            diagnostics,
            dependencies,
            missing_files,
            references: document
                .as_ref()
                .map(|doc| self.paged_references(doc))
                .unwrap_or_default(),
            fingerprint: self.world.fingerprint(),
        };
        self.document = document;
        self.compiled_revision = Some(self.revision);
        self.report = Some(report.clone());
        self.pdf = None;
        comemo::evict(10);
        report
    }

    pub fn current(&self, revision: u32) -> Result<&PagedDocument, String> {
        if revision != self.revision || self.compiled_revision != Some(revision) {
            return Err("Stale output revision".into());
        }
        self.document
            .as_ref()
            .ok_or("No successful compilation at this revision".into())
    }

    pub fn export_pdf(&mut self, revision: u32) -> Result<Vec<u8>, String> {
        self.current(revision)?;
        if self.pdf.is_none() {
            let document = self.document.as_ref().unwrap();
            self.pdf = Some(
                typst_pdf::pdf(document, &typst_pdf::PdfOptions::default()).map_err(|e| {
                    e.iter()
                        .map(|d| d.message.as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                })?,
            );
        }
        Ok(self.pdf.as_ref().unwrap().clone())
    }

    pub fn svg(&self, revision: u32, page: usize) -> Result<String, String> {
        let doc = self.current(revision)?;
        let page = page
            .checked_sub(1)
            .and_then(|p| doc.pages().get(p))
            .ok_or("Invalid page")?;
        Ok(typst_svg::svg(page, &typst_svg::SvgOptions::default()))
    }

    pub fn location(&self, id: FileId, range: std::ops::Range<usize>) -> Option<Value> {
        let source = self.world.source(id).ok()?;
        Some(
            json!({ "path": path_for(id), "from": source.lines().byte_to_utf16(range.start)?, "to": source.lines().byte_to_utf16(range.end)? }),
        )
    }

    fn diagnostic(&self, d: &SourceDiagnostic) -> Value {
        let location = d
            .span
            .id()
            .and_then(|id| self.world.range(d.span).and_then(|r| self.location(id, r)));
        json!({ "severity": format!("{:?}", d.severity).to_lowercase(), "message": d.message,
            "hints": d.hints.iter().map(|h| h.v.as_str()).collect::<Vec<_>>(), "location": location,
            "trace": d.trace.iter().map(|t| format!("{:?}", t.v)).collect::<Vec<_>>(),
            "traceDetails": d.trace.iter().map(|t| json!({
                "message": t.v.to_string(),
                "location": t.span.id().and_then(|id| self.world.range(t.span).and_then(|range| self.location(id, range)))
            })).collect::<Vec<_>>() })
    }

    pub fn source(&self, path: &str, offset: usize) -> Result<(Source, usize), String> {
        let source = self
            .world
            .source(file_id(path)?)
            .map_err(|e| e.to_string())?;
        let byte = source
            .lines()
            .utf16_to_byte(offset)
            .filter(|b| source.lines().byte_to_utf16(*b) == Some(offset))
            .ok_or("Invalid UTF-16 offset")?;
        Ok((source, byte))
    }

    pub fn request(&mut self, request: Value) -> Result<Value, String> {
        let op = request["op"].as_str().ok_or("Missing op")?;
        let path = request["path"].as_str().unwrap_or("main.typ");
        match op {
            "entry" => Ok(json!(self.entry(path)?)),
            "remove" => Ok(json!(self.remove(path)?)),
            "compileHtml" => {
                let include_math = request
                    .get("math")
                    .map(|value| value.as_bool().ok_or("math must be boolean"))
                    .transpose()?
                    .unwrap_or(false);
                let include_source_map = request
                    .get("sourceMap")
                    .map(|value| value.as_bool().ok_or("sourceMap must be boolean"))
                    .transpose()?
                    .unwrap_or(false);
                Ok(self.compile_html_options(include_math, include_source_map))
            }
            "compile" => Ok(serde_json::to_value(self.compile()).unwrap()),
            "missingFiles" => {
                let mut missing: Vec<_> = self
                    .world
                    .accessed
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|id| !self.world.files.contains_key(id))
                    .map(|id| path_for(*id))
                    .collect();
                missing.sort();
                Ok(json!(missing))
            }
            "configure" => {
                let mut inputs = Dict::new();
                if let Some(values) = request["inputs"].as_object() {
                    for (key, value) in values {
                        inputs.insert(
                            key.as_str().into(),
                            typst::foundations::Value::Str(
                                value.as_str().ok_or("Input values must be strings")?.into(),
                            ),
                        );
                    }
                }
                let date = if let Some(date) = request["date"].as_array() {
                    if date.len() != 3 {
                        return Err("Date must be [year, month, day]".into());
                    }
                    let number = |n: usize| date[n].as_i64().ok_or("Invalid date");
                    Some(
                        Datetime::from_ymd(
                            number(0)?.try_into().map_err(|_| "Invalid year")?,
                            number(1)?.try_into().map_err(|_| "Invalid month")?,
                            number(2)?.try_into().map_err(|_| "Invalid day")?,
                        )
                        .ok_or("Invalid calendar date")?,
                    )
                } else {
                    None
                };
                self.world.set_inputs(inputs);
                self.world
                    .set_config_identity(serde_json::to_vec(&request).unwrap());
                self.world.date = date;
                self.changed();
                Ok(json!(self.revision))
            }
            "sourceToOutput" => {
                let revision = revision(&request)?;
                let doc = self.current(revision)?;
                let (source, cursor) = self.source(path, offset(&request)?)?;
                Ok(json!(typst_ide::jump_from_cursor(doc, &source, cursor).iter().map(|p| json!({"page": p.page.get(), "x": p.point.x.to_pt(), "y": p.point.y.to_pt()})).collect::<Vec<_>>()))
            }
            "outputToSource" => {
                let doc = self.current(revision(&request)?)?;
                let page = request["page"]
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .and_then(NonZeroUsize::new)
                    .ok_or("Invalid page")?;
                let x = request["x"]
                    .as_f64()
                    .filter(|x| x.is_finite())
                    .ok_or("Invalid x")?;
                let y = request["y"]
                    .as_f64()
                    .filter(|x| x.is_finite())
                    .ok_or("Invalid y")?;
                let p = PagedPosition {
                    page,
                    point: Point::new(Abs::pt(x), Abs::pt(y)),
                };
                Ok(match typst_ide::jump_from_click(&self.world, doc, &p) {
                    Some(typst_ide::Jump::File(id, byte)) => {
                        self.location(id, byte..byte).unwrap_or(Value::Null)
                    }
                    Some(typst_ide::Jump::Url(url)) => json!({"url": url.as_str()}),
                    Some(typst_ide::Jump::Position(p)) => {
                        json!({"page": p.page.get(), "x": p.point.x.to_pt(), "y": p.point.y.to_pt()})
                    }
                    None => Value::Null,
                })
            }
            _ => self.ide_request(&request),
        }
    }
}

pub fn offset(v: &Value) -> Result<usize, String> {
    v["offset"]
        .as_u64()
        .and_then(|n| usize::try_from(n).ok())
        .ok_or("Invalid offset".into())
}
pub fn revision(v: &Value) -> Result<u32, String> {
    v["revision"]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .ok_or("Invalid revision".into())
}
