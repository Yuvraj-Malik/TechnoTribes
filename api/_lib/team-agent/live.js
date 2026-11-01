// LIVE agent: calls Claude (api/_lib/claude.js) and validates the JSON it
// returns. Same interface as the simulated agent. Context guardrails and
// impact analysis stay deterministic; Claude adds judgement on top.
import { callClaudeJSON, ROUTINE_MODEL } from '../claude.js';
import { mockAgent } from './mock.js';

const SYSTEM = `You are a software agent on CampusEats, a food-ordering web app for a college campus, built by several departments (Frontend, Backend, Payments).
Each department has a manager and developers; each developer has their own agent (you). Humans stay in control: explain in plain, short sentences and never act beyond what you were asked.
The project context is the source of truth. Sections have ids, versions, owners and "agents watch for" guardrails. Respect them.
Reply with ONLY one JSON object matching the schema you are given.`;

const renderSections = (sections) => sections.map((s) => [
  `[${s.id}] ${s.scope === 'central' ? 'Central' : s.scope} › ${s.title} (v${s.version})`,
  s.content,
  ...(s.guardrails.length ? [`Agents watch for: ${s.guardrails.map((g) => `"${g.phrase}" → ${g.note}`).join('; ')}`] : []),
].join('\n')).join('\n\n');

const renderFiles = (files) => files.map((f) => `--- ${f.path}\n${f.content}`).join('\n\n');

const base = (i) => `Developer: ${i.user.name} (${i.department.name})
Task: ${i.task}

PROJECT CONTEXT (relevant sections)
${renderSections(i.sections)}

ALL FILES IN THE WORKSPACE
${i.fileIndex.join('\n')}
${i.memory?.length ? `\nPAST NOTES ABOUT THIS (learn from them; rejected suggestions were rejected for a reason)\n${i.memory.map((m) => `- [${m.type}] ${m.title}: ${m.text}`).join('\n')}` : ''}`;

// Small validators: throw on the wrong shape so callClaudeJSON retries once.
const str = (v, name) => { if (typeof v !== 'string') throw new Error(`${name} must be a string`); return v; };
const arr = (v, name) => { if (!Array.isArray(v)) throw new Error(`${name} must be an array`); return v; };

async function ask(prompt, validate, maxTokens = 4000, model = undefined) {
  return callClaudeJSON({ system: SYSTEM, prompt, maxTokens, timeoutMs: 55000, ...(model ? { model } : {}) }, validate);
}

/** Non-critical calls fall back to the simulated agent instead of blocking a human decision. */
async function orMock(label, live, fallback, onFallback) {
  try {
    return await live();
  } catch (err) {
    console.warn(`[live agent] ${label} failed, using simulated fallback:`, err.message);
    await onFallback?.(label, err);
    return fallback();
  }
}

