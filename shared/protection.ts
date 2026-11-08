/**
 * Text that must survive a rewrite verbatim: code, inline code, URLs, paths, and anything the
 * user marked as a protected term. The assistant never masks them; it asks the model to keep
 * them and then checks the suggestion before the user can adopt it.
 */
export type ProtectedKind = "code" | "inline-code" | "url" | "path" | "term";

export interface ProtectedSegment {
  kind: ProtectedKind;
  value: string;
}

interface Range {
  start: number;
  end: number;
  kind: ProtectedKind;
  value: string;
}

const PATTERNS: { kind: ProtectedKind; pattern: RegExp }[] = [
  { kind: "code", pattern: /```[\s\S]*?```/g },
  { kind: "url", pattern: /https?:\/\/[^\s)\]}"'<>]+/g },
  { kind: "inline-code", pattern: /`[^`\n]+`/g },
  { kind: "path", pattern: /(?:^|[\s(])((?:~\/|\/|\.{1,2}\/|[A-Za-z]:\\)[\w.@+-]+(?:\/[\w.@+-]+)+)/g },
];

function collect(text: string, kind: ProtectedKind, pattern: RegExp): Range[] {
  const ranges: Range[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = kind === "path" ? (match[1] ?? match[0]) : match[0];
    if (!value) continue;
    const offset = match[0].indexOf(value);
    const start = (match.index ?? 0) + Math.max(offset, 0);
    ranges.push({ start, end: start + value.length, kind, value });
  }
  return ranges;
}

export function extractProtected(text: string, extraTerms: readonly string[] = []): ProtectedSegment[] {
  const ranges: Range[] = [];
  for (const { kind, pattern } of PATTERNS) ranges.push(...collect(text, kind, pattern));
  for (const term of extraTerms) {
    const value = term.trim();
    if (!value) continue;
    let index = text.indexOf(value);
    while (index >= 0) {
      ranges.push({ start: index, end: index + value.length, kind: "term", value });
      index = text.indexOf(value, index + value.length);
    }
  }
  // Longer, earlier matches win so a path inside a code fence stays one code segment.
  ranges.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
  const chosen: Range[] = [];
  for (const range of ranges) {
    const overlaps = chosen.some((entry) => range.start < entry.end && range.end > entry.start);
    if (!overlaps) chosen.push(range);
  }
  return chosen
    .sort((left, right) => left.start - right.start)
    .map((range) => ({ kind: range.kind, value: range.value }));
}

export function verifyProtected(input: {
  original: string;
  suggestion: string;
  extraTerms?: readonly string[];
}): { ok: true } | { ok: false; missing: ProtectedSegment[] } {
  const segments = extractProtected(input.original, input.extraTerms ?? []);
  const missing = segments.filter((segment) => !input.suggestion.includes(segment.value));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
