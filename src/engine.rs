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
        }
    }

    fn changed(&mut self) {
        self.revision = self
            .revision
            .checked_add(1)
            .expect("Revision exhausted; create a new engine");
        self.pdf = None;
    }

    pub fn put(&mut self, path: &str, bytes: Vec<u8>) -> Result<u32, String> {
        if self.world.put(path, bytes)? {
            self.changed();
        }
        Ok(self.revision)
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
            "trace": d.trace.iter().map(|t| format!("{:?}", t.v)).collect::<Vec<_>>() })
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
            "compile" => Ok(serde_json::to_value(self.compile()).unwrap()),
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