export function makeLiveAgent({ onFallback } = {}) {
  return {
    mode: 'live',

    async checkConflicts(input) {
      const r = await ask(`${base(input)}

Before doing anything: does this task conflict with the context, or rely on information the context says is outdated?
Only report real conflicts (the task would contradict a section), not sections that merely relate.
Schema: { "conflicts": [ { "sectionId": string, "kind": "conflict" | "outdated", "explanation": string } ] }  (empty list if none)`,
      (o) => ({ conflicts: arr(o.conflicts, 'conflicts') }));
      return r.conflicts.flatMap((c) => {
        const s = input.sections.find((x) => x.id === c.sectionId);
        return s ? [{ sectionId: s.id, sectionTitle: s.title, scope: s.scope, kind: c.kind === 'outdated' ? 'outdated' : 'conflict', explanation: String(c.explanation) }] : [];
      });
    },

    async plan(input) {
      return ask(`${base(input)}

CURRENT FILES IN THE DEPARTMENT'S AREA
${renderFiles(input.files)}

Write a short plan for the developer to confirm.
Schema: { "understanding": string (1-2 sentences), "steps": string[] (2-5), "files": string[] (repo-relative paths you will create or change) }`,
      (o) => ({ understanding: str(o.understanding, 'understanding'), steps: arr(o.steps, 'steps').map(String), files: arr(o.files, 'files').map(String) }));
    },

    async edit(input) {
      return ask(`${base(input)}

CONFIRMED PLAN
${input.plan.understanding}
${input.plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Files: ${input.plan.files.join(', ')}
${input.followUp ? `\nFOLLOW-UP REQUEST FROM THE DEVELOPER (apply on top of the current files): ${input.followUp}\nPrevious summary: ${input.previousSummary ?? ''}` : ''}

CURRENT FILE CONTENTS
${renderFiles(input.files)}

Make the change. Return the COMPLETE new content of every file you create or change (not a diff).
Schema: { "edits": [ { "path": string, "content": string } ], "summary": string (1-3 plain sentences for a non-expert), "why": string (short reason for the reviewer, citing context sections) }`,
      (o) => ({
        edits: arr(o.edits, 'edits').map((e) => ({ path: str(e.path, 'path'), content: str(e.content, 'content') })),
        summary: str(o.summary, 'summary'), why: str(o.why, 'why'),
      }), 16000);
    },

    async proposeContextUpdate(input) {
      return orMock('proposeContextUpdate', async () => {
        const r = await ask(`A ${input.department.name} change was just approved and merged.
Title: ${input.title}
Summary: ${input.summary}
Why: ${input.why}
Diff:
${input.diff.slice(0, 20000)}

${input.department.name.toUpperCase()} CONTEXT
${renderSections(input.departmentSections)}

CENTRAL CONTEXT (read only here)
${renderSections(input.centralSections)}

Propose updates to the ${input.department.name} context so it stays true. Only change this department's sections (by id), keep unchanged facts, return full new content.
"obsoleteTerms": single lowercase words for things NO LONGER true anywhere after this change (e.g. "card" if cards are no longer accepted); empty if it only adds something.
Schema: { "summary": string, "obsoleteTerms": string[], "changes": [ { "sectionId": string, "newContent": string, "why": string } ] }`,
        (o) => ({ summary: str(o.summary, 'summary'), obsoleteTerms: arr(o.obsoleteTerms, 'obsoleteTerms').map(String), changes: arr(o.changes, 'changes') }));
        const ids = new Set(input.departmentSections.map((s) => s.id));
        return { ...r, changes: r.changes.filter((c) => ids.has(c.sectionId)) };
      }, () => mockAgent.proposeContextUpdate(input), onFallback);
    },

    async rewriteAffected(input) {
      return orMock('rewriteAffected', async () => {
        const r = await ask(`This change was approved: ${input.changeSummary}
These words are no longer valid: ${input.obsoleteTerms.join(', ')}

Rewrite each section so it is true again after the change; keep everything else unchanged.
Schema: { "updates": [ { "sectionId": string, "newContent": string, "why": string } ] }

${renderSections(input.sections)}`,
        (o) => ({ updates: arr(o.updates, 'updates') }));
        const ids = new Set(input.sections.map((s) => s.id));
        return r.updates.filter((u) => ids.has(u.sectionId));
      }, () => mockAgent.rewriteAffected(input), onFallback);
    },

    /**
     * Reviewer: does this change contradict the plan? Advises only (flags);
     * runs on the smaller model. If it errors, the router sends the change to a person.
     */
    async review({ change, scope, planItems, recent }) {
      const r = await ask(`You review a change to the ${scope} context before it is applied without a person looking.
CHANGE: ${change.title}: ${change.content}
RECENT CHANGES BY THE SAME AGENT (look at them together): ${recent.map((x) => x.title).join('; ') || 'none'}

PLAN (central and department)
${renderSections(planItems)}

Flag ONLY real contradictions with a plan item (a rule it breaks, a decision it goes against). Say if you are not sure.
Schema: { "flags": [ { "itemId": string, "explanation": string } ], "confident": boolean }`,
      (o) => ({ flags: arr(o.flags, 'flags'), confident: o.confident !== false }), 1500, ROUTINE_MODEL);
      const ids = new Set(planItems.map((s) => s.id));
      return { flags: r.flags.filter((f) => ids.has(f.itemId)).map((f) => ({ itemId: f.itemId, explanation: String(f.explanation) })), confident: r.confident };
    },

    /** Orchestrator: break a goal into draft tasks per department. */
    async orchestrate({ goal, centralPlan, departments }) {
      const r = await ask(`Goal from the founder or a manager: ${goal}

CENTRAL PLAN
${renderSections(centralPlan)}

DEPARTMENTS
${departments.map((d) => `- ${d.id} (${d.name}), works in ${d.paths.join(', ') || 'the whole project'}\n${renderSections(d.plan)}`).join('\n')}

Break the goal into the smallest set of tasks, at most one or two per department, only for departments that are needed.
Each task must stay inside its department's area. Link the plan items it serves.
Schema: { "tasks": [ { "department": string, "title": string, "description": string, "planItemIds": string[] } ] }`,
      (o) => ({ tasks: arr(o.tasks, 'tasks') }));
      const ids = new Set(departments.map((d) => d.id));
      return { tasks: r.tasks.filter((t) => ids.has(t.department)).map((t) => ({ department: t.department, title: str(t.title, 'title'), description: String(t.description ?? ''), planItemIds: (t.planItemIds ?? []).map(String) })) };
    },

    async adjustTask(input) {
      return orMock('adjustTask', async () => (await ask(`The developer's task was: "${input.task}"
The project context just changed: ${input.changeSummary}
No longer valid: ${input.obsoleteTerms.join(', ') || '(nothing specific)'}

Rewrite the task in one sentence so it fits the new context, keeping the developer's intent.
Schema: { "task": string }`, (o) => ({ task: str(o.task, 'task') }))).task, () => mockAgent.adjustTask(input), onFallback);
    },

    async whatIKnow(input) {
      return orMock('whatIKnow', async () => (await ask(`You are ${input.user.name}'s agent and were just restarted with no memory. Rebuild your understanding ONLY from the context and log below.
Return 3 to 5 headed groups of short bullets: the project, ${input.department.name} decisions you follow, recent changes that matter (with versions), and ${input.user.name}'s current work and what happens next.
Schema: { "points": [ { "heading": string, "items": string[] } ] }

CENTRAL CONTEXT
${renderSections(input.central)}

${input.department.name.toUpperCase()} CONTEXT
${renderSections(input.departmentSections)}

RECENT LOG (newest first)
${input.recentLog.slice(0, 40).map((e) => `${e.at} ${e.type}: ${e.summary}`).join('\n')}

CURRENT TASK
${input.task ? JSON.stringify({ text: input.task.text, status: input.task.status, plan: input.task.plan, changedFiles: input.task.changedFiles, summary: input.task.summary }) : 'none'}`,
      (o) => ({ points: arr(o.points, 'points') }))).points, () => mockAgent.whatIKnow(input), onFallback);
    },
  };
}
