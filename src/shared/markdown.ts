/**
 * Markdown rendering helpers shared across the report generators.
 */

// Render an arbitrary value safely inside a markdown table cell: the escape
// character is escaped FIRST, then the pipe delimiter, and newlines are folded
// to a space so a value can never break out of its cell or row (nor can the
// pipe-escaping itself be neutralised). Data-derived values can contain
// anything, so this is applied to every value that reaches a table.
export function mdCell(text: string, maxLength = 160): string {
  return String(text)
    .slice(0, maxLength)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

// A visible codepoint marker, matching the {U+XXXX} form the sweep reports use
// (shared marker vocabulary, so a Character key can name them uniformly).
function codepointMarker(ch: string): string {
  return `{U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}`;
}

// Render an arbitrary data value as a markdown CODE SPAN for a table cell:
// monospace, so the precise value is unambiguous, and injection-safe — a
// crafted or corrupt value cannot break out of the span, the cell or the row,
// nor inject inline markup or a link (code-span content is inert). The only
// characters that could break a single-backtick code span inside a pipe table
// are the backtick delimiter and the pipe itself; both become visible {U+XXXX}
// markers, as do all control/format/other-whitespace characters and the
// replacement character. Leading and trailing spaces are marked too (table
// cells are trimmed on render, so edge whitespace would otherwise vanish),
// while INTERNAL ordinary spaces stay literal so multi-word values remain
// readable. Everything else — <, >, [, ], *, _, & — is inert inside the span
// and needs no escaping. Iterating by code point keeps astral characters whole.
export function mdCode(value: string): string {
  const chars = [...value];
  let lead = 0;
  while (lead < chars.length && chars[lead] === ' ') lead++;
  let trail = chars.length;
  while (trail > lead && chars[trail - 1] === ' ') trail--;
  let inner = '';
  chars.forEach((ch, i) => {
    if (ch === ' ' && i >= lead && i < trail) {
      inner += ch; // an ordinary internal space: keep it readable
    } else if (ch === '`' || ch === '|' || /[\p{C}\p{Z}�]/u.test(ch)) {
      inner += codepointMarker(ch);
    } else {
      inner += ch;
    }
  });
  return `\`${inner}\``;
}
