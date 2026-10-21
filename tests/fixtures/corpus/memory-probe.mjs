// Shared real-SDK workload for independent Node processes and browser Workers.
export async function probeMemory(
  createCompiler,
  options,
  item,
  font,
  samples = 5,
) {
  const observations = [];
  const times = [];
  let phase = "initialize";
  let compiler;
  let pages;
  let pdfSha256;
  let pdfBytes;
  const start = performance.now();
  try {
    compiler = await createCompiler({
      ...options,
      configuration: { date: [2026, 10, 21] },
    });
    const initializationMs = performance.now() - start;
    const observe = async () => {
      const stats = await compiler.stats();
      observations.push({ phase, ...stats });
      return stats;
    };
    await observe();
    await compiler.addFont(font);
    await compiler.snapshot({ files: item.files, entry: item.entry });
    phase = "compile";
    const output = await compiler.compile();
    if (!output.success) throw new Error(JSON.stringify(output.diagnostics));
    pages = output.pages.length;
    await observe();
    phase = "pdf";
    const pdf = await compiler.pdf(output.revision);
    pdfBytes = pdf.length;
    pdfSha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", pdf)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    await observe();
    phase = "svg";
    if (!(await compiler.svg(output.revision, 1)).includes("<svg"))
      throw new Error("SVG output missing");
    await observe();
    phase = "html";
    const html = await compiler.compileHtml();
    if (!html.success || !html.html?.includes("Pixels and their Neighbours"))
      throw new Error(JSON.stringify(html.diagnostics));
    await observe();
    for (let i = 0; i < samples; i++) {
      phase = `edit-${i}`;
      await compiler.putFile(
        item.entry,
        `${item.files[item.entry]}\nRevision ${i}.`,
      );
      const before = performance.now();
      const edited = await compiler.compile();
      if (!edited.success) throw new Error(JSON.stringify(edited.diagnostics));
      await compiler.pdf(edited.revision);
      times.push(performance.now() - before);
      await observe();
    }
    return {
      status: "supported",
      initializationMs,
      pages,
      pdfBytes,
      pdfSha256,
      observations,
      editAndExportMs: times,
    };
  } catch (error) {
    return {
      status: "failed",
      phase,
      error: String(error.message),
      pages,
      observations,
      editAndExportMs: times,
    };
  } finally {
    compiler?.dispose();
  }
}
