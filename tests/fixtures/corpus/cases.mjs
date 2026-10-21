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

export async function extendedCases(readText, readBytes) {
  const result = [];
  for (const [name, paths, containsHtml] of [
    [
      "mathematics",
      ["mathematics.typ"],
      ["Spectral stability", "Theorem", "<math", "<table"],
    ],
    [
      "data-report",
      ["data-report.typ", "metadata.json", "measurements.csv", "plot.svg"],
      ["Replication dataset", "Control", "locked-2026", "<table"],
    ],
    [
      "multilingual-extended",
      ["multilingual-extended.typ"],
      ["Multilingual editing", "naïve", "Наука", "<math"],
    ],
    ["layout", ["layout.typ"], ["Two column investigation", "Appendix"]],
  ]) {
    const files = {};
    for (const path of paths) files[path] = await readText(`corpus/${path}`);
    result.push({
      name,
      entry: paths[0],
      files,
      minPages: name === "layout" ? 2 : 1,
      html: true,
      containsHtml,
      ...(name === "layout"
        ? {
            htmlLimitations: [
              {
                message: "grid was ignored during HTML export",
                missingText: "Treatment arm",
              },
              { message: "columns was ignored during HTML export" },
            ],
          }
        : {}),
    });
  }
  const upstream = JSON.parse(await readText("corpus/upstream.json"));
  for (const [name, prefix, entry, text] of [
    [
      "upstream-springer",
      "upstream/springer-spaniel/0.1.0/template/",
      "main.typ",
      "Interstellar",
    ],
    [
      "upstream-elsearticle",
      "upstream/elsearticle/3.1.0/template/",
      "main.typ",
      null,
    ],
    [
      "upstream-math-paper",
      "upstream/clean-math-paper/0.2.8/template/",
      "main.typ",
      null,
    ],
    [
      "upstream-finite-volume",
      "upstream/lapreprint/",
      "examples/pixels/main.typ",
      "Pixels and their Neighbours",
    ],
  ]) {
    const files = {};
    for (const item of upstream.filter((item) =>
      item.fixture.startsWith(prefix),
    )) {
      const path = item.fixture.slice(prefix.length);
      if (/\.(typ|bib|svg|json|csv|yaml|png|jpe?g)$/.test(path))
        files[path] = /\.(png|jpe?g)$/.test(path)
          ? await readBytes(item.fixture)
          : await readText(item.fixture);
    }
    if (name === "upstream-finite-volume") {
      result.push({
        name: "upstream-finite-volume-original",
        entry,
        files: { ...files },
        expectedError: {
          message: "only element functions can be used as selectors",
          path: "lapreprint.typ",
        },
      });
      const source = files["lapreprint.typ"];
      let adapted = source;
      for (const [before, after] of [
        ["counter(page).final(loc)", "counter(page).final()"],
        ["#counter(page).display()", "#context counter(page).display()"],
        ["image.decode(orcidSvg)", "image(bytes(orcidSvg))"],
      ]) {
        if (adapted.split(before).length !== 2)
          throw new Error(`Pinned adaptation no longer matches: ${before}`);
        adapted = adapted.replace(before, after);
      }
      files["lapreprint.typ"] =
        "#let locate(callback) = context callback(here())\n" + adapted;
      result.push({
        name: "upstream-finite-volume-full-images",
        entry,
        files: { ...files },
        largeRaster: true,
        adapted: true,
        html: true,
        memoryBudgetMiB: 384,
        containsHtml: ["Pixels and their Neighbours"],
        minPages: 7,
      });
      const derivatives = JSON.parse(
        await readText("corpus/derived-images.json"),
      );
      for (const image of derivatives) {
        const path = image.source.slice("upstream/lapreprint/".length);
        files[path] = await readBytes(image.fixture);
      }
    }
    result.push({
      name:
        name === "upstream-finite-volume"
          ? "upstream-finite-volume-adapted"
          : name,
      entry,
      files,
      adapted: name === "upstream-finite-volume",
      ...(name === "upstream-springer"
        ? {
            expectedError: {
              message: "type state has no method `display`",
              path: "@preview/ctheorems:1.1.2/lib.typ",
            },
          }
        : {}),
      minPages:
        name === "upstream-elsearticle"
          ? 6
          : name === "upstream-math-paper"
            ? 3
            : name === "upstream-finite-volume"
              ? 7
              : 1,
      html: true,
      ...(name === "upstream-elsearticle"
        ? {
            allowedWarnings: [
              "unknown font family: xits",
              "unknown font family: stix two text",
              "unknown font family: xits math",
              "unknown font family: stix two math",
            ],
          }
        : {}),
      containsHtml: text ? [text] : [],
    });
  }
  return result;
}

export function refusalCases() {
  return [
    {
      name: "refuse-malformed",
      entry: "main.typ",
      files: { "main.typ": "#let x = (]" },
      refusal: true,
      expectedErrors: [
        { message: "unclosed delimiter", path: "main.typ" },
        { message: "unexpected closing bracket", path: "main.typ" },
      ],
    },
    {
      name: "refuse-unapproved-package",
      entry: "main.typ",
      files: { "main.typ": '#import "@preview/corpus-unapproved:9.9.9"' },
      refusal: true,
      expectedErrors: [
        {
          message: "file not found (searched at typst.toml)",
          path: "main.typ",
        },
      ],
    },
    {
      name: "refuse-broken-bibliography",
      entry: "main.typ",
      files: {
        "main.typ": '#bibliography("bad.bib")',
        "bad.bib": "@article{broken",
      },
      refusal: true,
      expectedErrors: [
        {
          message: "failed to parse BibLaTeX (expected comma)",
          path: "bad.bib",
        },
      ],
    },
  ];
}

const pdfText = {
  "academic-multifile": ["Reproducible research", "Measured estimates", "Doe"],
  "upstream-charged-ieee": ["A Typesetting System", "Methods"],
  cjk: ["다국어", "日本語", "中文"],
  "cmarker-plugin": ["Imported Markdown", "strong"],
  "long-research": ["Chapter 24"],
  mathematics: ["Spectral stability", "Proof sketch"],
  "data-report": ["Replication dataset", "Control", "locked-2026"],
  "multilingual-extended": ["naïve café", "Наука"],
  layout: ["Treatment arm", "Control arm"],
  "upstream-elsearticle": ["Title of the paper", "Author"],
  "upstream-math-paper": ["Typst template for mathematical papers", "Author 1"],
  "upstream-finite-volume-full-images": [
    "Pixels and their Neighbours",
    "Finite Volume",
    "Cockett",
  ],
  "upstream-finite-volume-adapted": [
    "Pixels and their Neighbours",
    "Finite Volume",
    "Cockett",
  ],
};
export async function allCases(readText, readBytes) {
  const cases = [
    ...(await corpusCases(readText)).map((item) => ({
      ...item,
      projectGroup: "baseline",
    })),
    ...(await extendedCases(readText, readBytes)),
    ...refusalCases(),
  ];
  return cases.map((item) => ({
    ...item,
    containsPdf: pdfText[item.name] ?? [],
  }));
}
