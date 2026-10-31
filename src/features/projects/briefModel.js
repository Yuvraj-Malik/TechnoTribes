// Rules for reading and editing the project brief. Agents depend on each field
// as req:<key>, so the keys here are the ones the dependency graph uses.
export const BRIEF_FIELDS = [
  { key: 'goal', label: 'Goal', hint: 'What are we building, and why?' },
  { key: 'audience', label: 'Audience', hint: 'Who is it for?' },
  { key: 'must_have', label: 'Must have', hint: 'What has to be in the first version?' },
  { key: 'constraints', label: 'Constraints', hint: 'Stack, deadlines, things to avoid' },
  { key: 'tone', label: 'Tone', hint: 'How should it look and feel?' },
];

const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

export const fieldLabel = (key) => {
  const known = BRIEF_FIELDS.find((f) => f.key === key);
  if (known) return known.label;
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const fieldKey = (label) => String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// The standard fields in order, then anything else the brief already has.
export function briefRows(brief = {}) {
  const standard = BRIEF_FIELDS.map((f) => ({ ...f, value: brief[f.key] === undefined ? '' : asText(brief[f.key]) }));
  const extra = Object.keys(brief)
    .filter((key) => !BRIEF_FIELDS.some((f) => f.key === key))
    .map((key) => ({ key, label: fieldLabel(key), hint: '', value: asText(brief[key]) }));
  return [...standard, ...extra];
}

// Only what changed. A cleared field becomes null, which removes it from the brief.
export function briefPatch(current = {}, draft = {}) {
  const patch = {};
  for (const [key, raw] of Object.entries(draft)) {
    const value = String(raw).trim();
    const before = current[key] === undefined ? '' : asText(current[key]).trim();
    if (value !== before) patch[key] = value || null;
  }
  return patch;
}
