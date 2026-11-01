// Claude API client used by the Builder, Critic and Moderator agents.
import { HttpError } from './errors.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
// Smaller model for routine checks (the reviewer); the main model does planning and code.
export const ROUTINE_MODEL = process.env.CLAUDE_ROUTINE_MODEL || 'claude-haiku-5-5';

export async function callClaude({ system, prompt, maxTokens = 4000, timeoutMs = 60000, model = CLAUDE_MODEL }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, 'ANTHROPIC_API_KEY is not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, `Claude API error: ${data?.error?.message || res.status}`);
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  } catch (err) {
    if (err.name === 'AbortError') throw new HttpError(504, 'The agent took too long to respond');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in the reply');
  return JSON.parse(text.slice(start, end + 1));
}

// Ask for JSON, validate it, and retry once with the error if it is unusable.
export async function callClaudeJSON(opts, validate, retries = 1) {
  let prompt = opts.prompt;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const text = await callClaude({ ...opts, prompt });
    try {
      const obj = extractJson(text);
      return validate ? validate(obj) : obj;
    } catch (err) {
      lastErr = err;
      prompt = `${opts.prompt}\n\nYour previous reply could not be used (${err.message}). `
        + 'Reply again with ONLY one valid JSON object that matches the schema.';
    }
  }
  throw new HttpError(502, `The agent returned unusable output: ${lastErr.message}`);
}
