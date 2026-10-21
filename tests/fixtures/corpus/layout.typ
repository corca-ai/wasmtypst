#set page(header: [Layout audit], footer: context counter(page).display("1 / 1", both: true))
= Two column investigation
#columns(2, gutter: 12pt)[
  #for i in range(8) [A reproducible study preserves its source data, labels and assumptions.

]
]
#pagebreak()
= Appendix
#place(top + right, rect(width: 30pt, height: 20pt, fill: blue))
#grid(columns: (1fr, 1fr), gutter: 8pt,
  [*Control arm*\ Evidence with a note.#footnote[The note belongs to the control arm.]],
  [*Treatment arm*\ An independently measured result.],
)
