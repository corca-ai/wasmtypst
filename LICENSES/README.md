# Registry license fallbacks

Some published crates omit license files stored at their repository root.
The build copies an explicitly offered license for these crates rather than
shipping an empty license directory.

- Apache-2.0.txt is the unmodified LICENSE from typst/typst tag v0.15.1:
  https://raw.githubusercontent.com/typst/typst/v0.15.1/LICENSE
- CC0-1.0.txt is the unmodified SPDX License List Data v3.27.0 text:
  https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/CC0-1.0.txt

For a crate without its own license file, the build chooses Apache-2.0 when
offered, otherwise CC0-1.0 for roman-numerals-rs. All available upstream notices
are retained. typst-assets/NOTICE contains the bundled font licenses and credits.
