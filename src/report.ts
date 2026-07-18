import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Analysis, VariantSummary, SectionImpact, ImpactSignal } from "./analyze.js";
import { REPORT_PATH, ANALYSIS_PATH } from "./constants.js";

function esc(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function summaryRow(s: VariantSummary): string {
  const tokens = s.avgTokens === undefined ? "—" : Math.round(s.avgTokens).toLocaleString();
  const filesRead = s.avgFilesRead === undefined ? "—" : s.avgFilesRead.toFixed(1);
  return `<tr>
    <td>${s.variant}</td>
    <td>${pct(s.passRate)} <span class="muted">(${s.passed}/${s.runs})</span></td>
    <td>${tokens}</td>
    <td>${(s.avgDurationMs / 1000).toFixed(1)}s</td>
    <td>${s.avgFilesChanged.toFixed(1)}</td>
    <td>${filesRead}</td>
  </tr>`;
}

function sectionRow(title: string, tokens: number, total: number): string {
  const share = total ? Math.round((tokens / total) * 100) : 0;
  return `<tr>
    <td>${esc(title)}</td>
    <td>${tokens.toLocaleString()}</td>
    <td><div class="bar" style="width:${share}%"></div><span class="muted">${share}%</span></td>
  </tr>`;
}

const SIGNAL_LABELS: Record<ImpactSignal, string> = {
  "earns-its-keep": "Earns its keep",
  "no-measurable-impact": "No measurable impact",
  "actively-hurts": "Actively hurts",
  "too-small-to-measure": "Too small to measure",
  "low-confidence": "Low confidence",
};

function impactRow(i: SectionImpact): string {
  const sign = i.impactPct >= 0 ? "+" : "";
  const cls = i.signal === "earns-its-keep" ? "good" : i.signal === "actively-hurts" ? "bad" : "muted";
  return `<tr>
    <td>${esc(i.title)}</td>
    <td>${sign}${i.impactPct.toFixed(0)} pts <span class="muted">(${Math.round(i.ablatedPassRate * 100)}% ablated)</span></td>
    <td>${i.tokens.toLocaleString()}</td>
    <td class="${cls}">${SIGNAL_LABELS[i.signal]}</td>
  </tr>`;
}

function impactSection(impacts: SectionImpact[]): string {
  return `
<h2>Section impact (leave-one-out ablation)</h2>
<p class="muted">Each section was removed in turn; impact is <code>current pass rate − ablated pass rate</code>. Positive means removing the section hurt (it earns its keep); ~0 means no measurable effect; negative means the section may hurt.</p>
<table>
  <thead><tr><th>Section</th><th>Pass-rate impact</th><th>Tokens</th><th>Signal</th></tr></thead>
  <tbody>${impacts.map(impactRow).join("")}</tbody>
</table>`;
}

/** Render the analysis into a single self-contained HTML document. */
export function renderReport(analysis: Analysis): string {
  const { passRateDeltaPct, lowConfidence, sections, totalInstructionTokens, taskCount } = analysis;
  const sign = passRateDeltaPct >= 0 ? "+" : "";
  const headline = `Your instructions changed pass rate by <strong>${sign}${passRateDeltaPct.toFixed(0)} pts</strong>`;
  const confidence = lowConfidence
    ? `<p class="warn">⚠ Low confidence: too few runs to separate signal from agent noise. Increase <code>reps</code> or add more tasks before trusting this delta.</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>optirule report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #8883; }
  th { font-weight: 600; } .muted { color: #8889; font-size: .85em; }
  .headline { font-size: 1.15rem; margin: 1rem 0; }
  .warn { background: #f5a5; border-radius: 6px; padding: .6rem .8rem; }
  .bar { display: inline-block; height: .7em; background: #4a90d9; border-radius: 2px; vertical-align: middle; margin-right: .4rem; min-width: 2px; }
  code { background: #8882; padding: 0 .3em; border-radius: 3px; }
  .good { color: #2a8a3e; font-weight: 600; } .bad { color: #c0392b; font-weight: 600; }
</style></head><body>
<h1>optirule report</h1>
<p class="headline">${headline}</p>
<p class="muted">Across ${taskCount} task${taskCount === 1 ? "" : "s"}, baseline (no instructions) vs current (your instruction file).</p>
${confidence}

<h2>Summary</h2>
<table>
  <thead><tr><th>Variant</th><th>Pass rate</th><th>Avg tokens</th><th>Avg runtime</th><th>Avg files changed</th><th>Avg files read</th></tr></thead>
  <tbody>${analysis.variants.map(summaryRow).join("")}</tbody>
</table>
${analysis.sectionImpacts?.length ? impactSection(analysis.sectionImpacts) : ""}

<h2>Instruction cost by section</h2>
<p class="muted">Static token cost of each section (~${totalInstructionTokens.toLocaleString()} tokens total, paid on every run).${analysis.sectionImpacts?.length ? "" : " The benefit side is measured above at the whole-file level; per-section impact needs <code>--ablate</code>."}</p>
<table>
  <thead><tr><th>Section</th><th>Tokens</th><th>Share</th></tr></thead>
  <tbody>${sections.map((s) => sectionRow(s.title, s.tokens, totalInstructionTokens)).join("")}</tbody>
</table>
</body></html>`;
}

/** Render and write the report, returning the path written. */
export function writeReport(repoDir: string, analysis: Analysis): string {
  const path = `${repoDir}/${REPORT_PATH}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderReport(analysis));
  return path;
}

/** Persist the raw analysis so `optirule export` can read it back. */
export function writeAnalysis(repoDir: string, analysis: Analysis): string {
  const path = `${repoDir}/${ANALYSIS_PATH}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(analysis, null, 2));
  return path;
}

/** Read back a persisted analysis, or undefined if no run has been recorded. */
export function readAnalysis(repoDir: string): Analysis | undefined {
  const path = `${repoDir}/${ANALYSIS_PATH}`;
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as Analysis;
}
