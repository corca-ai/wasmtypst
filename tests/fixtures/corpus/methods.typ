= Method <method>
An equation and a cross-file reference to @intro.
$ integral_0^1 x^2 dif x = 1/3 $
- Admit immutable inputs.
  - Check references.
  - Record uncertainty.
- Evaluate once.
#let summarize(values) = values.sum() / values.len()
The mean is #summarize((1, 2, 3)).
