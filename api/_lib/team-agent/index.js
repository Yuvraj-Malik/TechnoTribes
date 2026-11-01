// Picks the team agent: live Claude when ANTHROPIC_API_KEY is set, otherwise
// the simulated (scripted) agent. Both have the same methods:
// checkConflicts, plan, edit, proposeContextUpdate, rewriteAffected, adjustTask, whatIKnow.
import { CLAUDE_MODEL } from '../claude.js';
import { mockAgent } from './mock.js';
import { makeLiveAgent } from './live.js';
import { logEvent } from '../activity.js';

export const agentMode = () => (process.env.ANTHROPIC_API_KEY && process.env.AGENT_MODE !== 'mock' ? 'live' : 'mock');

export function agentInfo() {
  const mode = agentMode();
  return { agentMode: mode, agentModel: mode === 'live' ? CLAUDE_MODEL : null };
}

export function getTeamAgent(projectId) {
  if (agentMode() === 'mock') return mockAgent;
  return makeLiveAgent({
    onFallback: (label, err) => logEvent(projectId, {
      type: 'agent.fallback_to_simulated',
      summary: `Live agent failed on ${label} (${err.message}); the SIMULATED agent's answer was used instead`,
      data: { label, error: err.message },
    }),
  });
}
