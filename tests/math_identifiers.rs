use serde_json::{Value, json};
use wasmtypst::Engine;

fn engine(text: &str) -> Engine {
    let mut engine = Engine::new();
    engine.put("main.typ", text.as_bytes().to_vec()).unwrap();
    engine
}
fn at(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}
fn query(engine: &mut Engine, op: &str, offset: usize) -> Value {
    engine
        .request(json!({"op":op,"path":"main.typ","offset":offset}))
        .unwrap()
}

#[test]
fn math_bindings_resolve_before_layout_and_roundtrip_rename() {
    for ending in ["\n", "\r\n", "\r"] {
        let text = format!("\u{feff}// 😀{ending}#let factor = 2{ending}$factor + factor$");
        let mut e = engine(&text);
        let cursor = at(&text, text.rfind("factor").unwrap()) + 1;
        let definition = query(&mut e, "definition", cursor);
        let from = at(&text, text.find("factor").unwrap());
        assert_eq!(definition["from"], from, "{ending:?}: {definition}");
        assert_eq!(definition["to"], from + 6);
        let references = query(&mut e, "references", cursor);
        assert_eq!(references.as_array().unwrap().len(), 3, "{references}");
        let plan = e
            .request(json!({"op":"rename","path":"main.typ","offset":cursor,"newName":"magnitude"}))
            .unwrap();
        let edits = plan["edits"].as_array().unwrap();
        assert_eq!(edits.len(), 3);
        let mut units: Vec<u16> = text.encode_utf16().collect();
        for edit in edits.iter().rev() {
            let from = edit["from"].as_u64().unwrap() as usize;
            let to = edit["to"].as_u64().unwrap() as usize;
            assert_eq!(String::from_utf16(&units[from..to]).unwrap(), "factor");
            units.splice(from..to, "magnitude".encode_utf16());
        }
        let renamed = String::from_utf16(&units).unwrap();
        assert_eq!(renamed, text.replace("factor", "magnitude"));
        e.put("main.typ", renamed.into_bytes()).unwrap();
        let compiled = e.compile();
        assert!(compiled.success, "{:?}", compiled.diagnostics);
    }
}

#[test]
fn math_bindings_respect_shadowing_and_native_closure_parameters() {
    let text = "#let factor = 2\n$factor$\n#{ let factor = 3; $factor$ }\n$factor$";
    let mut e = engine(text);
    let cursor = at(text, text.rfind("factor").unwrap()) + 1;
    let references = query(&mut e, "references", cursor);
    assert_eq!(references.as_array().unwrap().len(), 3, "{references}");
    let text = "#let calc(factor) = $factor + factor$\n#calc(2)";
    e.put("main.typ", text.as_bytes().to_vec()).unwrap();
    let cursor = at(text, text.rfind("factor").unwrap()) + 1;
    assert_eq!(query(&mut e, "definition", cursor)["from"], 10);
    assert_eq!(
        query(&mut e, "references", cursor)
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn imported_bindings_and_math_callees_share_the_native_world() {
    let text = "#import \"lib.typ\": factor, calc\n$factor + calc(2)$";
    let mut e = engine(text);
    e.put(
        "lib.typ",
        b"#let factor = 3\n#let calc(value) = value".to_vec(),
    )
    .unwrap();
    for name in ["factor", "calc"] {
        let cursor = at(text, text.rfind(name).unwrap()) + 1;
        assert_eq!(query(&mut e, "definition", cursor)["path"], "lib.typ");
        assert_eq!(
            query(&mut e, "references", cursor)
                .as_array()
                .unwrap()
                .len(),
            3
        );
    }
}

#[test]
fn math_field_members_and_unresolved_names_are_not_lexical_bindings() {
    let text = "#let alpha = 2\n$sym.alpha + alpha + unresolved$";
    let mut e = engine(text);
    let field = at(text, text.find("sym.alpha").unwrap() + 4) + 1;
    assert!(query(&mut e, "definition", field).is_null());
    assert_eq!(query(&mut e, "references", field), json!([]));
    let use_site = at(text, text.rfind("alpha").unwrap()) + 1;
    let references = query(&mut e, "references", use_site);
    assert_eq!(references.as_array().unwrap().len(), 2, "{references}");
    let unresolved = at(text, text.find("unresolved").unwrap()) + 1;
    assert!(query(&mut e, "definition", unresolved).is_null());
    assert_eq!(query(&mut e, "references", unresolved), json!([]));
    assert!(
        e.request(json!({"op":"rename","path":"main.typ","offset":unresolved,"newName":"renamed"}))
            .is_err()
    );
}

#[test]
fn rename_refuses_capturing_a_math_only_builtin_use() {
    let text = "#let factor = 2\n$sin(0) + factor$";
    let mut e = engine(text);
    let cursor = at(text, text.rfind("factor").unwrap()) + 1;
    let refusal = e
        .request(json!({"op":"rename","path":"main.typ","offset":cursor,"newName":"sin"}))
        .unwrap_err();
    assert!(refusal.contains("capture"), "{refusal}");
}

#[test]
fn rename_refuses_code_names_that_change_native_math_binding_syntax() {
    let text = "#let factor = 2\n$factor + factor$";
    let mut e = engine(text);
    let cursor = at(text, text.rfind("factor").unwrap()) + 1;
    for name in ["x", "long-name"] {
        let refusal = e
            .request(json!({"op":"rename","path":"main.typ","offset":cursor,"newName":name}))
            .unwrap_err();
        assert!(
            refusal.contains("native math identifier"),
            "{name}: {refusal}"
        );
        assert_eq!(
            query(&mut e, "references", cursor)
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(e.compile().success);
    }
}
