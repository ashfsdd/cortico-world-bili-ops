import test from 'node:test';
import assert from 'node:assert/strict';
import { BiliOpsWorld } from '../src/index.ts';

/** 只测纯逻辑（白名单、账号解析、配置默认值）——不真跑 bili，避免依赖本机环境。 */

test('拒绝不在白名单的子命令', async () => {
  const w = new BiliOpsWorld({ cfg: {} });
  const r = await w.run('rm', ['-rf', '/']);
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.match(r.out, /不允许/);
});

test('空命令也被拒绝', async () => {
  const w = new BiliOpsWorld({ cfg: {} });
  const r = await w.run('', []);
  assert.equal(r.ok, false);
  assert.match(r.out, /不允许/);
});

test('白名单内的命令能过校验（不实际执行）', async () => {
  // 故意给一个不存在的可执行文件，让它 spawn 失败 —— 校验阶段不该拦
  const w = new BiliOpsWorld({ cfg: { biliBin: '__no_such_bili__' } });
  // 用一个不存在的 biliBin，让它 spawn 失败，但校验阶段应该已经通过
  const r = await w.run('me', [], 'whale');
  // 校验通过 → 会尝试执行；执行失败也是 ok:false，但 out 不应是「不允许」
  assert.doesNotMatch(r.out, /不允许/);
});

test('未知账号被拒绝', async () => {
  const w = new BiliOpsWorld({ cfg: { profileRoot: 'C:/tmp/profiles' } });
  const r = await w.run('me', [], 'nonexistent');
  assert.equal(r.ok, false);
  assert.match(r.out, /未知账号/);
});

test('profileRoot 为空时只认三个内置账号', () => {
  const w = new BiliOpsWorld({ cfg: { profileRoot: '' } });
  assert.equal(w.profileOf('whale'), '');
  assert.equal(w.profileOf('main'), '');
  assert.equal(w.profileOf('live'), '');
  assert.equal(w.profileOf('xxx'), null);
});

test('profileRoot 有值时 main/live 拼出对应目录', () => {
  const w = new BiliOpsWorld({ cfg: { profileRoot: 'C:/tmp/profiles' } });
  assert.match(String(w.profileOf('main')), /main$/);
  assert.match(String(w.profileOf('live')), /live$/);
  assert.equal(w.profileOf('whale'), '');
});

test('默认配置合理', () => {
  const w = new BiliOpsWorld({ cfg: {} });
  assert.equal(w.cfg.account, 'whale');
  assert.equal(w.cfg.maxOutput, 6000);
  assert.equal(w.cfg.enabled, true);
});

test('配置可覆盖', () => {
  const w = new BiliOpsWorld({ cfg: { account: 'main', maxOutput: 2000 } });
  assert.equal(w.cfg.account, 'main');
  assert.equal(w.cfg.maxOutput, 2000);
});

test('envPromptVars 暴露账号与截断长度', () => {
  const w = new BiliOpsWorld({ cfg: { account: 'live', maxOutput: 3000 } });
  const v = w.envPromptVars();
  assert.equal(v['biliops.account'], 'live');
  assert.equal(v['biliops.maxOutput'], '3000');
});
