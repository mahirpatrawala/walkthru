// The ceiling height a hung piece (a jhoola, a hanging chair) is drawn up to. The buyer page sets it from the home it opened; tests and
// the editor leave the default. A generator reads it when it builds, so a piece built before the home loaded is rebuilt by the tier change.
let ceilingM = 2.7;
export function setGenCeiling(m: number): void { if (Number.isFinite(m) && m > 1.8 && m < 6) ceilingM = m; }
export function genCeiling(): number { return ceilingM; }
