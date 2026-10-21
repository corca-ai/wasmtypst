import { execFileSync } from "node:child_process";
import { mkdir, writeFile, cp, readdir } from "node:fs/promises";
import { resolve } from "node:path";
process.chdir(resolve(import.meta.dirname, ".."));
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      "wasm32-unknown-unknown",
    ],
    { encoding: "utf8", maxBuffer: 20 << 20 },
  ),
);
const reachable = new Set(metadata.resolve.nodes.map((node) => node.id));
const notices = [
  "# Third-party notices",
  "",
  "Original SDK code is MIT licensed. Rust dependencies and bundled fonts retain",
  "their licenses. The package includes the following upstream license texts.",
  "",
  "Typst and typst-ide use the exact same 0.15.1 release. No upstream source patches.",
  "",
];
await mkdir("LICENSES", { recursive: true });
for (const pkg of metadata.packages
  .filter((p) => reachable.has(p.id) && p.source)
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = resolve(pkg.manifest_path, "..");
  const entries = await readdir(dir, { withFileTypes: true });
  const licenseFiles = entries.filter(
    (e) =>
      e.isFile() &&
      /^(licen[cs]e|copying|notice|copyright)([.-]|$)/i.test(e.name),
  );
  const target = `LICENSES/${pkg.name}-${pkg.version}`;
  await mkdir(target, { recursive: true });
  for (const file of licenseFiles)
    await cp(resolve(dir, file.name), resolve(target, file.name));
  if (licenseFiles.length === 0) {
    // Some registry crates omit the repository-root license. Select an
    // offered license explicitly and retain its full canonical text.
    const selected = pkg.license?.includes("Apache-2.0")
      ? "Apache-2.0"
      : pkg.license === "0BSD OR CC0-1.0"
        ? "CC0-1.0"
        : null;
    if (!selected)
      throw new Error(
        `Missing upstream license text: ${pkg.name} (${pkg.license})`,
      );
    await cp(
      resolve("LICENSES", `${selected}.txt`),
      resolve(target, "LICENSE"),
    );
  }
  if (pkg.name === "typst-assets") {
    // Font notices and individual license texts live below files/.
    for (const sub of ["files/fonts", "files/icu"]) {
      for (const name of await readdir(resolve(dir, sub))) {
        if (/licen[cs]e|copying|notice/i.test(name))
          await cp(resolve(dir, sub, name), resolve(target, name), {
            recursive: true,
          });
      }
    }
  }
  notices.push(
    `- ${pkg.name} ${pkg.version}: ${pkg.license ?? "See upstream license"} (${target})`,
  );
}
await writeFile("THIRD_PARTY_NOTICES.md", `${notices.join("\n")}\n`);
