// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, humanizeKey } from '../../api/_lib/paths.js';
import { threeWay, diffMaps } from '../../api/_lib/files.js';
import { routes } from '../../api/index.js';

test('paths are normalized and unsafe paths are rejected', () => {
  assert.equal(normalizePath('./src\\pages/Home.jsx'), 'src/pages/Home.jsx');
  assert.throws(() => normalizePath('../secrets.txt'));
  assert.throws(() => normalizePath('src//x.js'));
  assert.match(humanizeKey('file:src/pages/PricingPage.jsx'), /Pricing Page/);
  assert.match(humanizeKey('req:target_audience'), /target audience/);
});

test('three-way merge keeps both sides when they touch different files', () => {
  const base = { 'a.js': '1', 'b.js': '1' };
  const r = threeWay(base, { 'a.js': '2', 'b.js': '1' }, { 'a.js': '1', 'b.js': '3' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.files, { 'a.js': '2', 'b.js': '3' });
  const c = threeWay(base, { 'a.js': '2', 'b.js': '1' }, { 'a.js': '9', 'b.js': '1' });
  assert.deepEqual(c.conflicted, ['a.js']);
  assert.ok(diffMaps(base, { 'a.js': '2', 'b.js': '1' }));
});

test('every route points to a real handler', () => {
  for (const [key, fn] of Object.entries(routes)) assert.equal(typeof fn, 'function', key);
  for (const r of ['GET team/overview', 'POST team/context/save', 'POST tasks/delete', 'POST projects/update', 'POST team/members/role']) assert.ok(routes[r], r);
});

test('router finds the endpoint however Vercel or Vite passes the request', async () => {
  const { routeOf } = await import('../../api/index.js');
  assert.equal(routeOf({ url: '/api/team/task/start', query: {} }), 'team/task/start');
  assert.equal(routeOf({ url: '/api/index?route=auth/me', query: { route: 'auth/me' } }), 'auth/me');
  assert.equal(routeOf({ url: '/api/index', query: { route: ['team', 'review', 'queue'] } }), 'team/review/queue');
  assert.equal(routeOf({ url: '/auth/me', query: { route: 'auth/me' } }), 'auth/me');
  assert.equal(routeOf({ url: '/api/projects/discover?search=x', query: { route: 'projects', search: 'x' } }), 'projects/discover');
});
