// Browser-safe behavior and measurements; no package-network access during qualification.
export async function runCorpus(
  createCompiler,
  createResourceLoader,
  cases,
  lock,
  readBytes,
  samples = 3,
) {
  const cache = new Map();
  for (const resource of lock)
    cache.set(
      `wasmtypst/sha256/${resource.sha256}`,
      await readBytes(resource.fixture),
    );
  const loader = createResourceLoader({
    resources: lock,
    offline: true,
    cache: {
      async get(key) {
        return cache.get(key) ?? null;
      },
      async put() {
        throw new Error("Offline qualification must not write cache");
      },
    },
  });
  const begin = performance.now();
  const compiler = await createCompiler({ resolveFile: loader.resolveFile });
  const coldMs = performance.now() - begin;
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  try {
    for (const resource of lock.filter((item) =>
      item.path.startsWith("fonts/"),
    ))
      await compiler.addFont(await loader.resolveFile(resource.path));
    for (const item of cases) {
      await compiler.snapshot({ files: item.files, entry: item.entry });
      const start = performance.now();
      const paged = await compiler.compile();
      const firstCompileMs = performance.now() - start;
      check(
        paged.success,
        `${item.name}: ${JSON.stringify(paged.diagnostics)}`,
      );
      check(
        paged.pages.length >= item.minPages,
        `${item.name}: unexpected page count`,
      );
      check(
        !paged.diagnostics.some((d) =>
          /unknown font|missing glyph|does not contain.*glyph/i.test(d.message),
        ),
        `${item.name}: missing font/glyph ${JSON.stringify(paged.diagnostics)}`,
      );
      const pdf = await compiler.pdf(paged.revision);
      check(
        new TextDecoder().decode(pdf.slice(0, 5)) === "%PDF-",
        `${item.name}: PDF export`,
      );
      const svg = await compiler.svg(paged.revision, 1);
      check(svg.includes("<svg"), `${item.name}: SVG export`);
      const html = await compiler.compileHtml();
      if (item.html)
        check(
          html.success && html.html,
          `${item.name} HTML: ${JSON.stringify(html.diagnostics)}`,
        );
      const warm = [];
      for (let i = 0; i < samples; i++) {
        await compiler.putFile(
          item.entry,
          `${item.files[item.entry]}\nRevision ${i}.`,
        );
        const before = performance.now();
        const edited = await compiler.compile();
        check(
          edited.success,
          `${item.name}: incremental edit ${JSON.stringify(edited.diagnostics)}`,
        );
        warm.push(performance.now() - before);
      }
      let staleRefused = false;
      try {
        await compiler.pdf(paged.revision);
      } catch {
        staleRefused = true;
      }
      check(staleRefused, `${item.name}: stale export accepted`);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", pdf));
      const pdfSha256 = Array.from(digest, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      const stats = await compiler.stats();
      check(
        stats.wasmLinearMemoryBytes <= 96 * 1024 * 1024,
        `${item.name}: corpus linear-memory budget exceeded`,
      );
      results.push({
        pdfSha256,
        name: item.name,
        pages: paged.pages.length,
        pdfBytes: pdf.length,
        firstCompileMs,
        warmCompileMs: warm,
        html: { success: html.success, diagnostics: html.diagnostics },
        diagnostics: paged.diagnostics,
        stats,
      });
    }
  } finally {
    compiler.dispose();
  }
  return { coldMs, samples, results };
}
