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

// The markdown/HTML/table metacharacters that must be neutralised so a
// data-derived value cannot break a table cell, inject inline formatting or a
// link, or carry markup through to a page rendered from the markdown.
const MD_TEXT_SPECIAL = new Set(['\\', '`', '*', '_', '[', ']', '<', '>', '&', '|']);

// A stricter escaper than mdCell for values that come straight from register
// data and may be published to HTML: control and format characters (including
// newlines and zero-width characters) become visible codepoint markers, and
// every markdown/HTML/table metacharacter is backslash-escaped. A normal value
// (letters, digits, spaces, a slash) is returned unchanged, so the report
// stays readable while a crafted or corrupt value is rendered inert and
// visible. Iterating by code point keeps astral characters whole.
export function mdText(value: string): string {
  let out = '';
  for (const ch of value) {
    if (/\p{Cc}|\p{Cf}/u.test(ch)) {
      out += `{U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}`;
    } else if (MD_TEXT_SPECIAL.has(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  return out;
}
