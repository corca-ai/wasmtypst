// Shared by the Node and actual-browser corpus runners. Authored fixtures are MIT.
export async function corpusCases(readText) {
  const article = {};
  for (const file of ["article.typ", "methods.typ", "refs.bib", "plot.svg"])
    article[file] = await readText(`corpus/${file}`);
  const ieee = {
    "main.typ": await readText("charged-ieee/main.typ"),
    "refs.bib": await readText("charged-ieee/refs.bib"),
  };
  return [
    {
      name: "academic-multifile",
      entry: "article.typ",
      files: article,
      minPages: 1,
      html: true,
    },
    {
      name: "upstream-charged-ieee",
      entry: "main.typ",
      files: ieee,
      minPages: 2,
      html: true,
    },
    {
      name: "cjk",
      entry: "main.typ",
      files: { "main.typ": await readText("corpus/multilingual.typ") },
      minPages: 1,
      html: true,
    },
    {
      name: "cmarker-plugin",
      entry: "main.typ",
      files: {
        "main.typ":
          '#import "@preview/cmarker:0.1.8": render\n#render("# Imported Markdown\\nA **strong** result with a list:\\n- one\\n- two")',
      },
      minPages: 1,
      html: true,
    },
    {
      name: "long-research",
      entry: "main.typ",
      files: {
        "main.typ": Array.from(
          { length: 24 },
          (_, i) =>
            `${i ? "#pagebreak()\n" : ""}= Chapter ${i + 1}\n` +
            "Research results connect measurements with explicit assumptions and limitations.\n\n".repeat(
              12,
            ) +
            "$ integral_0^1 x^2 dif x = 1/3 $\n#table(columns: 2, [Method], [Result], [A], [42])\n",
        ).join("\n"),
      },
      minPages: 24,
      html: true,
    },
  ];
}
