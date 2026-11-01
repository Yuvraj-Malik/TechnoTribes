// The Critic: a second agent that reviews what the Builder just did, before any
// human sees it. Two layers:
//   1. rule checks (always run, no API needed): guardrail words added, files changed
//      outside the plan, placeholder/TODO code, broken JSON, large deletions, no edits
//   2. a Claude review (live mode): does the diff do the task, follow the context,
//      and avoid obvious bugs?
// The result is shown to the developer in their workspace and to the manager in Review.
import { callLLMJSON } from '../llm.js';
import { agentMode } from './index.js';
import { unifiedDiff } from '../files.js';

const lower = (s) => String(s ?? '').toLowerCase();

export function ruleChecks({ plan, before, after, changedFiles, sections }) {
  const findings = [];
  if (!changedFiles.length) {
    findings.push({ severity: 'high', file: null, issue: 'The builder did not change any file.', suggestion: 'Ask the agent again with a more specific request.' });
  }
  const planned = new Set(plan?.files ?? []);
  for (const f of changedFiles) {
    const a = after[f]; const b = before[f];
    if (planned.size && !planned.has(f)) {
      findings.push({ severity: 'medium', file: f, issue: 'Changed a file that was not in the confirmed plan.', suggestion: 'Check that this change was intended.' });
    }
    if (a != null && /TODO \(simulated agent\)|TODO:|FIXME|lorem ipsum/i.test(a) && !/TODO \(simulated agent\)|TODO:|FIXME|lorem ipsum/i.test(b ?? '')) {
      findings.push({ severity: 'high', file: f, issue: 'Contains placeholder text (TODO / FIXME / lorem ipsum) instead of finished work.', suggestion: 'Finish the change before submitting.' });
    }
    if (a != null && f.endsWith('.json')) {
      try { JSON.parse(a); } catch (e) { findings.push({ severity: 'high', file: f, issue: `The JSON is broken: ${e.message}`, suggestion: 'Fix the syntax.' }); }
    }
    if (a == null && b != null) {
      findings.push({ severity: 'medium', file: f, issue: 'The file was deleted.', suggestion: 'Make sure nothing else uses it.' });
    } else if (b && a && a.length < b.length * 0.5 && b.length > 400) {
      findings.push({ severity: 'medium', file: f, issue: `More than half of the file was removed (${b.length} → ${a.length} characters).`, suggestion: 'Check nothing important was lost.' });
    }
    // Guardrail words the context forbids, newly added by this change.
    for (const s of sections) {
      for (const g of s.guardrails ?? []) {
        const p = lower(g.phrase);
        if (p && lower(a).includes(p) && !lower(b).includes(p)) {
          findings.push({ severity: 'high', file: f, issue: `Adds "${g.phrase}", but ${s.title} (v${s.version}) says: ${g.note}`, suggestion: `Follow ${s.title}.` });
        }
      }
    }
  }
  return findings;
}

const SEVERITY = { high: 0, medium: 1, low: 2 };

function verdictOf(findings) {
  if (findings.some((f) => f.severity === 'high')) return 'needs_changes';
  if (findings.length) return 'minor_issues';
  return 'looks_good';
}

async function liveReview({ project, task, plan, sections, diff }) {
  const system = `You are the Critic agent on the project "${project?.name ?? 'this project'}". Another agent (the Builder) just changed the code for a developer.
Review the change strictly but fairly. Report only real problems: the task not done, the project context broken, bugs, broken HTML/CSS/JS, accessibility or mobile problems, or risky changes. Do not nitpick style.
Reply with ONLY one JSON object.`;
  const prompt = `TASK: ${task}

CONFIRMED PLAN
${plan?.understanding ?? ''}
${(plan?.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

PROJECT CONTEXT THE CHANGE MUST FOLLOW
${sections.map((s) => `[${s.title} v${s.version}] ${s.content}`).join('\n\n')}

THE CHANGE (unified diff)
${diff.slice(0, 40000)}

Schema: { "doesTheTask": boolean, "summary": string (1-2 plain sentences for the developer), "findings": [ { "severity": "high" | "medium" | "low", "file": string | null, "issue": string, "suggestion": string } ] }`;
  const { value, model } = await callLLMJSON('critic', { system, prompt, maxTokens: 3000, timeoutMs: 55000 }, (o) => {
    if (!Array.isArray(o.findings) || typeof o.summary !== 'string') throw new Error('findings and summary are required');
    return {
      doesTheTask: o.doesTheTask !== false,
      summary: o.summary,
      findings: o.findings.map((f) => ({
        severity: ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'low',
        file: f.file ? String(f.file) : null, issue: String(f.issue ?? ''), suggestion: String(f.suggestion ?? ''),
      })).filter((f) => f.issue),
    };
  });
  return { ...value, model };
}

/** Reviews the builder's change. Never throws: a failed Claude call falls back to the rule checks. */
export async function critique({ project, task, plan, sections, before, after, changedFiles }) {
  const rules = ruleChecks({ plan, before, after, changedFiles, sections });
  const diff = changedFiles.map((p) => unifiedDiff(p, before[p] ?? null, after[p] ?? null)).join('');
  let live = null;
  let mode = 'rules';
  if (agentMode() === 'live' && changedFiles.length) {
    try { live = await liveReview({ project, task, plan, sections, diff }); mode = 'live'; } catch (err) {
      console.warn('[critic] live review failed, using rule checks only:', err.message);
    }
  }
  const findings = [...rules, ...(live?.findings ?? [])]
    .filter((f, i, all) => all.findIndex((x) => x.issue === f.issue && x.file === f.file) === i)
    .sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  if (live && !live.doesTheTask && !findings.some((f) => f.severity === 'high')) {
    findings.unshift({ severity: 'high', file: null, issue: 'The change does not fully do the task.', suggestion: 'See the summary and ask the agent to finish it.' });
  }
  const verdict = verdictOf(findings);
  const summary = live?.summary
    || (verdict === 'looks_good' ? 'No problems found by the automatic checks.' : `${findings.length} thing${findings.length > 1 ? 's' : ''} to look at before submitting.`);
  // `issues` is the short form the workspace panel shows; `findings` keeps file and suggestion apart.
  const issues = findings.map((f) => ({ severity: f.severity, note: `${f.file ? `${f.file}: ` : ''}${f.issue}${f.suggestion ? ` → ${f.suggestion}` : ''}` }));
  return { verdict, summary, findings, issues, mode, model: live?.model ?? null, at: new Date().toISOString() };
}
