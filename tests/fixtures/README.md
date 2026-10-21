# Runtime fixtures

The cmarker package fixture is the unmodified `@preview/cmarker:0.1.8` package
from https://packages.typst.org/preview/cmarker-0.1.8.tar.gz. Its archive SHA-256
is `157cc40db2716f12c7eabb95df1f60714a4d95ebfb1c6087cf4aec224e49392a`.
The package's MIT license is retained beside its source and plugin.
The plugin SHA-256 is
`b82a60ac048a9d04b0a94a755e1ebe0387926e88f91d0d763a98a379445af330`.

Roboto-Regular.ttf comes from `typst/typst-dev-assets@v0.13.1/files/fonts/Roboto-Regular.ttf`.
Its SHA-256 is
`797e35f7f5d6020a5c6ea13b42ecd668bcfb3bbc4baa0e74773527e5b6cb3174`.
It retains its Apache-2.0 license; see the retained Apache license text.
The fixture tests adding a font outside the bundled family set.

## Document qualification corpus

Authored files in `corpus/` use this repository's MIT license. `cases.mjs` builds
five workloads; `run.mjs` runs exactly the same assertions in Node and browsers.
The 24-chapter workload is generated prose, equations and tables, not a real
published dissertation. `resources.json` fixes every dependency's decoded byte
length and SHA-256. The runner preloads local bytes into an offline cache; its
URLs are metadata, not an instruction to contact a registry. In particular the
derived CJK subset uses the reserved `fixtures.invalid` domain and is offline
only. These fixture locks are not production registry configurations.

`charged-ieee/` retains the upstream MIT-0 license and unmodified `lib.typ`,
`typst.toml`, `template/main.typ` (stored as `main.typ`) and `template/refs.bib`
from typst/packages commit `574e4acdf56b4f2f812e9366bed0688746143030`, directory
`packages/preview/charged-ieee/0.1.4`. The template's authorship and content are
upstream's. Its required TeX Gyre fonts are supplied explicitly, not substituted.

`tex-gyre/` contains the unmodified Termes 2.004 regular/bold/italic/bolditalic
and Cursor 2.004 regular OTFs from the CTAN `fonts/tex-gyre.zip` distribution,
with the GUST Font License, LPPL 1.3c, upstream family README and manifests.
Exact OTF hashes are recorded in `corpus/resources.json`. The CTAN URLs can
redirect or change; a production host must approve immutable delivery URLs
instead of treating this offline fixture inventory as a downloadable lock.

`corpus/NotoSansCJKkr-Subset.otf` is derived from Noto Sans CJK KR Regular at
notofonts/noto-cjk commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c`,
`Sans/OTF/Korean/NotoSansCJKkr-Regular.otf`. The SIL OFL 1.1 is retained as
`corpus/OFL.txt`; upstream copyright/name records remain in the font. This
subset covers only the multilingual fixture text; it is not general CJK support.
Reproduce with fonttools 4.60.1:

```
pyftsubset NotoSansCJKkr-Regular.otf \
  --text-file=tests/fixtures/corpus/multilingual.typ \
  --output-file=tests/fixtures/corpus/NotoSansCJKkr-Subset.otf \
  --name-IDs='*' --name-legacy --name-languages='*'
```

The new fonts are test assets, not additional fonts bundled into the SDK runtime.

## Expanded synthetic and external corpus

Four additional authored documents exercise proof blocks, matrix/cases/integral
math, numbered equations, CSV/JSON-driven tables and column spans, lists,
vector images, Latin/Greek/Cyrillic/CJK text, CRLF source, columns, page headers,
footers, placement, grid and footnotes. Three intentionally invalid projects
exercise syntax, unauthorized package and bibliography refusal plus recovery.

External source is pinned to typst/packages commit
`574e4acdf56b4f2f812e9366bed0688746143030`:

| Example | Fixture root | Outcome on Typst 0.15.1 |
| --- | --- | --- |
| Springer contributed chapter | `upstream/springer-spaniel/0.1.0/template/` | Old ctheorems `state.display()` API fails in both WASM and native |
| Elsevier article | `upstream/elsearticle/3.1.0/template/` | Six-page PDF; original XITS/STIX fallback warnings are retained |
| Mathematical paper | `upstream/clean-math-paper/0.2.8/template/` | Three-page PDF with equations, theorem/proof and references |

Eighteen package versions, including transitive dependencies, are retained
with their upstream LICENSE files. `corpus/resources.json` locks runtime
package files; `corpus/upstream.json` separately hashes all copied sources,
licenses and assets. The corpus verifies both inventories before compiling.
Third-party `.typ` files and CRLF line endings are not reformatted.

`upstream/lapreprint/` is the unmodified source and used PNG assets of
LaPreprint/typst commit `c908cd05da8e13eb8add652a613d00add73d1f58`, including
`examples/pixels/main.typ`, its bibliography and `lapreprint.typ`. This is the
external finite-volume tutorial example “Pixels and their Neighbours,” credited
to Rowan Cockett, Lindsey Heagy and Douglas Oldenburg; original publication
DOI: https://doi.org/10.1190/tle35080703.1. The repository's MIT license is
retained. The document separately states CC BY-SA 3.0 for article content;
that original notice, attribution and bibliography remain intact, with a copy
of the linked license in `licenses/CC-BY-SA-3.0.txt`. Its article images and
derivatives retain that license, rather than the SDK's MIT license.

The original template fails under the old `locate(callback)` API on both the
native CLI and WASM. A separately named compatibility variant in `cases.mjs`
prepends `locate(callback) = context callback(here())`, removes the obsolete
argument to `counter(page).final`, supplies context to the page counter display,
and replaces `image.decode(orcidSvg)` with `image(bytes(orcidSvg))`. Exact
single-occurrence replacements are checked; original files remain unchanged.
Deprecated paragraph spacing and raw-text warnings remain visible.

The API-adapted variant with original 4000-pixel figures compiles to seven
pages. It exceeded the former 256 MiB WASM PDF-export ceiling; default 512 MiB
and optional 1 GiB builds now export it successfully, as does the native CLI. The separately qualified browser-sized variant uses derivatives in
`corpus/finite-volume-images/`. Pillow 11.3.0 generated them with
`image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)` and
`image.save(destination, optimize=True)`. No source prose or equations were
removed. `corpus/derived-images.json` records source paths, original/resulting
dimensions, lengths and SHA-256 hashes. These resized test assets are explicit
fixture derivatives, not automatic image modification by the SDK.

`noto-sans/NotoSans.ttf` is the unmodified variable Noto Sans font from
`google/fonts@47d54ca1ebb14fd864695f1d39dc734f39017c33`,
`ofl/notosans/NotoSans[wdth,wght].ttf`, with its OFL license. It supplies the
LaPreprint example's requested font and is only a test asset.
