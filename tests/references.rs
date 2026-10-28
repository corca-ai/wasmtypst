use serde_json::json;
use wasmtypst::Engine;

#[test]
fn reference_text_comes_from_each_native_output() {
    let source = "#set heading(numbering: \"1.\")\n#set math.equation(numbering: \"(1)\")\n= Intro <intro>\n$ x = 3 $ <energy>\nSee @intro and @energy.\n#show ref: it => [Custom #it]\nSee @intro.";
    let mut engine = Engine::new();
    engine.put("main.typ", source.as_bytes().to_vec()).unwrap();
    let paged = engine.compile();
    assert!(paged.success, "{:?}", paged.diagnostics);
    assert_eq!(paged.references.len(), 3);
    assert!(
        paged
            .references
            .iter()
            .any(|entry| entry["text"].as_str().unwrap().contains("Custom"))
    );
    for entry in &paged.references {
        assert_eq!(entry["source"]["path"], "main.typ");
        assert_eq!(entry["target"]["path"], "main.typ");
        assert_eq!(entry["kind"], "reference");
    }
    let html = engine.request(json!({"op":"compileHtml"})).unwrap();
    assert_eq!(html["references"].as_array().unwrap().len(), 3);
    engine.put("main.typ", b"@missing".to_vec()).unwrap();
    let failed = engine.compile();
    assert!(!failed.success);
    assert!(failed.references.is_empty());
}

#[test]
fn citations_keep_native_style_and_supplements() {
    let mut engine = Engine::new();
    engine.put("main.typ", b"See @paper and #cite(<paper>, supplement: [p. 9]).\n#bibliography(\"refs.bib\", style: \"ieee\")".to_vec()).unwrap();
    engine
        .put(
            "refs.bib",
            b"@article{paper, title={Useful research}, author={Kim, Min}, year={2024}}".to_vec(),
        )
        .unwrap();
    let paged = engine.compile();
    assert!(paged.success, "{:?}", paged.diagnostics);
    assert_eq!(paged.references.len(), 2, "{:?}", paged.references);
    assert_eq!(paged.references[0]["text"], "[1]");
    assert!(paged.references[1]["text"].as_str().unwrap().contains("9"));
    assert!(
        paged
            .references
            .iter()
            .all(|entry| entry["kind"] == "citation" && entry["target"].is_null())
    );
    let html = engine.compile_html();
    assert_eq!(
        html["references"].as_array().unwrap().len(),
        2,
        "{}",
        html["references"]
    );
}

#[test]
fn repeated_macro_spans_are_omitted_and_imports_keep_native_paths() {
    let mut engine = Engine::new();
    engine.put("main.typ", b"#set heading(numbering: \"1.\")\n= Intro <intro>\n#let repeated = [@intro]\n#repeated #repeated\n#include \"part.typ\"".to_vec()).unwrap();
    engine
        .put("part.typ", "😀 @intro".as_bytes().to_vec())
        .unwrap();
    let paged = engine.compile();
    assert!(paged.success, "{:?}", paged.diagnostics);
    assert_eq!(paged.references.len(), 1, "{:?}", paged.references);
    assert_eq!(paged.references[0]["source"]["path"], "part.typ");
    assert_eq!(paged.references[0]["source"]["from"], 3);
    assert_eq!(paged.references[0]["target"]["path"], "main.typ");
}

#[test]
fn adjacent_citations_are_one_native_group_with_all_keys() {
    let source = "See @one @two.\n#bibliography(\"refs.bib\", style: \"ieee\")";
    let mut engine = Engine::new();
    engine.put("main.typ", source.as_bytes().to_vec()).unwrap();
    engine
        .put(
            "refs.bib",
            b"@article{one,title={A},year={2024}}\n@article{two,title={B},year={2023}}".to_vec(),
        )
        .unwrap();
    let result = engine.compile();
    assert!(result.success, "{:?}", result.diagnostics);
    assert_eq!(result.references.len(), 1, "{:?}", result.references);
    let entry = &result.references[0];
    assert_eq!(entry["keys"], json!(["one", "two"]));
    assert_eq!(
        &source[entry["source"]["from"].as_u64().unwrap() as usize
            ..entry["source"]["to"].as_u64().unwrap() as usize],
        "@one @two"
    );
    assert!(entry["text"].as_str().unwrap().contains("2"));
    let html = engine.compile_html();
    assert_eq!(html["references"][0]["keys"], json!(["one", "two"]));
}

