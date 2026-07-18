/**
 * Approximate token count. Deliberately a cheap heuristic (~4 chars/token)
 * rather than a model-specific tokenizer dependency; good enough to rank the
 * relative cost of instruction sections.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * A `##` section parsed from an instruction file, with its token cost and the
 * exact line span it occupies. The span (0-based, inclusive) lets ablation
 * rebuild the file with this section removed.
 */
export interface ParsedSection {
  /** Instruction file the section came from. */
  file: string;
  /** Heading text without the leading `##`. */
  title: string;
  /** Estimated token count of the heading plus its body. */
  tokens: number;
  /** First line index of the section (the `##` line, or 0 for the intro). */
  startLine: number;
  /** Last line index of the section, inclusive. */
  endLine: number;
}

/**
 * Split an instruction file into `##` sections with their token cost and line
 * span. Content before the first `##` is reported as an "(intro)" section so
 * the per-section costs account for the whole file.
 */
export function parseSections(markdown: string, file = ""): ParsedSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  let title = "(intro)";
  let start = 0;
  let buffer: string[] = [];

  const flush = (endLine: number) => {
    const body = buffer.join("\n");
    if (body.trim()) {
      sections.push({ file, title, tokens: estimateTokens(body), startLine: start, endLine });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^##\s+(.+)/.exec(line);
    if (heading) {
      flush(i - 1);
      title = heading[1]!.trim();
      start = i;
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  flush(lines.length - 1);
  return sections;
}

/** Rebuild file content with a section's line span removed. */
export function removeSection(content: string, section: ParsedSection): string {
  const lines = content.split("\n");
  return [...lines.slice(0, section.startLine), ...lines.slice(section.endLine + 1)].join("\n");
}
