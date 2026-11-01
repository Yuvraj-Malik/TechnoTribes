// What the project is, in the team's own words: the brief, the rules everyone
// and every AI agent follows, and the project's documents.
import { timeAgo } from '../../utils/time';
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
  const { brief, rules, teamRules, docs } = about;
  return (
    <>
      {brief && <p className="m-0 max-w-[75ch] text-[15px] text-ink">{brief}</p>}
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
