import { createCompiler } from "/dist/index.js";
import { Preview } from "/dist/preview.js";
const source = document.querySelector("#source");
const status = document.querySelector("#status");
const button = document.querySelector("#compile");
const download = document.querySelector("#download");
let compiler;
let preview;
let accepted;
let running = false;
let pending = false;
async function compile() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  download.disabled = true;
  try {
    do {
      pending = false;
      const text = source.value;
      status.textContent = "Compiling…";
      const started = performance.now();
      await compiler.putFile("main.typ", text);
      const result = await compiler.compile();
      if (pending || source.value !== text) {
        pending = true;
        continue;
      }
      document.querySelector("#diagnostics").textContent = result.diagnostics
        .map((d) => d.message)
        .join("\n");
      if (result.success) {
        await preview.render(result);
        if (source.value !== text) {
          pending = true;
          continue;
        }
        accepted = result;
        download.disabled = false;
        status.textContent = `${result.pages.length} page · ${Math.round(performance.now() - started)} ms`;
      } else {
        accepted = undefined;
        status.textContent = "Check the source diagnostics";
      }
    } while (pending);
  } catch (error) {
    status.textContent = String(error);
  } finally {
    running = false;
  }
}
try {
  compiler = await createCompiler();
  preview = new Preview(document.querySelector("#preview"), compiler);
  preview.addEventListener("navigate", ({ detail }) => {
    if (accepted && detail?.path === "main.typ") {
      source.focus();
      source.setSelectionRange(detail.from, detail.to);
    }
  });
  preview.addEventListener("error", ({ detail }) => {
    status.textContent = String(detail);
  });
  button.disabled = false;
  button.addEventListener("click", compile);
  let timer;
  source.addEventListener("input", () => {
    accepted = undefined;
    download.disabled = true;
    void compiler.putFile("main.typ", source.value).catch((error) => {
      status.textContent = String(error);
    });
    clearTimeout(timer);
    timer = setTimeout(compile, 200);
  });
  download.addEventListener("click", async () => {
    if (!accepted) return;
    try {
      const bytes = await compiler.pdf(accepted.revision);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "document.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      status.textContent = String(error);
    }
  });
  addEventListener("pagehide", () => {
    preview.dispose();
    compiler.dispose();
  });
  await compile();
} catch (error) {
  status.textContent = String(error);
}
