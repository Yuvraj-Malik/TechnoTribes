// The Critic agent's review of the Builder's change. Shown to the developer
// (workspace) and to the manager (review).
import { Badge, Card, cx } from '../common/ui';

const VERDICT = {
  looks_good: { label: 'Looks good', tone: 'green', card: 'green' },
  minor_issues: { label: 'Minor issues', tone: 'amber', card: 'amber' },
  needs_changes: { label: 'Needs changes', tone: 'red', card: 'red' },
};
const SEV = { high: 'red', medium: 'amber', low: 'slate' };

export default function CriticCard({ critique, compact = false }) {
  if (!critique) return null;
  const v = VERDICT[critique.verdict] ?? VERDICT.minor_issues;
  // Older reviews only have `issues` ({ severity, note }).
  const findings = critique.findings ?? (critique.issues ?? []).map((i) => ({ severity: i.severity, file: null, issue: i.note, suggestion: '' }));
  return (
    <Card tone={v.card} className="!p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">Critic agent's review</span>
        <span className="flex items-center gap-1.5">
          <Badge tone={v.tone}>{v.label}</Badge>
          <Badge title={critique.mode === 'live' ? 'Claude reviewed the diff, plus the automatic checks' : 'Automatic checks only (no Claude review)'}>
            {critique.mode === 'live' ? `AI review${critique.model ? ` · ${critique.model.split(':').pop()}` : ''}` : 'Rule checks'}
          </Badge>
        </span>
      </div>
      <p className="m-0 text-sm text-ink">{critique.summary}</p>
      {findings.length > 0 && (
        <ul className={cx('m-0 mt-2 list-none space-y-1.5 p-0', compact && 'max-h-60 overflow-y-auto')}>
          {findings.map((f, i) => (
            <li key={i} className="rounded-lg bg-surface/80 p-2 text-sm ring-1 ring-line">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={SEV[f.severity]}>{f.severity}</Badge>
                {f.file && <span className="font-mono text-[11px] text-dim">{f.file}</span>}
              </div>
              <p className="m-0 mt-1 text-ink">{f.issue}</p>
              {f.suggestion && <p className="m-0 mt-0.5 text-xs text-dim">→ {f.suggestion}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
