// A schema file as separate statements: the Neon HTTP driver runs one statement per request. Comments are dropped, a `;` inside quotes does not split.
export function splitSql(text: string): string[] {
  const out: string[] = [];
  let cur = '', quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '-' && text[i + 1] === '-') { while (i < text.length && text[i] !== '\n') i++; cur += '\n'; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
