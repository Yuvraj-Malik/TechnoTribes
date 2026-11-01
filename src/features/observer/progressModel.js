// Wording and layout for the observer's progress views: the headline, the brick
// wall, the project line and the product map. No React here, so tests/unit can
// check these rules directly.

/** The answer first: how many pieces are live, then what is left. */
export function headline({ done = 0, now = 0, upcoming = 0 } = {}) {
  const total = done + now + upcoming;
  if (!total) return null;
  const left = [
    now && `${now}${done ? ' more' : ''} ${now === 1 ? 'is' : 'are'} being finished`,
    upcoming && `${upcoming} ${upcoming === 1 ? 'has' : 'have'} not started`,
  ].filter(Boolean);
  return {
    lead: `${done} of ${total}`,
    rest: `${total === 1 ? 'piece' : 'pieces'} ${done === 1 ? 'is' : 'are'} live.`,
    detail: [
      done === total ? 'Everything planned so far is live.' : done ? `That is ${Math.round((done / total) * 100)}% of the work planned so far.` : null,
      left.length ? `${left.join(' and ')}.`.replace(/^./, (c) => c.toUpperCase()) : null,
    ].filter(Boolean).join(' '),
  };
}

const NAMED_BRICKS = 15; // past this, bricks shrink and lose their names
const NARROW = 420;
export const BRICK_GAP = 4;

/** How the wall fits its space. Width 0 means it has not been measured yet. */
export function wallLayout(count, width) {
  const named = count <= NAMED_BRICKS;
  const narrow = width > 0 && width < NARROW;
  return { named, perRow: named ? (narrow ? 2 : 3) : (narrow ? 5 : 7) };
}

/** Rows drawn top first, so the first pieces of work sit at the bottom and the wall rises. */
export function wallRows(work = [], perRow = 3) {
  const rows = [];
  for (let i = 0; i < work.length; i += perRow) rows.push({ key: i, offset: rows.length % 2 === 1, bricks: work.slice(i, i + perRow) });
  return rows.reverse();
}

/** The brick size and the half-brick shift that give a wall its staggered joints. */
export function brickSize(perRow) {
  const gaps = (perRow - 0.5) * BRICK_GAP;
  return {
    width: `calc((100% - ${gaps}px) / ${perRow + 0.5})`,
    shift: `calc((100% - ${gaps}px) / ${2 * perRow + 1} + ${BRICK_GAP / 2}px)`,
  };
}

/** Breaks a title into at most two short lines for the project line. */
export function wrapTitle(text, max = 18) {
  const lines = [];
  for (const word of String(text).split(/\s+/)) {
    const joined = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (lines.length && joined.length <= max) lines[lines.length - 1] = joined;
    else if (lines.length < 2) lines.push(word);
    else { lines[1] = `${lines[1].slice(0, max - 1).trimEnd()}…`; break; }
  }
  return lines;
}

const LINE_WIDTH = 1128;
const SHOWN_VERSIONS = 3;
const SHOWN_TRACKS = 5;
const START_X = 70;
const VERSION_GAP = 165;
const FIRST_LANE = 90;
const LANE_GAP = 100;
const TIP_X = [600, 693, 787, 880]; // further along the track as the work moves on
const PLANNED_X = 760;
const OVERLAP_X = 826;
const JOIN_X = 1076;
const MERGE_FROM = 1000;

/** Places the versions, side tracks and planned work. Expects the server's order. */
export function layoutProjectLine({ versions = [], tracks = [], planned = [], overlaps = [] } = {}) {
  const shown = versions.slice(-SHOWN_VERSIONS);
  const lanes = tracks.slice(0, SHOWN_TRACKS);
  const mainY = lanes.length ? FIRST_LANE + LANE_GAP * (lanes.length - 1) + 110 : 36;
  const originX = START_X + VERSION_GAP * Math.max(shown.length - 1, 0);
  const trackStart = originX + 120;

  const placed = lanes.map((track, i) => {
    const y = FIRST_LANE + LANE_GAP * i;
    const tip = Math.max(TIP_X[track.step] ?? TIP_X[0], trackStart + 40);
    return {
      ...track, y, tip, labelX: trackStart + 10,
      built: `M${originX} ${mainY} C${originX + 60} ${mainY} ${originX + 40} ${y} ${trackStart} ${y} H${tip}`,
      ahead: `M${tip} ${y} H${MERGE_FROM} C${MERGE_FROM + 60} ${y} ${JOIN_X - 60} ${mainY} ${JOIN_X} ${mainY}`,
    };
  });

  const clash = overlaps
    .map((o) => o.pieces.map((id) => placed.findIndex((t) => t.id === id)).sort((a, b) => a - b))
    .find(([a]) => a >= 0);
  const hasWorkAhead = placed.length > 0 || planned.length > 0;

  return {
    width: LINE_WIDTH,
    height: mainY + 110,
    mainY, originX, joinX: JOIN_X,
    stops: shown.map((v, i) => ({ ...v, x: START_X + VERSION_GAP * i, lines: wrapTitle(v.title) })),
    earlier: versions.length - shown.length,
    tracks: placed,
    hiddenTracks: tracks.length - lanes.length,
    planned: planned.length ? { ...planned[0], x: PLANNED_X, lines: wrapTitle(planned[0].title), more: planned.length - 1 } : null,
    overlap: clash ? { x: OVERLAP_X, top: placed[clash[0]].y, bottom: placed[clash[1]].y, mark: placed[clash[0]].y + 50, part: overlaps.find((o) => o.pieces.includes(placed[clash[0]].id)).part } : null,
    showNext: hasWorkAhead,
  };
}

const listNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Who is changing a part, as a short sentence. */
export const changingWords = (people) => (people.length ? `${listNames(people)} ${people.length === 1 ? 'is' : 'are'} changing it` : 'Nobody is changing it');

/** One plain sentence about a part of the product and what relies on it. */
export function describePart(part, map) {
  const name = (id) => map.parts.find((p) => p.id === id)?.name;
  const who = `${changingWords(part.people)} now.`;
  if (part.isNew) return `The ${part.name} is new and not live yet. ${who}`;
  if (part.kind === 'page') {
    const uses = map.links.filter((l) => l.from === part.id).map((l) => name(l.to));
    return `${uses.length ? `The ${part.name} relies on ${uses.join(', ')}.` : `The ${part.name} stands on its own.`} ${who}`;
  }
  const users = map.links.filter((l) => l.to === part.id).map((l) => `the ${name(l.from)}`);
  return `A change to ${part.name} also shows up on ${listNames(users)}. ${who}`;
}

/** The part to show first: the shared one most people are changing. */
export function busiestPart(map) {
  const score = (p) => p.people.length * 2 + (p.kind === 'shared' ? 1 : 0);
  return [...map.parts].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Where a map line starts and ends, as a share of the row's width. */
export const columnCentre = (index, columns) => (index + 0.5) / columns;
