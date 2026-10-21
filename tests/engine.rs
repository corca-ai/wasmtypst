use serde_json::{Value, json};
use wasmtypst::Engine;

fn engine(text: &str) -> Engine {
    let mut engine = Engine::new();
    engine.put("main.typ", text.as_bytes().to_vec()).unwrap();
    engine
}
fn at(text: &str, needle: &str) -> usize {
    text[..text.find(needle).unwrap()].encode_utf16().count()
}

#[test]
fn compiles_pdf_svg_and_keeps_output_revision() {
    let mut e = engine("= Hello\nMath $x^2 + y^2$ and *bold*.");
    let result = e.compile();
    assert!(result.success, "{:?}", result.diagnostics);
    assert_eq!(result.pages.len(), 1);
    let pdf = e.export_pdf(result.revision).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    assert!(pdf.windows(8).any(|s| s == b"/StructT"));
    assert!(e.svg(result.revision, 1).unwrap().contains("<svg"));
    assert_eq!(e.export_pdf(result.revision).unwrap(), pdf);
    assert!(e.svg(result.revision, 0).is_err());
    e.put("main.typ", b"Changed".to_vec()).unwrap();
    assert!(e.export_pdf(result.revision).unwrap_err().contains("Stale"));
    assert!(e.svg(result.revision, 1).is_err());
    assert!(
        e.request(json!({"op":"outputToSource","revision":result.revision,"page":1,"x":10,"y":10}))
            .is_err()
    );
}

#[test]
fn edits_imported_file_and_reports_real_diagnostics() {
    let mut e = engine("#include \"section.typ\"");
    let missing = e.compile();
    assert!(!missing.success);
    assert!(missing.missing_files.contains(&"section.typ".to_string()));
    e.put("section.typ", b"Initial text".to_vec()).unwrap();
    let first = e.compile();
    assert!(first.success, "{:?}", first.diagnostics);
    let pdf = e.export_pdf(first.revision).unwrap();
    e.put("section.typ", b"Different text".to_vec()).unwrap();
    let changed = e.compile();
    assert!(changed.success);
    assert_ne!(pdf, e.export_pdf(changed.revision).unwrap());
    e.put("section.typ", b"#unknown-function()".to_vec())
        .unwrap();
    let failed = e.compile();
    assert!(!failed.success);
    assert!(failed.diagnostics.iter().any(|d| {
        d["message"].as_str().unwrap().contains("unknown-function")
            && d["location"]["path"] == "section.typ"
    }));
    assert!(e.export_pdf(failed.revision).is_err());
    e.remove("section.typ").unwrap();
    assert!(!e.compile().success);
}

#[test]
fn navigation_roundtrips_prose_math_figure_table_and_nested_content() {
    let text = "#set page(width: 400pt, height: 600pt)\nProseMARK\n\n$ 719 $\n\n#figure(rect(width: 20pt), caption: [FigureMARK])\n\n#table(columns: 1, [TableMARK])\n\n#block[#text[NestedMARK]]";
    let mut e = engine(text);
    let r = e.compile();
    assert!(r.success, "{:?}", r.diagnostics);
    for needle in ["ProseMARK", "719", "FigureMARK", "TableMARK", "NestedMARK"] {
        let points = e.request(json!({"op":"sourceToOutput","revision":r.revision,"path":"main.typ","offset":at(text,needle)})).unwrap();
        let point = points
            .as_array()
            .unwrap()
            .first()
            .unwrap_or_else(|| panic!("No forward map for {needle}"));
        let back = e.request(json!({"op":"outputToSource","revision":r.revision,"page":point["page"],"x":point["x"].as_f64().unwrap()+1.0,"y":point["y"].as_f64().unwrap()-2.0})).unwrap();
        assert_eq!(
            back["path"], "main.typ",
            "No reverse map for {needle}: {back}"
        );
        let pos = back["from"].as_u64().unwrap() as usize;
        assert!(
            (at(text, needle)..=at(text, needle) + needle.len()).contains(&pos),
            "Wrong reverse map for {needle}: {back}"
        );
    }
}

