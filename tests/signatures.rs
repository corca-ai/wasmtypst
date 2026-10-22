use serde_json::{Value, json};
use wasmtypst::Engine;

fn signature(marked: &str) -> Value {
    let byte = marked.find('|').unwrap();
    let offset = marked[..byte].encode_utf16().count();
    let text = marked.replacen('|', "", 1);
    let mut engine = Engine::new();
    engine.put("main.typ", text.as_bytes().to_vec()).unwrap();
    engine
        .request(json!({"op":"signature","path":"main.typ","offset":offset}))
        .unwrap()
}

fn active_label(result: &Value) -> &str {
    let signature = &result["signatures"][0];
    let index = signature["activeParameter"]
        .as_u64()
        .expect("active parameter") as usize;
    signature["parameters"][index]["label"].as_str().unwrap()
}

#[test]
fn native_signature_uses_named_parameter_metadata_in_incomplete_calls() {
    let result = signature("#text(size: |)");
    assert!(active_label(&result).starts_with("size"), "{result}");
    assert!(result["signatures"][0]["documentation"].as_str().is_some());
}

#[test]
fn signature_uses_user_function_defaults_and_utf16_positions() {
    let result = signature(
        "😀\n#let greeting(name, ending: \"!\") = name + ending\n#greeting(\"Hi\", ending: |)",
    );
    assert_eq!(active_label(&result), "ending: \"!\"");
}

#[test]
fn signature_selects_the_inner_call_and_ignores_named_arguments_for_position() {
    let result =
        signature("#let join(a, b, flag: false) = a + b\n#join(flag: true, 1, calc.max(2, |3))");
    assert!(
        result["signatures"][0]["label"]
            .as_str()
            .unwrap()
            .starts_with("max("),
        "{result}"
    );
    let result = signature("#let join(a, b, flag: false) = a + b\n#join(flag: true, 1, |2)");
    assert_eq!(active_label(&result), "b");
}

#[test]
fn signature_refuses_prebound_parameters_instead_of_highlighting_the_wrong_one() {
    assert!(signature("#let f(a, b) = a + b\n#let g = f.with(1)\n#g(|2)").is_null());
    assert!(signature("#let g = text.with(size: 10pt)\n#g(|[Hello])").is_null());
}

#[test]
fn spread_arguments_do_not_guess_the_next_positional_parameter() {
    let result = signature("#let f(a, b) = a + b\n#let xs = (1,)\n#f(..xs, |2)");
    assert!(!result.is_null(), "{result}");
    assert!(result["signatures"][0]["activeParameter"].is_null());
}

#[test]
fn diagnostics_keep_native_trace_locations_in_imported_sources() {
    let mut engine = Engine::new();
    engine
        .put("main.typ", b"#import \"lib.typ\": fail\n#fail()".to_vec())
        .unwrap();
    engine
        .put("lib.typ", b"#let fail() = panic(\"broken\")".to_vec())
        .unwrap();
    let result = engine.compile();
    assert!(!result.success);
    let error = result
        .diagnostics
        .iter()
        .find(|d| d["message"].as_str().is_some_and(|s| s.contains("broken")))
        .unwrap();
    assert!(
        error["traceDetails"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["location"]["path"] == "main.typ"),
        "{error}"
    );
}

#[test]
fn signature_supports_zero_argument_and_anonymous_closures() {
    let result = signature("#let f() = 1\n#f(|)");
    assert_eq!(result["signatures"][0]["label"], "f()");
    assert!(result["signatures"][0]["activeParameter"].is_null());
    let result = signature("#((x, suffix: \"!\") => x + suffix)(\"Hi\", suffix: |)");
    assert_eq!(active_label(&result), "suffix: \"!\"");
}

#[test]
fn signature_obeys_shadowing_and_does_not_escape_closed_calls() {
    let result = signature("#let text(first, second) = first + second\n#text(1, |2)");
    assert_eq!(active_label(&result), "second");
    assert!(signature("#text(\"Done\")|").is_null());
    assert!(signature("Plain prose|").is_null());
}

#[test]
fn signature_survives_missing_parentheses_and_comments() {
    let result = signature("#text(size: /* note */ |10pt");
    assert!(active_label(&result).starts_with("size"));
    let result = signature("#let f(a, b) = a + b\n#f(1, /* note */ |2)");
    assert_eq!(active_label(&result), "b");
}

#[test]
fn math_signatures_use_native_calls_and_preserve_unknown_row_grouping() {
    let result = signature("$frac(1, |2)$");
    assert_eq!(active_label(&result), "denom");
    let result = signature("$mat(1, 2; |3, 4)$");
    assert!(!result.is_null());
    assert!(result["signatures"][0]["activeParameter"].is_null());
    let result = signature(r#"$mat(1, 2; 3, 4, delim: |"[")$"#);
    assert!(active_label(&result).starts_with("delim"));
}

#[test]
fn trailing_content_arguments_advance_and_close_using_native_boundaries() {
    for call in ["#f[one][|two]", "#f(1)[|two]", "#f[one][|two"] {
        let result = signature(&format!("#let f(a, b) = a + b\n{call}"));
        assert_eq!(active_label(&result), "b", "{call}: {result}");
    }
    for call in ["#f[one][two]|", "#f(1)[two]|", "#text[Done]|"] {
        assert!(
            signature(&format!("#let f(a, b) = a + b\n{call}")).is_null(),
            "{call}"
        );
    }
    let result = signature("#let f(a, b) = a + b\n#f(..(1,))[|two]");
    assert!(!result.is_null());
    assert!(result["signatures"][0]["activeParameter"].is_null());
    let result = signature("#let f(a, b) = a + b\n#f[#text[Done]|][two]");
    assert_eq!(active_label(&result), "a");
}

#[test]
fn signature_survives_a_missing_value_and_trailing_space_at_end_of_input() {
    for (input, expected) in [
        ("#text(size: |", "size: 11pt"),
        (
            "#let greeting(name, ending: \"!\") = name + ending\n#greeting(\"Hi\", ending: |",
            "ending: \"!\"",
        ),
    ] {
        let result = signature(input);
        assert!(
            !result.is_null(),
            "{:#?}",
            typst::syntax::Source::detached(input.replace('|', "")).root()
        );
        assert_eq!(active_label(&result), expected);
    }
    assert!(signature("#text[Done] | ").is_null());
    let result = signature("#let f(a) = a\n#f( |");
    assert_eq!(active_label(&result), "a");
}
