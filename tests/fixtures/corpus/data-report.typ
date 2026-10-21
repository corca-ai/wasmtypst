#set heading(numbering: "1.")
= Replication audit
#let metadata = json("metadata.json")
Dataset: #metadata.title. Revision: #metadata.revision.
#let rows = csv("measurements.csv")
#table(
  columns: (2fr, 1fr, 1fr),
  table.header([*Method*], [*Estimate*], [*Error*]),
  ..rows.flatten(),
  table.cell(colspan: 3)[All estimates use the same measurement protocol.],
)
#let scores = rows.map(row => float(row.at(1)))
Mean estimate: #calc.round(scores.sum()/scores.len(), digits: 3).
#figure(image("plot.svg", width: 70%), caption: [Vector evidence for replication.]) <plot>
See @plot and the audit checklist:
+ Freeze the data.
+ Inspect uncertainty.
  - Check missing values.
  - Retain provenance.
+ Repeat the calculation.
