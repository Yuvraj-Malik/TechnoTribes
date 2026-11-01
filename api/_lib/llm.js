// One way to call any model. Each agent role has a model, written "provider:model":
//   BUILDER_MODEL=groq:llama-3.3-70b-versatile
//   CRITIC_MODEL=groq:llama-3.1-8b-instant
//   FALLBACK_MODEL=gemini:gemini-2.5-flash
// Providers: groq, gemini, openrouter (all OpenAI-compatible) and anthropic.
// If a model is rate limited, too slow or down, the next one in the chain answers.
// The chain for a role is: its own model, then FALLBACK_MODEL.
import { HttpError } from './errors.js';

const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: 'GEMINI_API_KEY' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: 'OPENROUTER_API_KEY' },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', key: 'ANTHROPIC_API_KEY' },
};

export function parseSpec(spec) {
  if (!spec) return null;
  const i = spec.indexOf(':');
  if (i < 0) return null;
  const provider = spec.slice(0, i).trim().toLowerCase();
  const model = spec.slice(i + 1).trim();
  if (!PROVIDERS[provider] || !model) return null;
  return { provider, model, spec: `${provider}:${model}` };
}

const hasKey = (s) => !!(s && process.env[PROVIDERS[s.provider].key]);

const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

// Models the provider said do not exist or are not allowed for this key: skipped for a while.
const unavailable = new Map();
const UNAVAILABLE_MS = 30 * 60000;
const isUnavailable = (s) => (unavailable.get(s.spec) ?? 0) > Date.now();

/**
 * The models a role will try, in order (only those whose API key is set).
 * Each setting may list several models, comma separated:
 *   BUILDER_MODEL=groq:openai/gpt-oss-120b,groq:llama-3.3-70b-versatile
 */
export function chainFor(role, { includeUnavailable = false } = {}) {
  const own = role === 'critic' ? process.env.CRITIC_MODEL || process.env.BUILDER_MODEL : process.env.BUILDER_MODEL;
  // Older setups: only ANTHROPIC_API_KEY + CLAUDE_MODEL.
  const legacy = process.env.ANTHROPIC_API_KEY ? `anthropic:${process.env.CLAUDE_MODEL || 'claude-sonnet-5-5'}` : null;
  const specs = [...list(own || legacy), ...list(process.env.FALLBACK_MODEL)].map(parseSpec).filter(hasKey);
  const unique = specs.filter((s, i) => specs.findIndex((x) => x.spec === s.spec) === i);
  if (includeUnavailable) return unique;
  const ok = unique.filter((s) => !isUnavailable(s));
  return ok.length ? ok : unique;
}

export const llmConfigured = () => chainFor('builder').length > 0;

class RetryNext extends Error {}
class ModelUnavailable extends RetryNext {}

async function post(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.[0]?.error?.message || `HTTP ${res.status}`;
      // Rate limits, too-large requests, overload and server errors: try the next model.
      if ([408, 413, 429, 500, 502, 503, 504, 529].includes(res.status)) throw new RetryNext(`${res.status} ${msg}`);
      // Wrong or retired model name, or a model this key may not use: remember it and move on.
      if ([400, 403, 404].includes(res.status) && /model|not exist|not found|no longer available|access|permission/i.test(msg)) {
        throw new ModelUnavailable(`${res.status} ${msg}`);
      }
      throw new HttpError(502, `Model API error: ${msg}`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new RetryNext('timed out');
    if (err instanceof RetryNext || err instanceof HttpError) throw err;
    // Network failure: Node only says "fetch failed"; the real reason is in err.cause.
    const c = err.cause;
    throw new RetryNext(`network error: ${c?.code ?? ''} ${c?.message ?? err.message}`.trim());
  } finally {
    clearTimeout(timer);
  }
}

async function callOne(s, { system, prompt, maxTokens, timeoutMs, json }) {
  const key = process.env[PROVIDERS[s.provider].key];
  if (s.provider === 'anthropic') {
    const data = await post(PROVIDERS.anthropic.url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model: s.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }, timeoutMs);
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }
  const data = await post(PROVIDERS[s.provider].url, { authorization: `Bearer ${key}` }, {
    model: s.model, max_tokens: maxTokens, temperature: 0.2,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  }, timeoutMs);
  return data.choices?.[0]?.message?.content ?? '';
}

/** Calls one model with a tiny JSON prompt; used by `npm run agents:check`. */
export async function pingModel(spec) {
  const s = parseSpec(spec);
  if (!s) return { ok: false, error: 'Write it as provider:model, e.g. groq:llama-3.1-8b-instant' };
  if (!hasKey(s)) return { ok: false, error: `${PROVIDERS[s.provider].key} is not set` };
  const started = Date.now();
  try {
    const text = await callOne(s, { system: 'Reply with JSON only.', prompt: 'Return {"ok": true}.', maxTokens: 200, timeoutMs: 30000, json: true });
    extractJson(text);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function extractJson(text) {
  const t = String(text).replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in the reply');
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * Asks the role's model for JSON, validates it (one retry with the error on bad output),
 * and moves to the next model on rate limits or outages.
 * Returns { value, model } where model is the "provider:model" that answered.
 */
export async function callLLMJSON(role, opts, validate) {
  const chain = chainFor(role);
  if (!chain.length) throw new HttpError(500, 'No model is configured: set BUILDER_MODEL and its API key');
  const tried = [];
  for (const s of chain) {
    let prompt = opts.prompt;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await callOne(s, { maxTokens: 4000, timeoutMs: 55000, json: true, ...opts, prompt });
        try {
          const obj = extractJson(text);
          return { value: validate ? validate(obj) : obj, model: s.spec };
        } catch (err) {
          if (attempt === 1) throw new RetryNext(`unusable output: ${err.message}`);
          prompt = `${opts.prompt}\n\nYour previous reply could not be used (${err.message}). Reply again with ONLY one valid JSON object that matches the schema.`;
        }
      }
    } catch (err) {
      if (err instanceof ModelUnavailable) unavailable.set(s.spec, Date.now() + UNAVAILABLE_MS);
      if (!(err instanceof RetryNext) && !(err instanceof HttpError)) throw err;
      tried.push(`${s.spec}: ${err.message}`);
      console.warn(`[llm] ${role} via ${s.spec} failed (${err.message}); trying the next model`);
    }
  }
  throw new HttpError(502, `Every model failed (${tried.join(' | ')})`);
}
