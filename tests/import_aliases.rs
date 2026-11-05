use serde_json::{Value, json};
use std::collections::BTreeMap;
use wasmtypst::Engine;

fn setup(main: &str, lib: &str) -> (Engine, BTreeMap<String, String>) {
    let files: BTreeMap<String, String> = BTreeMap::from([
        ("main.typ".into(), main.into()),
        ("lib.typ".into(), lib.into()),
    ]);
    let mut e = Engine::new();
    for (path, source) in &files {
        e.put(path, source.as_bytes().to_vec()).unwrap();
    }
    assert!(e.compile().success);
    (e, files)
}
fn offset(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}
fn rename(e: &mut Engine, path: &str, cursor: usize, name: &str) -> Value {
    e.request(json!({"op":"rename","path":path,"offset":cursor,"newName":name}))
        .unwrap()
}
fn apply(e: &mut Engine, files: &mut BTreeMap<String, String>, plan: &Value) {
    for edit in plan["edits"].as_array().unwrap().iter().rev() {
        let path = edit["path"].as_str().unwrap();
        let source = files.get_mut(path).unwrap();
        let mut units: Vec<u16> = source.encode_utf16().collect();
        units.splice(
            edit["from"].as_u64().unwrap() as usize..edit["to"].as_u64().unwrap() as usize,
            edit["text"].as_str().unwrap().encode_utf16(),
        );
        *source = String::from_utf16(&units).unwrap();
    }
    for (path, source) in files {
        e.put(path, source.as_bytes().to_vec()).unwrap();
    }
    let result = e.compile();
    assert!(result.success, "{:?}", result.diagnostics);
}

#[test]
fn renaming_an_alias_preserves_the_imported_export() {
    let main = "#import \"lib.typ\": greet as hi\n#hi(2)\n$hi(3)$";
    let lib = "#let greet(name) = [Hi #name]";
    let (mut e, mut files) = setup(main, lib);
    let plan = rename(
        &mut e,
        "main.typ",
        offset(main, main.rfind("hi").unwrap()) + 1,
        "welcome",
    );
    assert_eq!(plan["edits"].as_array().unwrap().len(), 3, "{plan}");
    assert!(
        plan["edits"]
            .as_array()
            .unwrap()
            .iter()
            .all(|edit| edit["path"] == "main.typ"),
        "{plan}"
    );
    apply(&mut e, &mut files, &plan);
    assert_eq!(files["lib.typ"], lib);
    assert_eq!(files["main.typ"], main.replace("hi", "welcome"));
}

#[test]
fn renaming_an_export_updates_import_paths_but_preserves_aliases() {
    let main = "\u{feff}// 😀\r\n#import \"lib.typ\": greet as hi\r\n#hi(2)";
    let lib = "#let greet(name) = [Hi #name]\n#greet(1)";
    let (mut e, mut files) = setup(main, lib);
    let plan = rename(&mut e, "lib.typ", 6, "welcome");
    assert_eq!(plan["edits"].as_array().unwrap().len(), 3, "{plan}");
    apply(&mut e, &mut files, &plan);
    assert_eq!(files["lib.typ"], lib.replace("greet", "welcome"));
    assert_eq!(files["main.typ"], main.replace("greet", "welcome"));
}

#[test]
fn aliases_do_not_capture_closure_loop_or_local_bindings() {
    for ending in ["\n", "\r\n", "\r"] {
        let main = [
            "#import \"lib.typ\": greet as hi",
            "#hi(1)",
            "#{let hi = 2; hi}",
            "#((hi) => hi)(3)",
            "#for hi in (1,) {hi}",
            "$hi(2)$",
        ]
        .join(ending);
        let (mut e, mut files) = setup(&main, "#let greet(name) = [Hi #name]");
        let plan = rename(
            &mut e,
            "main.typ",
            offset(&main, main.find("as hi").unwrap()) + 4,
            "welcome",
        );
        assert_eq!(plan["edits"].as_array().unwrap().len(), 3, "{plan}");
        apply(&mut e, &mut files, &plan);
        assert!(files["main.typ"].contains("let hi = 2; hi"));
        assert!(files["main.typ"].contains("((hi) => hi)"));
        assert!(files["main.typ"].contains("for hi in (1,) {hi}"));
    }
}

