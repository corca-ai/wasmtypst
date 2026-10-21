use crate::Engine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct TypstEngine {
    inner: Engine,
}

#[wasm_bindgen]
impl TypstEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            inner: Engine::new(),
        }
    }
    pub fn put(&mut self, path: &str, bytes: Vec<u8>) -> Result<u32, JsValue> {
        self.inner
            .put(path, bytes)
            .map_err(|e| JsValue::from_str(&e))
    }
    pub fn snapshot(&mut self, files: JsValue, entry: &str) -> Result<u32, JsValue> {
        let files =
            serde_wasm_bindgen::from_value(files).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.inner
            .snapshot(files, entry)
            .map_err(|e| JsValue::from_str(&e))
    }
    pub fn add_font(&mut self, bytes: Vec<u8>) -> Result<u32, JsValue> {
        self.inner
            .add_font(bytes)
            .map_err(|e| JsValue::from_str(&e))
    }
    pub fn request(&mut self, request: JsValue) -> Result<JsValue, JsValue> {
        let input = serde_wasm_bindgen::from_value(request)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let value = self
            .inner
            .request(input)
            .map_err(|e| JsValue::from_str(&e))?;
        value
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    pub fn pdf(&mut self, revision: u32) -> Result<Vec<u8>, JsValue> {
        self.inner
            .export_pdf(revision)
            .map_err(|e| JsValue::from_str(&e))
    }
    pub fn svg(&self, revision: u32, page: usize) -> Result<String, JsValue> {
        self.inner
            .svg(revision, page)
            .map_err(|e| JsValue::from_str(&e))
    }
    pub fn revision(&self) -> u32 {
        self.inner.revision
    }
}

impl Default for TypstEngine {
    fn default() -> Self {
        Self::new()
    }
}
use serde::Serialize;
