// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, humanizeKey } from '../../api/_lib/paths.js';
import { downstream, upstream, intersect } from '../../api/_lib/dependency-graph.js';
import { groupBySharedTargets, bucketLabel } from '../../api/_lib/reviews.js';
import { validateBuilderOutput } from '../../server/agents/builder.js';
import { routes } from '../../api/index.js';

const edges = [
  { from_key: 'file:src/pages/Pricing.jsx', to_key: 'file:src/components/Button.jsx' },
  { from_key: 'file:src/pages/Signup.jsx', to_key: 'file:src/components/Button.jsx' },
  { from_key: 'file:src/components/Button.jsx', to_key: 'req:tone' },
];

test('paths are normalized and unsafe paths are rejected', () => {
  assert.equal(normalizePath('./src\\pages/Home.jsx'), 'src/pages/Home.jsx');
  assert.throws(() => normalizePath('../secrets.txt'));
  assert.throws(() => normalizePath('src//x.js'));
  assert.match(humanizeKey('file:src/pages/PricingPage.jsx'), /Pricing Page/);
  assert.match(humanizeKey('req:target_audience'), /target audience/);
});

test('downstream finds everything that depends on a change', async () => {
  const hit = await downstream('p', ['req:tone'], edges);
  assert.deepEqual(hit.sort(), ['file:src/components/Button.jsx', 'file:src/pages/Pricing.jsx', 'file:src/pages/Signup.jsx']);
});

test('upstream finds everything a file relies on', async () => {
  const deps = await upstream('p', ['file:src/pages/Pricing.jsx'], edges);
  assert.deepEqual(deps.sort(), ['file:src/components/Button.jsx', 'req:tone']);
  assert.deepEqual(intersect(['a', 'b'], ['b', 'c', 'b']), ['b']);
});

test('reviews touching the same files land in one bucket', () => {
  const groups = groupBySharedTargets([
    { id: 1, targets: ['file:a'] },
    { id: 2, targets: ['file:b'] },
    { id: 3, targets: ['file:a', 'file:c'] },
    { id: 4, targets: ['file:c'] },
  ]);
  const ids = groups.map((g) => g.map((x) => x.id).sort()).sort();
  assert.deepEqual(ids, [[1, 3, 4], [2]]);
  assert.match(bucketLabel(groups.find((g) => g.length === 3)), /^3 changes to/);
});

test('builder output is validated and cleaned', () => {
  const ok = validateBuilderOutput({
    summary: 'Adds a free trial',
    changes: [{ path: './src/pages/Pricing.jsx', action: 'update', content: 'x' }],
    depends_on: ['src/components/Button.jsx', 'req:audience'],
  });
  assert.equal(ok.changes[0].path, 'src/pages/Pricing.jsx');
  assert.deepEqual(ok.dependsOn, ['file:src/components/Button.jsx', 'req:audience']);
  assert.throws(() => validateBuilderOutput({ summary: 'x', changes: [] }));
  assert.throws(() => validateBuilderOutput({ summary: 'x', changes: [{ path: 'a.js', action: 'update' }] }));
});

test('every route points to a real handler', () => {
  for (const [key, fn] of Object.entries(routes)) assert.equal(typeof fn, 'function', key);
});