#[test]
fn ide_uses_same_world_and_returns_useful_results() {
    let text = "#let answer=42\n#answer\n#text(size: 10pt)[Hello]";
    let mut e = engine(text);
    e.compile();
    let hover = e
        .request(json!({"op":"hover","path":"main.typ","offset":at(text,"#answer")+1}))
        .unwrap();
    assert!(hover["text"].as_str().unwrap().contains("42"));
    let definition = e
        .request(json!({"op":"definition","path":"main.typ","offset":at(text,"#answer")+1}))
        .unwrap();
    assert_eq!(definition["from"], 5);
    let references = e
        .request(json!({"op":"references","path":"main.typ","offset":at(text,"#answer")+1}))
        .unwrap();
    assert_eq!(references.as_array().unwrap().len(), 2);
    let rename = e.request(json!({"op":"rename","path":"main.typ","offset":at(text,"#answer")+1,"newName":"result"})).unwrap();
    assert_eq!(rename["edits"].as_array().unwrap().len(), 2);
    let format = e.request(json!({"op":"format","path":"main.typ"})).unwrap();
    assert!(format["text"].as_str().unwrap().contains("answer = 42"));
    let completion = e
        .request(json!({"op":"completion","path":"main.typ","offset":at(text,"#text")+3}))
        .unwrap();
    assert!(!completion["items"].as_array().unwrap().is_empty());
    assert!(
        !e.request(json!({"op":"semanticTokens","path":"main.typ"}))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        !e.request(json!({"op":"symbols","path":"main.typ"}))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn references_and_rename_respect_shadowing() {
    let text = "#let value = 1\n#value\n#{ let value = 2; value }\n#value";
    let mut e = engine(text);
    let refs = e
        .request(json!({"op":"references","path":"main.typ","offset":at(text,"#value")+1}))
        .unwrap();
    assert_eq!(refs.as_array().unwrap().len(), 3, "{refs}");
    assert!(
        e.request(
            json!({"op":"rename","path":"main.typ","offset":at(text,"#value")+1,"newName":"a b"})
        )
        .is_err()
    );
    assert!(
        e.request(
            json!({"op":"rename","path":"main.typ","offset":at(text,"#value")+1,"newName":"for"})
        )
        .is_err()
    );
}

#[test]
fn utf16_offsets_are_exact_and_surrogate_splits_are_refused() {
    let text = "😀 한글\n#let answer = 42\n#answer";
    let mut e = engine(text);
    let def = e
        .request(json!({"op":"definition","path":"main.typ","offset":at(text,"#answer")+1}))
        .unwrap();
    assert_eq!(def["from"], at(text, "answer ="));
    assert!(
        e.request(json!({"op":"hover","path":"main.typ","offset":1}))
            .is_err()
    );
    assert!(
        e.request(json!({"op":"hover","path":"main.typ","offset":9999}))
            .is_err()
    );
}

#[test]
fn package_and_wasm_plugin_work_without_network() {
    let mut e = engine("#import \"@preview/cmarker:0.1.8\"\n#cmarker.render(\"**PluginMARK**\")");
    for (path, bytes) in [
        (
            "typst.toml",
            include_bytes!("fixtures/cmarker/typst.toml").as_slice(),
        ),
        (
            "lib.typ",
            include_bytes!("fixtures/cmarker/lib.typ").as_slice(),
        ),
        (
            "plugin.wasm",
            include_bytes!("fixtures/cmarker/plugin.wasm").as_slice(),
        ),
    ] {
        e.put(&format!("@preview/cmarker:0.1.8/{path}"), bytes.to_vec())
            .unwrap();
    }
    let r = e.compile();
    assert!(r.success, "{:?}", r.diagnostics);
    assert!(e.export_pdf(r.revision).unwrap().len() > 1000);
}

#[test]
fn inputs_dates_binary_files_fonts_and_path_validation() {
    let mut e = engine("#sys.inputs.at(\"name\")\n#datetime.today().display()");
    assert!(
        e.request(json!({"op":"configure","inputs":{"name":"World"},"date":[2026,10,21]}))
            .is_ok()
    );
    assert!(e.compile().success);
    assert!(
        e.request(json!({"op":"configure","date":[2026,2,31]}))
            .is_err()
    );
    assert!(e.add_font(vec![1, 2, 3]).is_err());
    for path in [
        "",
        "../secret",
        "/absolute",
        "a/../secret",
        "a\\b",
        "a//b",
        "@preview/pkg:0.1.0/../escape",
    ] {
        assert!(e.put(path, b"text".to_vec()).is_err(), "{path}");
    }
    e.put("bad.typ", vec![0xff]).unwrap();
    e.entry("bad.typ").unwrap();
    assert!(!e.compile().success);
}

#[test]
fn project_switch_does_not_reuse_another_entrys_output() {
    let mut e = engine("First document");
    e.put("other.typ", b"Second document".to_vec()).unwrap();
    let first = e.compile();
    let pdf = e.export_pdf(first.revision).unwrap();
    e.entry("other.typ").unwrap();
    let second = e.compile();
    assert_ne!(pdf, e.export_pdf(second.revision).unwrap());
    e.entry("main.typ").unwrap();
    let again = e.compile();
    assert_eq!(pdf, e.export_pdf(again.revision).unwrap());
}

#[test]
fn unchanged_updates_preserve_revision_and_compile_result() {
    let mut e = engine("Hello");
    let r = e.compile();
    assert_eq!(e.put("main.typ", b"Hello".to_vec()).unwrap(), r.revision);
    assert_eq!(e.compile().revision, r.revision);
    assert_eq!(
        e.request(json!({"op":"compile"})).unwrap()["success"],
        Value::Bool(true)
    );
}

#[test]
fn fingerprint_tracks_order_independent_files_and_configuration() {
    let mut a = engine("#include \"body.typ\"");
    a.put("body.typ", b"Body".to_vec()).unwrap();
    let mut b = Engine::new();
    b.put("body.typ", b"Body".to_vec()).unwrap();
    b.put("main.typ", b"#include \"body.typ\"".to_vec())
        .unwrap();
    let initial = a.compile().fingerprint;
    assert_eq!(initial, b.compile().fingerprint);
    assert_eq!(initial.len(), 64);
    a.put("body.typ", b"Different".to_vec()).unwrap();
    assert_ne!(initial, a.compile().fingerprint);
    a.put("body.typ", b"Body".to_vec()).unwrap();
    assert_eq!(initial, a.compile().fingerprint);
    a.request(json!({"op":"configure","inputs":{"name":"A"}}))
        .unwrap();
    assert_ne!(initial, a.compile().fingerprint);
}

#[test]
fn rename_refuses_unresolved_rhs_and_tracks_imported_bindings() {
    let mut e = engine("#let name = missing\n#name");
    assert!(
        e.request(json!({"op":"rename","path":"main.typ","offset":12,"newName":"other"}))
            .is_err()
    );
    let main = "#import \"lib.typ\": answer\n#answer";
    e.put("main.typ", main.as_bytes().to_vec()).unwrap();
    e.put("lib.typ", b"#let answer = 42\n#answer".to_vec())
        .unwrap();
    let definition = e
        .request(json!({"op":"definition","path":"main.typ","offset":at(main,"#answer")+1}))
        .unwrap();
    assert_eq!(definition["path"], "lib.typ");
    let refs = e
        .request(json!({"op":"references","path":"main.typ","offset":at(main,"#answer")+1}))
        .unwrap();
    assert_eq!(refs.as_array().unwrap().len(), 4, "{refs}");
}

#[test]
fn custom_font_changes_identity_and_duplicate_font_is_a_noop() {
    let mut e = engine("#set text(font: \"Roboto\")\nCustomFONT");
    let before = e.compile();
    assert!(
        before
            .diagnostics
            .iter()
            .any(|d| d["message"].as_str().unwrap().contains("unknown font"))
    );
    let font = include_bytes!("fixtures/Roboto-Regular.ttf").to_vec();
    let revision = e.add_font(font.clone()).unwrap();
    let after = e.compile();
    assert!(after.success);
    assert!(
        !after
            .diagnostics
            .iter()
            .any(|d| d["message"].as_str().unwrap().contains("unknown font"))
    );
    assert_ne!(before.fingerprint, after.fingerprint);
    assert_eq!(revision, e.add_font(font).unwrap());
    assert!(e.export_pdf(revision).unwrap().len() > 1000);
}
