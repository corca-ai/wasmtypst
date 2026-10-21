use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Mutex;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Dict};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

pub const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PROJECT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_FILES: usize = 4096;

#[derive(Clone)]
pub struct MemoryWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    pub files: HashMap<FileId, Bytes>,
    pub sources: HashMap<FileId, Source>,
    lazy_sources: HashMap<FileId, std::sync::OnceLock<Source>>,
    pub main: FileId,
    pub date: Option<Datetime>,
    pub accessed: std::sync::Arc<Mutex<HashSet<FileId>>>,
    file_hashes: HashMap<FileId, [u8; 32]>,
    font_hashes: Vec<Vec<u8>>,
    font_bytes: usize,
    config_identity: Vec<u8>,
}

pub fn file_id(path: &str) -> Result<FileId, String> {
    if path.is_empty()
        || path.contains('\\')
        || path.contains('\0')
        || path.starts_with('/')
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err("Paths must be normalized, relative and confined to their project".into());
    }
    if let Some(package) = path.strip_prefix('@') {
        let (spec, path) = package
            .split_once('/')
            .ok_or("Package paths need @namespace/name:version/path")?;
        // Package names contain a slash; find the slash following the version.
        let (name_version, relative) =
            path.split_once('/').ok_or("Package file path is missing")?;
        let spec = format!("@{spec}/{name_version}")
            .parse()
            .map_err(|e| format!("Invalid package: {e}"))?;
        return Ok(RootedPath::new(
            VirtualRoot::Package(spec),
            VirtualPath::new(relative).map_err(|e| e.to_string())?,
        )
        .intern());
    }
    Ok(RootedPath::new(
        VirtualRoot::Project,
        VirtualPath::new(path).map_err(|e| e.to_string())?,
    )
    .intern())
}

pub fn path_for(id: FileId) -> String {
    let relative = id.vpath().get_without_slash();
    match id.root() {
        VirtualRoot::Package(package) => format!("{package}/{relative}"),
        VirtualRoot::Project => relative.to_string(),
    }
}

impl MemoryWorld {
    pub fn new() -> Self {
        let fonts: Vec<_> = typst_assets::fonts()
            .flat_map(|b| Font::iter(Bytes::new(b)))
            .collect();
        let font_hashes = typst_assets::fonts()
            .map(|bytes| Sha256::digest(bytes).to_vec())
            .collect();
        Self {
            library: LazyHash::new(
                Library::builder()
                    .with_features([typst::Feature::Html].into_iter().collect())
                    .build(),
            ),
            book: LazyHash::new(FontBook::from_fonts(&fonts)),
            fonts,
            files: HashMap::new(),
            sources: HashMap::new(),
            lazy_sources: HashMap::new(),
            main: file_id("main.typ").unwrap(),
            date: None,
            accessed: Default::default(),
            file_hashes: HashMap::new(),
            font_hashes,
            font_bytes: typst_assets::fonts().map(|bytes| bytes.len()).sum(),
            config_identity: Vec::new(),
        }
    }