#[test]
fn citation_show_rules_and_nested_supplements_keep_their_outer_text() {
    for source in [
        "#show ref: it => [PRE #it POST]\n@one\n#bibliography(\"refs.bib\", style: \"ieee\")",
        "#show cite: it => [PRE #it POST]\n#cite(<one>)\n#bibliography(\"refs.bib\", style: \"ieee\")",
        "#cite(<one>, supplement: [see @two])\n#bibliography(\"refs.bib\", style: \"ieee\")",
    ] {
        let mut engine = Engine::new();
        engine.put("main.typ", source.as_bytes().to_vec()).unwrap();
        engine
            .put(
                "refs.bib",
                b"@article{one,title={A},year={2024}}\n@article{two,title={B},year={2023}}"
                    .to_vec(),
            )
            .unwrap();
        let paged = engine.compile();
        assert!(paged.success, "{:?}", paged.diagnostics);
        let html = engine.compile_html();
        for entries in [
            paged.references,
            html["references"].as_array().unwrap().clone(),
        ] {
            let outer = entries
                .iter()
                .find(|entry| entry["keys"] == json!(["one"]))
                .unwrap();
            let text = outer["text"].as_str().unwrap();
            if source.contains("PRE") {
                assert!(
                    text.starts_with("PRE ") && text.ends_with(" POST"),
                    "{text}"
                );
            } else {
                assert!(text.contains("see") && text.contains("2"), "{text}");
            }
        }
    }
}

#[test]
fn repeated_child_provenance_cannot_be_hidden_by_a_group_union() {
    let mut engine = Engine::new();
    engine.put("main.typ", b"#let f(k) = cite(k)\n#f(<one>) #f(<two>)\n#bibliography(\"refs.bib\", style: \"ieee\")".to_vec()).unwrap();
    engine
        .put(
            "refs.bib",
            b"@article{one,title={A},year={2024}}\n@article{two,title={B},year={2023}}".to_vec(),
        )
        .unwrap();
    let paged = engine.compile();
    assert!(paged.success, "{:?}", paged.diagnostics);
    assert!(paged.references.is_empty(), "{:?}", paged.references);
    assert_eq!(engine.compile_html()["references"], json!([]));
}

#[test]
fn nested_explicit_citations_keep_their_own_show_wrappers() {
    let mut engine = Engine::new();
    engine.put("main.typ", b"#show cite: it => [PRE #it POST]\n#cite(<one>, supplement: [see #cite(<two>)])\n#bibliography(\"refs.bib\", style: \"ieee\")".to_vec()).unwrap();
    engine
        .put(
            "refs.bib",
            b"@article{one,title={A},year={2024}}\n@article{two,title={B},year={2023}}".to_vec(),
        )
        .unwrap();
    let paged = engine.compile();
    assert!(paged.success, "{:?}", paged.diagnostics);
    let html = engine.compile_html();
    for entries in [
        paged.references,
        html["references"].as_array().unwrap().clone(),
    ] {
        let inner = entries
            .iter()
            .find(|entry| entry["keys"] == json!(["two"]))
            .unwrap();
        assert_eq!(inner["text"], "PRE [2] POST");
        let outer = entries
            .iter()
            .find(|entry| entry["keys"] == json!(["one"]))
            .unwrap();
        assert_eq!(outer["text"], "PRE [1, see PRE [2] POST] POST");
    }
}

#[test]
fn adjacent_explicit_citations_have_one_group_owner() {
    let mut engine = Engine::new();
    engine
        .put(
            "main.typ",
            b"#cite(<one>) #cite(<two>)\n#bibliography(\"refs.bib\", style: \"ieee\")".to_vec(),
        )
        .unwrap();
    engine
        .put(
            "refs.bib",
            b"@article{one,title={A},year={2024}}\n@article{two,title={B},year={2023}}".to_vec(),
        )
        .unwrap();
    let paged = engine.compile();
    assert!(paged.success, "{:?}", paged.diagnostics);
    let html = engine.compile_html();
    for entries in [
        paged.references,
        html["references"].as_array().unwrap().clone(),
    ] {
        assert_eq!(entries.len(), 1, "{entries:?}");
        assert_eq!(entries[0]["keys"], json!(["one", "two"]));
    }
}
