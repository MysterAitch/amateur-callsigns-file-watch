// A filesystem-safe stem, unique per source, for one source's JSONL.
export function jsonlStem(...parts: string[]): string {
  return parts.join('--').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
