// Browser-safe behavior and measurements; no package-network access during qualification.
export async function runCorpus(
  createCompiler,
  createResourceLoader,
  cases,
  lock,
  readBytes,
  samples = 3,
  capture,
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
  let compiler;
  let projectGroup;
  let coldMs;
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  try {
    for (const item of cases) {
      const group = item.projectGroup ?? item.name;
      if (group !== projectGroup) {
        compiler?.dispose();
        compiler = undefined;
        projectGroup = group;
      }
      if (item.resourceLimit) {
        // This full-resolution case deliberately exhausts the runtime budget; isolate its worker.
        const limited = await createCompiler({
          configuration: { date: [2026, 10, 21] },
        });
        let beforeFailure;
        try {
          for (const resource of lock.filter(
            (item) => item.path === "fonts/NotoSans.ttf",
          ))
            await limited.addFont(await loader.resolveFile(resource.path));
          await limited.snapshot({ files: item.files, entry: item.entry });
          const output = await limited.compile();
          check(
            output.success && output.pages.length >= item.minPages,
            `${item.name}: unexpected compile failure ${JSON.stringify(output.diagnostics)}`,
          );
          beforeFailure = await limited.stats();
          check(
            beforeFailure.wasmLinearMemoryBytes >= 200 * 1024 * 1024,
            `${item.name}: resource workload changed`,
          );
          let trapped = false;
          try {
            await limited.pdf(output.revision);
          } catch (error) {
            trapped = /unreachable/i.test(error.message);
          }
          check(
            trapped,
            `${item.name}: expected fatal export trap was not reproduced; revisit the resource contract`,
          );
        } finally {
          limited.dispose();
        }
        const recovered = await createCompiler({
          files: { "main.typ": "Recovered after resource exhaustion." },
        });
        try {
          const output = await recovered.compile();
          check(
            output.success &&
              (await recovered.pdf(output.revision)).length > 100,
            `${item.name}: fresh worker did not recover`,
          );
        } finally {
          recovered.dispose();
        }
        results.push({
          name: item.name,
          status: "known-resource-limit",
          pdfSha256: null,
          operation: "pdf",
          beforeFailure,
          recovered: true,
        });
        continue;
      }

      let initializationMs = 0;
      if (!compiler) {
        const before = performance.now();
        compiler = await createCompiler({
          resolveFile: loader.resolveFile,
          configuration: { date: [2026, 10, 21] },
        });
        initializationMs = performance.now() - before;
        coldMs ??= initializationMs;
        for (const resource of lock.filter((item) =>
          item.path.startsWith("fonts/"),
        ))
          await compiler.addFont(await loader.resolveFile(resource.path));
      }
      await compiler.snapshot({ files: item.files, entry: item.entry });
      const start = performance.now();
      const paged = await compiler.compile();
      const firstCompileMs = performance.now() - start;
      if (item.expectedError || item.expectedErrors) {
        check(
          !paged.success,
          `${item.name}: expected failure was not reproduced; update the support contract`,
        );
        const expected = item.expectedErrors ?? [item.expectedError];
        const errors = paged.diagnostics.filter((d) => d.severity === "error");
        check(
          errors.length === expected.length &&
            expected.every((expectation) =>
              errors.some(
                (d) =>
                  d.message === expectation.message &&
                  d.location?.path === expectation.path,
              ),
            ),
          `${item.name}: unexpected failure ${JSON.stringify(paged.diagnostics)}`,
        );
        // Failed source must not poison a subsequent valid snapshot in the same worker.
        await compiler.snapshot({
          files: { "main.typ": "Recovered after refused source." },
          entry: "main.typ",
        });
        const recovery = await compiler.compile();
        check(
          recovery.success &&
            (await compiler.pdf(recovery.revision)).length > 100,
          `${item.name}: source recovery failed`,
        );
        results.push({
          name: item.name,
          status: item.refusal ? "expected-refusal" : "known-incompatible",
          pdfSha256: null,
          diagnostics: paged.diagnostics,
          recovered: true,
          stats: await compiler.stats(),
        });
        continue;
      }
      check(
        paged.success,
        `${item.name}: ${JSON.stringify(paged.diagnostics)}`,
      );
      check(
        paged.pages.length >= item.minPages,
        `${item.name}: unexpected page count`,
      );
      check(
        !paged.diagnostics.some(
          (d) =>
            /unknown font|missing glyph|does not contain.*glyph/i.test(
              d.message,
            ) && !(item.allowedWarnings ?? []).includes(d.message),
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
      for (const text of item.containsHtml ?? [])
        check(
          html.html?.includes(text),
          `${item.name}: missing expected HTML content ${text}`,
        );
      for (const limitation of item.htmlLimitations ?? []) {
        check(
          html.diagnostics.some((d) => d.message === limitation.message),
          `${item.name}: expected HTML limitation changed`,
        );
        if (limitation.missingText)
          check(
            !html.html.includes(limitation.missingText),
            `${item.name}: HTML limitation improved; update contract`,
          );
      }
      await capture?.({
        item,
        pdf,
        html: html.html,
        pages: paged.pages.length,
      });
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
        projectGroup: group,
        initializationMs,
        status: item.adapted ? "adapted-supported" : "supported",
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
    compiler?.dispose();
  }
  return { coldMs, samples, results };
}
