import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const outDir = 'C:/Users/Joey/agent-memory/scratchpad/live-url-blacklist-tests';
fs.mkdirSync(outDir, { recursive: true });
const bundle = path.join(outDir, 'core.cjs');
await esbuild.build({
  entryPoints: [path.join(root, 'src/core/live-url-blacklist.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: bundle,
  logLevel: 'silent',
});
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const core = require(bundle);

const hostPattern = (host) => `^https?://(?:[^/?#]*@)?${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?::\\d+)?(?:[/?#]|$)`;
const fixture = [
  { url: 'http://hls.cntv.myalicdn.com/x.m3u8', source: 'LiSha521.TV', name: 'CCTV1', group: '待确认' },
  { url: 'https://live.ynurl.com/a.m3u8?t=1', source: 'YanG', name: '云南卫视', group: '境内地方' },
  { url: 'http://other.example.com/ok.m3u8', source: 'GoodSource', name: '测试频道', group: '其他' },
  { url: 'http://hls.cntv.myalicdn.com/blocked.m3u8', source: 'DeadSource', name: '广告频道', group: '测试组' },
];

const validated = core.validateLiveUrlBlacklist([
  { pattern: hostPattern('hls.cntv.myalicdn.com'), field: 'url', note: 'offline CDN', enabled: true },
  { pattern: '^DeadSource$', field: 'source', enabled: true },
  { pattern: '^广告', field: 'name', enabled: true },
  { pattern: '^测试组$', field: 'group', enabled: true },
]);
assert.equal(validated.ok, true);
const matchers = core.compileLiveUrlBlacklist(validated.ruleSet);
assert.equal(matchers.length, 4);
const kept = core.filterLiveUrlBlacklist(fixture, matchers);
assert.deepEqual(kept.map((x) => x.name), ['云南卫视', '测试频道']);
assert.equal(core.matchLiveUrlBlacklist(fixture[0], matchers)?.rule.field, 'url');
assert.equal(core.matchLiveUrlBlacklist(fixture[3], matchers)?.rule.field, 'url');

const disabled = core.validateLiveUrlBlacklist([{ pattern: '^DeadSource$', field: 'source', enabled: false }]);
assert.equal(disabled.ok, true);
assert.equal(core.compileLiveUrlBlacklist(disabled.ruleSet).length, 0);
assert.equal(core.filterLiveUrlBlacklist(fixture, core.compileLiveUrlBlacklist(disabled.ruleSet)).length, 4);

assert.equal(core.validateLiveUrlBlacklist([{ pattern: '(', field: 'url' }]).ok, false);
assert.equal(core.validateLiveUrlBlacklist([{ pattern: 'x', field: 'bogus' }]).ok, false);

const added = core.addLiveUrlBlacklistRule({ version: 1, rules: [] }, { pattern: hostPattern('live.ynurl.com'), field: 'url' });
assert.equal(added.ok, true);
assert.equal(added.ruleSet.rules.length, 1);
assert.equal(added.rule.pattern, hostPattern('live.ynurl.com'));
const updated = core.updateLiveUrlBlacklistRule(added.ruleSet, added.rule.id, { enabled: false, note: 'disabled' });
assert.equal(updated.ok, true);
assert.equal(updated.ruleSet.rules[0].enabled, false);
assert.equal(updated.ruleSet.rules[0].note, 'disabled');

const hostList = [
  'hls.cntv.myalicdn.com', 'live.ynurl.com', 'lives.jnnews.tv', 'cm.wshls.homecdn.com',
  'hls.cntv.myhwcdn.cn', 'stream.zztvzd.com', 'live.nbs.cn', 'livebroadcast.ccwb.cn',
  '15536746789.x3322.net', 'dtrmlive.qhdtrm.cn', 'pili-publish.yzxw.newaircloud.com',
];
const bulk = core.validateLiveUrlBlacklist(hostList.map((host) => ({ pattern: hostPattern(host), field: 'url' })));
assert.equal(bulk.ok, true);
assert.equal(bulk.ruleSet.rules.length, hostList.length);
const bulkMatchers = core.compileLiveUrlBlacklist(bulk.ruleSet);
for (const host of hostList) {
  assert.ok(core.matchLiveUrlBlacklist({ url: `http://${host}/x.m3u8` }, bulkMatchers), host);
}
assert.equal(core.matchLiveUrlBlacklist({ url: 'http://not-' + hostList[0] + '/x.m3u8' }, bulkMatchers), null);

console.log(JSON.stringify({ ok: true, cases: 7, hostPatterns: hostList.length, bundleBytes: fs.statSync(bundle).size }));