#[test]
fn repeated_imports_stop_alias_visibility_at_the_nearest_binding() {
    for later in [
        "#import \"lib.typ\": hi",
        "#import \"lib.typ\": *",
        "#import \"lib.typ\": hi as hi",
    ] {
        let main = format!("#import \"lib.typ\": greet as hi\n#hi(1)\n{later}\n#hi(2)");
        let (mut e, mut files) = setup(&main, "#let greet(name) = name\n#let hi(name) = name");
        let plan = rename(
            &mut e,
            "main.typ",
            offset(&main, main.find("#hi(1)").unwrap()) + 2,
            "welcome",
        );
        assert_eq!(plan["edits"].as_array().unwrap().len(), 2, "{plan}");
        apply(&mut e, &mut files, &plan);
        assert!(files["main.typ"].ends_with("#hi(2)"));
    }
}

#[test]
fn alias_navigation_still_targets_the_export_and_field_names_ignore_local_aliases() {
    let main = "#import \"lib.typ\": greet as hi\n#import \"lib.typ\" as module\n#hi(1)\n#module.hi(2)\n$module.hi(3)$";
    let lib = "#let greet(name) = name\n#let hi(name) = name";
    let (mut e, mut files) = setup(main, lib);
    let def = e
        .request(
            json!({"op":"definition","path":"main.typ","offset":main.find("#hi(1)").unwrap()+2}),
        )
        .unwrap();
    assert_eq!(def["path"], "lib.typ");
    assert_eq!(def["from"], 5);
    let plan = rename(
        &mut e,
        "main.typ",
        main.find("#hi(1)").unwrap() + 2,
        "welcome",
    );
    assert_eq!(plan["edits"].as_array().unwrap().len(), 2, "{plan}");
    apply(&mut e, &mut files, &plan);
    assert!(files["main.typ"].contains("#module.hi(2)"));
    assert!(files["main.typ"].contains("$module.hi(3)$"));
}

#[test]
fn alias_reexports_rename_each_local_binding_independently() {
    let main = "#import \"bridge.typ\": hi as local\n#local(1)";
    let lib = "#let greet(name) = name";
    let bridge = "#import \"lib.typ\": greet as hi";
    let mut files: BTreeMap<String, String> = BTreeMap::from([
        ("main.typ".into(), main.into()),
        ("lib.typ".into(), lib.into()),
        ("bridge.typ".into(), bridge.into()),
    ]);
    let mut e = Engine::new();
    for (path, source) in &files {
        e.put(path, source.as_bytes().to_vec()).unwrap();
    }
    assert!(e.compile().success);
    let plan = rename(
        &mut e,
        "bridge.typ",
        bridge.rfind("hi").unwrap() + 1,
        "welcome",
    );
    assert_eq!(plan["edits"].as_array().unwrap().len(), 2, "{plan}");
    apply(&mut e, &mut files, &plan);
    assert_eq!(files["lib.typ"], lib);
    assert_eq!(files["bridge.typ"], bridge.replace("hi", "welcome"));
    assert_eq!(files["main.typ"], main.replace(": hi", ": welcome"));
}

#[test]
fn alias_collisions_refuse_atomically_without_changing_the_project() {
    let main = "#import \"lib.typ\": greet as hi\n#let welcome = 1\n#hi(2)";
    let lib = "#let greet(name) = name";
    let (mut e, files) = setup(main, lib);
    let error=e.request(json!({"op":"rename","path":"main.typ","offset":main.rfind("hi").unwrap()+1,"newName":"welcome"})).unwrap_err();
    assert!(error.contains("capture"), "{error}");
    assert!(e.compile().success);
    assert_eq!(files["main.typ"], main);
}

