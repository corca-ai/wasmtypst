use serde::Serialize;
use typst_syntax::{
    SyntaxNode,
    ast::{self},
};
use wasm_bindgen::prelude::*;

/// Offsets always address the caller's original UTF-16 text, including CRLF.
#[derive(Debug, Serialize)]
pub struct Syntax {
    kind: String,
    from: usize,
    to: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    block: Option<bool>,
    children: Vec<Syntax>,
}

pub fn parse(source: &str) -> Result<Syntax, String> {
    if source.len() > 8_000_000 {
        return Err("Syntax input exceeds 8 MB".into());
    }
    let root = typst_syntax::parse(source);
    let mut offset = 0;
    let mut remaining = 262_144;
    convert(&root, &mut offset, &mut remaining, 0)
}

fn convert(
    node: &SyntaxNode,
    offset: &mut usize,
    remaining: &mut usize,
    depth: usize,
) -> Result<Syntax, String> {
    if *remaining == 0 || depth > 256 {
        return Err("Syntax tree exceeds editor limits".into());
    }
    *remaining -= 1;
    let from = *offset;
    let mut children = Vec::new();
    for child in node.children() {
        children.push(convert(child, offset, remaining, depth + 1)?);
    }
    if children.is_empty() {
        *offset += node.leaf_text().encode_utf16().count();
    }
    let value = match node.cast::<ast::Expr>() {
        Some(ast::Expr::Escape(v)) => Some(v.get().to_string()),
        Some(ast::Expr::Shorthand(v)) => Some(v.get().to_string()),
        Some(ast::Expr::Str(v)) => Some(v.get().to_string()),
        _ => None,
    };
    let block = node
        .cast::<ast::Equation>()
        .map(|equation| equation.block());
    Ok(Syntax {
        kind: format!("{:?}", node.kind()),
        from,
        to: *offset,
        value,
        block,
        children,
    })
}

#[wasm_bindgen]
pub fn parse_markup(source: &str) -> Result<JsValue, JsValue> {
    let tree = parse(source).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&tree).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn flatten<'a>(n: &'a Syntax, output: &mut Vec<&'a Syntax>) {
        output.push(n);
        for c in &n.children {
            flatten(c, output);
        }
    }
    #[test]
    fn official_markup_and_utf16() {
        let text = "= 결과😀\r\nA *strong* _emph_ \u{2014} $ frac(1, 2) $\r\n\r\n#let x = [raw]\n- Item\n+ Ordered";
        let tree = parse(text).unwrap();
        assert_eq!(tree.to, text.encode_utf16().count());
        let mut nodes = Vec::new();
        flatten(&tree, &mut nodes);
        for kind in [
            "Heading",
            "Strong",
            "Emph",
            "Equation",
            "LetBinding",
            "ListItem",
            "EnumItem",
        ] {
            assert!(nodes.iter().any(|n| n.kind == kind), "{kind}");
        }
        assert!(
            nodes
                .iter()
                .any(|n| n.kind == "Equation" && n.block == Some(true))
        );
    }
    #[test]
    fn escaped_text_and_errors_have_exact_ranges() {
        let text = r"a \# \u{1F600} --- #let broken = (";
        let root = parse(text).unwrap();
        let mut nodes = Vec::new();
        flatten(&root, &mut nodes);
        assert!(nodes.iter().any(|n| n.value.as_deref() == Some("#")));
        assert!(nodes.iter().any(|n| n.value.as_deref() == Some("😀")));
        assert!(nodes.iter().any(|n| n.kind == "Error"));
        assert!(nodes.iter().all(|n| n.to <= root.to && n.from <= n.to));
    }
    #[test]
    fn bounded_input_and_walk() {
        assert!(parse(&"x".repeat(8_000_001)).is_err());
        assert!(parse(&"*a* ".repeat(100_000)).is_err());
        assert!(parse("Still usable").is_ok());
    }
}
