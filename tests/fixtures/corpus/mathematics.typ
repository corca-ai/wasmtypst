#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#let theorem(body) = block(stroke: .5pt, inset: 8pt)[*Theorem.* #body]
= Spectral stability <spectral>
#theorem[Every real symmetric matrix admits an orthogonal eigendecomposition.]
$ A = mat(2, 1; 1, 2), quad lambda in {1,3} $ <spectrum>
The spectrum in @spectrum controls the energy estimate.
$ f(x) = cases(x^2 & "if" x >= 0, -x & "otherwise") $
$ norm(A v)_2 <= max_i abs(lambda_i) norm(v)_2 $
$ integral_0^1 sum_(k=0)^n x^k dif x = sum_(k=0)^n 1/(k+1) $
#quote(block: true)[A numerical claim should retain its assumptions.]
== Proof sketch
Write $A = Q Lambda Q^T$ and apply orthogonal invariance.
#footnote[Degenerate eigenvalues do not invalidate this argument.]
#table(columns: 3, [Case], [Rank], [Condition], [Distinct], [2], [Finite], [Repeated], [1], [Singular])
