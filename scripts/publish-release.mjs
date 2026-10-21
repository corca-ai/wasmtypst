import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
const gh = (args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const repo = process.env.GH_REPO;
const id = process.env.RELEASE_RUN_ID;
const tag = process.env.RELEASE_TAG;
if (!/^\d+$/.test(id ?? "") || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag ?? ""))
  throw new Error("Invalid run or tag");
const run = JSON.parse(gh(["api", `repos/${repo}/actions/runs/${id}`]));
if (
  run.conclusion !== "success" ||
  run.head_branch !== "main" ||
  run.event !== "push" ||
  run.path !== ".github/workflows/ci.yml"
)
  throw new Error("Release requires a successful main push qualification");
const commit = JSON.parse(gh(["api", `repos/${repo}/commits/${tag}`]));
if (commit.sha !== run.head_sha)
  throw new Error("Tag and qualified source differ");
const releases = JSON.parse(gh(["api", `repos/${repo}/releases?per_page=100`]));
if (releases.some((release) => release.tag_name === tag))
  throw new Error("A release already exists; published assets are immutable");
await mkdir("report/publish", { recursive: true });
gh([
  "run",
  "download",
  id,
  "--repo",
  repo,
  "--name",
  `qualification-${run.head_sha}`,
  "--dir",
  "report/publish",
]);
const filename = `wasmtypst-${tag.slice(1)}.tgz`;
const file = `report/publish/report/release/${filename}`;
const sums = await readFile("report/publish/report/release/SHA256SUMS", "utf8");
const digest = createHash("sha256")
  .update(await readFile(file))
  .digest("hex");
if (sums !== `${digest}  ${filename}\n`)
  throw new Error("Package checksum mismatch");
gh([
  "release",
  "create",
  tag,
  "--repo",
  repo,
  "--verify-tag",
  "--title",
  `WasmTypst ${tag}`,
  "--generate-notes",
  file,
  "report/publish/report/release/SHA256SUMS",
  "report/publish/report/release/build.json",
]);