#[test]
fn reexport_alias_rename_updates_code_and_math_module_fields() {
    let main = "#import \"bridge.typ\" as bridge\n#bridge.hi(1)\n$bridge.hi(2)$";
    let lib = "#let greet(name) = name";
    let bridge = "#import \"lib.typ\": greet as hi";
    let mut files: BTreeMap<String, String> = BTreeMap::from([
        ("main.typ".into(), main.into()),
        ("lib.typ".into(), lib.into()),
        ("bridge.typ".into(), bridge.into()),
    ]);
    let mut e = Engine::new();
    for (path, source) in &files {
        e.put(path, source.as_bytes().to_vec()).unwrap();
    }
    assert!(e.compile().success);
    let plan = rename(
        &mut e,
        "bridge.typ",
        bridge.rfind("hi").unwrap() + 1,
        "welcome",
    );
    assert_eq!(plan["edits"].as_array().unwrap().len(), 3, "{plan}");
    apply(&mut e, &mut files, &plan);
    assert_eq!(files["main.typ"], main.replace(".hi", ".welcome"));
    assert_eq!(files["lib.typ"], lib);
}

#[test]
fn alias_rename_updates_import_source_expressions() {
    let main = "#import \"bridge.typ\": inner as local\n#import local: value\n#value";
    let lib = "#let value = 42";
    let bridge = "#import \"lib.typ\" as inner";
    let mut files: BTreeMap<String, String> = BTreeMap::from([
        ("main.typ".into(), main.into()),
        ("lib.typ".into(), lib.into()),
        ("bridge.typ".into(), bridge.into()),
    ]);
    let mut e = Engine::new();
    for (path, source) in &files {
        e.put(path, source.as_bytes().to_vec()).unwrap();
    }
    assert!(e.compile().success);
    let plan = rename(
        &mut e,
        "main.typ",
        main.find("local").unwrap() + 1,
        "renamed",
    );
    assert_eq!(plan["edits"].as_array().unwrap().len(), 2, "{plan}");
    apply(&mut e, &mut files, &plan);
    assert_eq!(files["main.typ"], main.replace("local", "renamed"));
}

#[test]
fn import_sources_do_not_see_bindings_introduced_by_the_same_import() {
    for second in [
        "#import local: value as local",
        "#import local: *",
        "#import {let nested = local; nested}: value as local",
    ] {
        let main = format!("#import \"bridge.typ\": inner as local\n{second}\n#local");
        let bridge = "#import \"lib.typ\" as inner";
        let lib = "#let value=42\n#let local=42";
        let mut files: BTreeMap<String, String> = BTreeMap::from([
            ("main.typ".into(), main.clone()),
            ("lib.typ".into(), lib.into()),
            ("bridge.typ".into(), bridge.into()),
        ]);
        let mut e = Engine::new();
        for (path, source) in &files {
            e.put(path, source.as_bytes().to_vec()).unwrap();
        }
        assert!(e.compile().success);
        let plan = rename(
            &mut e,
            "main.typ",
            main.find("local").unwrap() + 1,
            "renamed",
        );
        assert_eq!(plan["edits"].as_array().unwrap().len(), 2, "{plan}");
        apply(&mut e, &mut files, &plan);
        if second.contains("nested") {
            assert!(files["main.typ"].contains("let nested = renamed; nested"));
        } else {
            assert!(files["main.typ"].contains("#import renamed:"));
        }
        assert!(files["main.typ"].ends_with("#local"));
    }
}

#[test]
fn renaming_the_second_alias_preserves_its_pre_import_source_binding() {
    let main = "#import \"bridge.typ\": inner as local\n#import local: value as local\n#local";
    let bridge = "#import \"lib.typ\" as inner";
    let lib = "#let value=42";
    let mut files: BTreeMap<String, String> = BTreeMap::from([
        ("main.typ".into(), main.into()),
        ("lib.typ".into(), lib.into()),
        ("bridge.typ".into(), bridge.into()),
    ]);
    let mut e = Engine::new();
    for (path, source) in &files {
        e.put(path, source.as_bytes().to_vec()).unwrap();
    }
    assert!(e.compile().success);
    let plan = rename(
        &mut e,
        "main.typ",
        main.rfind("local").unwrap() + 1,
        "renamed",
    );
    assert_eq!(plan["edits"].as_array().unwrap().len(), 2, "{plan}");
    apply(&mut e, &mut files, &plan);
    assert!(files["main.typ"].contains("#import local: value as renamed"));
    assert!(files["main.typ"].ends_with("#renamed"));
}
