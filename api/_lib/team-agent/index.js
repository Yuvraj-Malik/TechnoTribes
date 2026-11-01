// Picks the team agent: live Claude when ANTHROPIC_API_KEY is set, otherwise
// the simulated (scripted) agent. Both have the same methods:
// checkConflicts, plan, edit, critique, proposeContextUpdate, rewriteAffected, adjustTask, whatIKnow.
import { chainFor, llmConfigured } from '../llm.js';
import { mockAgent } from './mock.js';
import { makeLiveAgent } from './live.js';
import { logEvent } from '../activity.js';
import { db, q } from '../supabase-admin.js';

export const agentMode = () => (llmConfigured() && process.env.AGENT_MODE !== 'mock' ? 'live' : 'mock');

export function agentInfo() {
  const mode = agentMode();
  const name = (role) => chainFor(role)[0]?.model ?? null;
  return { agentMode: mode, agentModel: mode === 'live' ? name('builder') : null, criticModel: mode === 'live' ? name('critic') : null };
}

export function getTeamAgent(projectId) {
  if (agentMode() === 'mock') return mockAgent;
  return makeLiveAgent({
    // The agent is told which project it works on (name and description).
    loadProject: () => q(db.from('projects').select('name,description').eq('id', projectId).single()),
    onFallback: (label, err) => logEvent(projectId, {
      type: 'agent.fallback_to_simulated',
      summary: `Live agent failed on ${label} (${err.message}); the SIMULATED agent's answer was used instead`,
      data: { label, error: err.message },
    }),
  });
}
