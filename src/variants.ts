import type { ParsedSection } from "./sections.js";

/**
 * A variant of the instruction files to run:
 * - `baseline`: instruction files removed entirely.
 * - `current`: instruction files as they are today.
 * - `ablate`: current, but with one section removed from its source file.
 *
 * `id` is path-safe: it names the snapshot directory and tags each RunResult.
 */
export type VariantSpec =
  | { id: "baseline"; kind: "baseline" }
  | { id: "current"; kind: "current" }
  | { id: string; kind: "ablate"; section: ParsedSection };

/** Path-safe slug for a section title (no slashes or spaces to break snapshot paths). */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * Build the variant list for a run. Without `--ablate` it is just baseline +
 * current. With it, one `ablate` variant is appended per section; ids that
 * would collide (titles slugging alike) are disambiguated with a suffix.
 */
export function planVariants(sections: ParsedSection[], ablate: boolean): VariantSpec[] {
  const variants: VariantSpec[] = [
    { id: "baseline", kind: "baseline" },
    { id: "current", kind: "current" },
  ];
  if (!ablate) return variants;

  const seen = new Map<string, number>();
  for (const section of sections) {
    let id = `ablate-${slugify(section.title)}`;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count + 1}`;
    variants.push({ id, kind: "ablate", section });
  }
  return variants;
}
