//! Opt-in HTML provenance. Attributes annotate existing elements only: no wrappers
//! are added and no rendered text or CSS selectors are changed.
use crate::Engine;
use serde_json::{Value, json};
use typst::WorldExt;
use typst::syntax::Span;
use typst_html::{HtmlAttr, HtmlElement, HtmlNode};

const SOURCE: HtmlAttr = HtmlAttr::constant("data-typst");

impl Engine {
    fn html_span(&self, span: Span) -> Option<Value> {
        span.id().and_then(|id| {
            self.world
                .range(span)
                .and_then(|range| self.location(id, range))
        })
    }

    pub(crate) fn html_source_map(&self, root: &mut HtmlElement) -> Vec<Value> {
        let mut entries = Vec::new();
        let mut next = 0;
        self.html_element_sources(root, &mut next, &mut entries, false);
        entries
    }

    fn html_element_sources(
        &self,
        element: &mut HtmlElement,
        next: &mut usize,
        entries: &mut Vec<Value>,
        in_body: bool,
    ) {
        // A source-authored attribute must never impersonate engine provenance.
        element
            .attrs
            .0
            .retain(|(key, _)| !key.resolve().eq_ignore_ascii_case("data-typst"));
        let in_body = in_body || element.tag == typst_html::tag::body;
        let id = format!("s{next}");
        *next += 1;
        let before = entries.len();
        if in_body && let Some(location) = self.html_span(element.span) {
            entries.push(json!({"id":id, "location":location}));
        }
        let mut child_index = 0;
        let mut text_offset = 0;
        let mut text_open = false;
        let mut own_entries = entries.len() > before;
        for child in element.children.make_mut().iter_mut() {
            match child {
                HtmlNode::Tag(_) => (), // Introspection tags emit no DOM nodes.
                HtmlNode::Text(text, span) => {
                    let length = text.encode_utf16().count();
                    if length == 0 {
                        continue;
                    }
                    if in_body && let Some(location) = self.html_span(*span) {
                        entries.push(json!({"id":id, "location":location,
                            "text":{"child":child_index, "from":text_offset,
                                "to":text_offset + length}}));
                        own_entries = true;
                    }
                    text_offset += length;
                    text_open = true;
                }
                HtmlNode::Element(child) => {
                    if text_open {
                        child_index += 1;
                    }
                    self.html_element_sources(child, next, entries, in_body);
                    child_index += 1;
                    text_offset = 0;
                    text_open = false;
                }
                HtmlNode::Frame(frame) => {
                    if text_open {
                        child_index += 1;
                    }
                    if in_body && let Some(location) = self.html_span(frame.span) {
                        entries.push(json!({"id":id, "location":location}));
                        own_entries = true;
                    }
                    child_index += 1;
                    text_offset = 0;
                    text_open = false;
                }
            }
        }
        if own_entries {
            element.attrs.push(SOURCE, id);
        }
    }
}