    pub fn put(&mut self, path: &str, bytes: Vec<u8>) -> Result<bool, String> {
        let id = file_id(path)?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err("File exceeds 16 MiB".into());
        }
        if self
            .files
            .get(&id)
            .is_some_and(|old| old.as_slice() == bytes)
        {
            return Ok(false);
        }
        let total: usize = self
            .files
            .iter()
            .filter(|(key, _)| **key != id)
            .map(|(_, b)| b.len())
            .sum();
        if total + bytes.len() > MAX_PROJECT_BYTES {
            return Err("Project exceeds 64 MiB".into());
        }
        if !self.files.contains_key(&id) && self.files.len() >= MAX_FILES {
            return Err("Project exceeds 4096 files".into());
        }
        if let Ok(text) = std::str::from_utf8(&bytes) {
            if let Some(source) = self.sources.get_mut(&id) {
                source.replace(text);
            } else if path.ends_with(".typ") {
                self.sources.insert(id, Source::new(id, text.into()));
            } else {
                let cell = self.lazy_sources.entry(id).or_default();
                if let Some(source) = cell.get_mut() {
                    source.replace(text);
                }
            }
        } else {
            self.sources.remove(&id);
            self.lazy_sources.remove(&id);
        }
        self.file_hashes.insert(id, Sha256::digest(&bytes).into());
        self.files.insert(id, Bytes::new(bytes));
        Ok(true)
    }

    pub fn remove(&mut self, path: &str) -> Result<bool, String> {
        let id = file_id(path)?;
        self.sources.remove(&id);
        self.lazy_sources.remove(&id);
        self.file_hashes.remove(&id);
        Ok(self.files.remove(&id).is_some())
    }

    pub fn parsed_sources(&self) -> impl Iterator<Item = &Source> {
        self.sources
            .values()
            .chain(self.lazy_sources.values().filter_map(|cell| cell.get()))
    }

    pub fn add_font(&mut self, bytes: Vec<u8>) -> Result<bool, String> {
        if bytes.len() > MAX_FILE_BYTES {
            return Err("Font exceeds 16 MiB".into());
        }
        let font_hash = Sha256::digest(&bytes).to_vec();
        if self.font_hashes.contains(&font_hash) {
            return Ok(false);
        }
        if self.font_bytes + bytes.len() > MAX_PROJECT_BYTES {
            return Err("Fonts exceed 64 MiB".into());
        }
        let byte_count = bytes.len();
        let fonts: Vec<_> = Font::iter(Bytes::new(bytes)).collect();
        if fonts.is_empty() {
            return Err("Invalid font".into());
        }
        if self.fonts.len() + fonts.len() > 256 {
            return Err("Font count exceeds 256".into());
        }
        self.fonts.extend(fonts);
        self.font_bytes += byte_count;
        self.font_hashes.push(font_hash);
        self.book = LazyHash::new(FontBook::from_fonts(&self.fonts));
        Ok(true)
    }

    pub fn set_inputs(&mut self, inputs: Dict) {
        self.library = LazyHash::new(
            Library::builder()
                .with_inputs(inputs)
                .with_features([typst::Feature::Html].into_iter().collect())
                .build(),
        );
    }

    pub fn set_config_identity(&mut self, bytes: Vec<u8>) {
        self.config_identity = bytes;
    }

    pub fn fingerprint(&self) -> String {
        let mut hash = Sha256::new();
        let mut add = |bytes: &[u8]| {
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
        };
        add(b"wasmtypst/0.2.0;typst/0.15.1;merkle-sha256-v1");
        add(include_bytes!("../Cargo.lock"));
        add(path_for(self.main).as_bytes());
        add(&self.config_identity);
        let mut files: Vec<_> = self
            .files
            .keys()
            .map(|id| (path_for(*id), &self.file_hashes[id]))
            .collect();
        files.sort_by(|a, b| a.0.cmp(&b.0));
        for (path, bytes) in files {
            add(path.as_bytes());
            add(bytes);
        }
        for font in &self.font_hashes {
            add(font);
        }
        format!("{:x}", hash.finalize())
    }
}

impl Default for MemoryWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl World for MemoryWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }
    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }
    fn main(&self) -> FileId {
        self.main
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        self.accessed.lock().unwrap().insert(id);
        if let Some(source) = self.sources.get(&id) {
            return Ok(source.clone());
        }
        let bytes = self
            .files
            .get(&id)
            .ok_or_else(|| FileError::NotFound(id.vpath().get_without_slash().into()))?;
        let text = std::str::from_utf8(bytes.as_slice()).map_err(|_| FileError::InvalidUtf8)?;
        Ok(self
            .lazy_sources
            .get(&id)
            .expect("UTF-8 inventory has a source cell")
            .get_or_init(|| Source::new(id, text.into()))
            .clone())
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.accessed.lock().unwrap().insert(id);
        self.files
            .get(&id)
            .cloned()
            .ok_or_else(|| FileError::NotFound(id.vpath().get_without_slash().into()))
    }
    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }
    fn today(&self, _: Option<typst::foundations::Duration>) -> Option<Datetime> {
        self.date
    }
}

impl typst_ide::IdeWorld for MemoryWorld {
    fn upcast(&self) -> &dyn World {
        self
    }
    fn files(&self) -> Vec<FileId> {
        self.files.keys().copied().collect()
    }
}
