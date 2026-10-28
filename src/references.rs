//! Reference presentation from native output tags, never reconstructed counters.
use crate::Engine;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use typst::WorldExt;
use typst::foundations::Content;
use typst::introspection::{Introspector, Location, Tag};
use typst::layout::{Frame, FrameItem};
use typst::model::{CiteElem, CiteGroup, RefElem};
use typst_html::HtmlNode;

struct Active {
    location: Location,
    value: Value,
    text: String,
}

struct Collector<'a> {
    engine: &'a Engine,
    introspector: &'a dyn Introspector,
    active: Vec<Active>,
    output: Vec<Value>,
    ambiguous: HashSet<String>,
}

impl Collector<'_> {
    fn source(&self, content: &Content) -> Option<Value> {
        let span = content.span();
        self.engine
            .location(span.id()?, self.engine.world.range(span)?)
    }

    fn tag(&mut self, tag: &Tag) {
        match tag {
            Tag::Start(content, _) => {
                if let Some(group) = content.to_packed::<CiteGroup>() {
                    let citations: Vec<_> = group
                        .children
                        .iter()
                        .filter_map(|child| {
                            Some((child.to_packed::<CiteElem>()?.key, self.source(child)?))
                        })
                        .collect();
                    let Some((_, first)) = citations.first() else {
                        return;
                    };
                    // A repeated child span is an executed macro, not one
                    // editable occurrence. Reject it before forming a union.
                    let mut seen = HashSet::new();
                    let repeated = citations
                        .iter()
                        .any(|(_, source)| !seen.insert(source.to_string()));
                    let mut ordered: Vec<_> = citations.iter().map(|(_, source)| source).collect();
                    ordered.sort_by_key(|source| source["from"].as_u64());
                    let contiguous = ordered.windows(2).all(|pair| {
                        if pair[0]["path"] != pair[1]["path"] {
                            return false;
                        }
                        let Some(path) = pair[0]["path"].as_str() else {
                            return false;
                        };
                        let (Some(end), Some(start)) =
                            (pair[0]["to"].as_u64(), pair[1]["from"].as_u64())
                        else {
                            return false;
                        };
                        if end > start {
                            return false;
                        }
                        let (Ok((source, a)), Ok((_, b))) = (
                            self.engine.source(path, end as usize),
                            self.engine.source(path, start as usize),
                        ) else {
                            return false;
                        };
                        source.text()[a..b]
                            .trim_end_matches('#')
                            .chars()
                            .all(char::is_whitespace)
                    });
                    if repeated
                        || !contiguous
                        || citations
                            .iter()
                            .any(|(_, source)| source["path"] != first["path"])
                    {
                        self.ambiguous
                            .extend(citations.iter().map(|(_, source)| source.to_string()));
                        return;
                    }
                    let mut source = first.clone();
                    source["from"] = json!(
                        citations
                            .iter()
                            .filter_map(|(_, source)| source["from"].as_u64())
                            .min()
                            .unwrap()
                    );
                    source["to"] = json!(
                        citations
                            .iter()
                            .filter_map(|(_, source)| source["to"].as_u64())
                            .max()
                            .unwrap()
                    );
                    let keys: Vec<_> = citations
                        .iter()
                        .map(|(key, _)| key.resolve().as_str().to_owned())
                        .collect();
                    // Prefer the matching native outer occurrence. It owns
                    // show-rule prefixes/suffixes around its citation group.
                    // Distinct enclosing citations (e.g. supplements) survive.
                    let matches = |entry: &Active| {
                        entry.value["kind"] == "citation"
                            && entry.value["source"]["path"] == source["path"]
                            && entry.value["source"]["from"].as_u64() >= source["from"].as_u64()
                            && entry.value["source"]["to"].as_u64() <= source["to"].as_u64()
                            && entry.value["keys"].as_array().is_some_and(|old| {
                                old.iter().any(|key| {
                                    keys.iter()
                                        .any(|value| key.as_str() == Some(value.as_str()))
                                })
                            })
                    };
                    let owner = self
                        .active
                        .iter()
                        .filter(|entry| matches(entry))
                        .min_by_key(|entry| entry.value["source"]["from"].as_u64())
                        .map(|entry| entry.location);
                    if let Some(owner) = owner {
                        self.active
                            .retain(|entry| entry.location == owner || !matches(entry));
                        let outer = self
                            .active
                            .iter_mut()
                            .find(|entry| entry.location == owner)
                            .unwrap();
                        outer.value["keys"] = json!(keys);
                        outer.value["source"] = source;
                        return;
                    }
                    self.active.push(Active {
                        location: tag.location(),
                        value: json!({
                            "keys": keys,
                            "kind": "citation", "source": source, "target": null,
                        }),
                        text: String::new(),
                    });
                    return;
                }
                let (key, kind) = if let Some(reference) = content.to_packed::<RefElem>() {
                    (
                        reference.target,
                        if self.introspector.query_label(reference.target).is_ok() {
                            "reference"
                        } else {
                            "citation"
                        },
                    )
                } else if let Some(citation) = content.to_packed::<CiteElem>() {
                    // The ref shorthand can synthesize an inner citation. Its
                    // outer native tag already owns the full printed result.
                    let Some(source) = self.source(content) else {
                        return;
                    };
                    if self.active.iter().any(|entry| {
                        entry.value["source"] == source
                            && entry.value["kind"] == "citation"
                            && entry.value["keys"].as_array().is_some_and(|keys| {
                                keys.iter().any(|key| {
                                    key.as_str() == Some(citation.key.resolve().as_str())
                                })
                            })
                    }) {
                        return;
                    }
                    (citation.key, "citation")
                } else {
                    return;
                };
                let Some(source) = self.source(content) else {
                    return;
                };
                let target = self
                    .introspector
                    .query_label(key)
                    .ok()
                    .and_then(|target| self.source(target));
                self.active.push(Active {
                    location: tag.location(),
                    value: json!({
                        "keys": [key.resolve().as_str()], "kind": kind, "source": source,
                        "target": target,
                    }),
                    text: String::new(),
                });
            }
            Tag::End(location, ..) => {
                if let Some(index) = self
                    .active
                    .iter()
                    .position(|entry| entry.location == *location)
                {
                    let mut entry = self.active.remove(index);
                    if !entry.text.trim().is_empty() {
                        entry.value["text"] = json!(entry.text);
                        self.output.push(entry.value);
                    }
                }
            }
        }
    }

    fn text(&mut self, text: &str) {
        for entry in &mut self.active {
            entry.text.push_str(text);
        }
    }

    fn frame(&mut self, frame: &Frame) {
        for (_, item) in frame.items() {
            match item {
                FrameItem::Group(group) => self.frame(&group.frame),
                FrameItem::Text(text) => self.text(&text.text),
                FrameItem::Tag(tag) => self.tag(tag),
                _ => {}
            }
        }
    }

    fn html(&mut self, node: &HtmlNode) {
        match node {
            HtmlNode::Tag(tag) => self.tag(tag),
            HtmlNode::Text(text, _) => self.text(text),
            HtmlNode::Element(element) => {
                for child in &element.children {
                    self.html(child);
                }
            }
            HtmlNode::Frame(frame) => self.frame(&frame.inner),
        }
    }

    fn finish(self) -> Vec<Value> {
        // A macro can typeset one source span multiple times with different
        // context. No single inline label can faithfully represent that span.
        let mut counts = HashMap::<String, usize>::new();
        for entry in &self.output {
            *counts.entry(entry["source"].to_string()).or_default() += 1;
        }
        self.output
            .into_iter()
            .filter(|entry| {
                counts[&entry["source"].to_string()] == 1
                    && !self.ambiguous.contains(&entry["source"].to_string())
            })
            .collect()
    }
}

impl Engine {
    pub(crate) fn paged_references(&self, document: &typst_layout::PagedDocument) -> Vec<Value> {
        let mut collector = Collector {
            engine: self,
            introspector: document.introspector().as_ref(),
            active: Vec::new(),
            output: Vec::new(),
            ambiguous: HashSet::new(),
        };
        for page in document.pages() {
            collector.frame(&page.frame);
        }
        collector.finish()
    }

    pub(crate) fn html_references(&self, document: &typst_html::HtmlDocument) -> Vec<Value> {
        let mut collector = Collector {
            engine: self,
            introspector: document.introspector().as_ref(),
            active: Vec::new(),
            output: Vec::new(),
            ambiguous: HashSet::new(),
        };
        collector.html(document.root_node());
        collector.finish()
    }
}
