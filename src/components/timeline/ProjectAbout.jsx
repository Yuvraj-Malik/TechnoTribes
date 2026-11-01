// What the project is and how far it has come, in the team's own words: the brief,
// milestones, progress notes, the rules everyone follows, and the project's documents.
import { timeAgo } from '../../utils/time';
import Icon from '../common/Icon';
import { cx } from '../common/ui';
import { focusRing } from '../common/styles';

const BLOCK = {
  heading: 'mt-3 font-semibold text-ink',
  text: 'mt-2',
  item: 'mt-1 pl-4 -indent-3',
};

function Rule({ rule }) {
  const when = [`Version ${rule.version}`, rule.who, rule.when && timeAgo(rule.when)].filter(Boolean).join(' · ');
  return (
    <li className="min-w-0 rounded-xl border border-line bg-bg/40 p-3.5">
      {rule.label && <p className="m-0 text-[11px] font-bold tracking-wide text-dim uppercase">{rule.label}</p>}
      <p className="m-0 font-semibold text-ink">{rule.title}</p>
      <p className="m-0 text-xs text-dim">{when}</p>
      <p className="m-0 mt-1.5 line-clamp-4 text-sm text-ink" title={rule.text}>{rule.text}</p>
      {rule.why && <p className="m-0 mt-1.5 text-[13px] text-dim">Why it changed: {rule.why}</p>}
    </li>
  );
}

function Doc({ doc }) {
  return (
    <details className="rounded-lg border border-line bg-bg/40 px-3.5 py-2.5">
      <summary className={cx('min-h-6 cursor-pointer font-semibold text-ink', focusRing)}>{doc.title}</summary>
      <div className="text-sm text-dim">
        {doc.blocks.map((block, i) => <p key={i} className={cx('m-0', BLOCK[block.kind])}>{block.kind === 'item' ? `• ${block.text}` : block.text}</p>)}
      </div>
    </details>
  );
}

export default function ProjectAbout({ about }) {
  const { brief, rules, teamRules, milestones, notes, docs } = about;
  return (
    <>
      {brief && <p className="m-0 max-w-[75ch] text-[15px] text-ink">{brief}</p>}
      {milestones.length > 0 && (
        <>
          <h3 className="m-0 mt-4 mb-2 text-sm font-semibold text-dim">Milestones confirmed by the founder</h3>
          <ol className="m-0 list-none space-y-2 p-0">
            {milestones.map((m) => (
              <li key={m.id} className="flex gap-2.5 rounded-lg bg-ok/8 px-3 py-2 text-sm">
                <Icon name="check" size={16} className="mt-0.5 text-ok" />
                <div className="min-w-0">
                  <p className="m-0 font-semibold text-ink">{m.title} <span className="text-xs font-normal text-dim">· {timeAgo(m.when)}</span></p>
                  <p className="m-0 text-dim">{m.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {notes.length > 0 && (
        <>
          <h3 className="m-0 mt-4 mb-2 text-sm font-semibold text-dim">Latest progress from the teams</h3>
          <ul className="m-0 list-none space-y-1 p-0 text-sm">
            {notes.map((n) => (
              <li key={n.id} className="text-ink">{n.title} <span className="text-xs text-dim">· {[n.team, n.who, timeAgo(n.when)].filter(Boolean).join(' · ')}</span></li>
            ))}
          </ul>
        </>
      )}
      {rules.length > 0 && (
        <>
          <h3 className="m-0 mt-4 mb-2 text-sm font-semibold text-dim">The rules everyone follows, including the AI agents</h3>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">{rules.map((rule) => <Rule key={rule.id} rule={rule} />)}</ul>
        </>
      )}
      {teamRules > 0 && <p className="m-0 mt-3 text-[13px] text-dim">Plus {teamRules} more detailed {teamRules === 1 ? 'rule' : 'rules'} kept within the team.</p>}
      {docs.length > 0 && (
        <>
          <h3 className="m-0 mt-4 mb-2 text-sm font-semibold text-dim">Project documents</h3>
          <div className="space-y-2">{docs.map((doc) => <Doc key={doc.id} doc={doc} />)}</div>
        </>
      )}
    </>
  );
}
