import type { Section } from "./types.js";

/**
 * Approximate token count. Deliberately a cheap heuristic (~4 chars/token)
 * rather than a model-specific tokenizer dependency; good enough to rank the
 * relative cost of instruction sections.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split an instruction file into `##` sections with their token cost. Content
 * before the first `##` is reported as an "(intro)" section so the per-section
 * costs account for the whole file.
 */
export function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let title = "(intro)";
  let buffer: string[] = [title];

  const flush = () => {
    const body = buffer.join("\n");
    if (body.trim()) sections.push({ title, tokens: estimateTokens(body) });
  };

  for (const line of lines) {
    const heading = /^##\s+(.+)/.exec(line);
    if (heading) {
      flush();
      title = heading[1]!.trim();
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}
