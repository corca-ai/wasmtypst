#set document(title: "Reproducible research", author: "WasmTypst corpus")
#set heading(numbering: "1.1")
= Reproducible research <intro>
#outline()
#include "methods.typ"
= Results
We compare the method in @method with the evidence in @evidence.
#figure(
  table(columns: 3, [Method], [Estimate], [Uncertainty], [A], [$1/3$], [$plus.minus 0.01$]),
  caption: [Measured estimates.],
) <evidence>
#figure(image("plot.svg", width: 60%), caption: [A vector result.])
The bibliography is supplied as a separate project file @doe2024.
#footnote[Inputs and the evaluation date are explicit.]
#bibliography("refs.bib")
