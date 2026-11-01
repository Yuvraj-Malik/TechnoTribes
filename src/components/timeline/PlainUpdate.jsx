// The last day in plain sentences: what finished, what is happening, what comes next.
import { cx } from '../common/ui';

const COLUMNS = [
  { key: 'finished', title: 'Just finished', mark: 'bg-ok', empty: 'Nothing has gone live yet.' },
  { key: 'now', title: 'Happening now', mark: 'bg-mark', empty: 'Nothing is being worked on this minute.' },
  { key: 'next', title: 'Coming next', mark: 'border-[1.5px] border-dashed border-dim', empty: 'Nothing else is planned yet.' },
];

export default function PlainUpdate({ update, forInvestor }) {
  const showNotes = update.notes.length > 0 || forInvestor;
  return (
    <>
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-3">
        {COLUMNS.map(({ key, title, mark, empty }) => (
          <section key={key} aria-label={title} className="min-w-0">
            <h3 className="m-0 flex items-center gap-2 text-[13px] font-semibold text-dim">
              <span className={cx('size-2.5 rounded-full', mark)} aria-hidden="true" />
              {title}
            </h3>
            {update[key].length ? (
              <ul className="m-0 mt-1.5 list-none space-y-2 p-0 text-[15px] text-ink">
                {update[key].map((item) => (
                  <li key={item.id}><span className="font-semibold">{item.title}.</span> {item.words}</li>
                ))}
              </ul>
            ) : <p className="m-0 mt-1.5 text-[15px] text-dim">{empty}</p>}
          </section>
        ))}
      </div>
      {showNotes && (
        <p className="m-0 mt-4 flex items-start gap-2.5 border-t border-line pt-3.5 text-sm text-dim">
          <i className="mt-1.5 ml-0.5 size-2.5 shrink-0 rotate-45 rounded-[2px] bg-mark" aria-hidden="true" />
          <span>{update.notes.length > 0 && `${update.notes.join(' ')} `}{forInvestor && <b className="font-semibold text-ink">Nothing is needed from you.</b>}</span>
        </p>
      )}
    </>
  );
}
