// 端到端校验发布候选状态机：localStorage 内存桩 + 真实 service 代码
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = { setTimeout };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};
globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));

const {
  listContracts,
  createReleaseCandidate,
  updateContractOpenApi,
  reviewChange,
  freezeCandidate,
  discardReleaseCandidate,
} = await import('./dist-test/contract-service.js');

// 1. 初始：种子里没有契约通过门禁（order 有 pending，pay 有 returned，user 通过）
let contracts = await listContracts();
const user = contracts.find((c) => c.id === 'contract-user');
assert.equal(user.candidates.length, 0);

// 2. 门禁未通过的契约不能创建候选（order 有 pending 变更）
const order = contracts.find((c) => c.id === 'contract-order');
await assert.rejects(
  () => createReleaseCandidate(order.id, '2.9.0', ''),
  /门禁未通过/,
);

// 3. user 契约门禁通过 → 创建候选
await createReleaseCandidate(user.id, '1.15.0', '新增 effectiveRoles 字段');
contracts = await listContracts();
let user2 = contracts.find((c) => c.id === 'contract-user');
assert.equal(user2.candidates.length, 1);
const rc = user2.candidates[0];
assert.equal(rc.status, 'ready');
assert.equal(rc.version, '1.15.0');
assert.equal(rc.changes.length, 1);
assert.equal(rc.changes[0].reviewState, 'accepted');
assert.match(rc.openapiChecksum, /^[0-9a-f]{8}$/);
assert.equal(rc.openapi, user.openapi);

// 4. 工作副本改接口定义 → 候选变 stale，冻结被拒
await updateContractOpenApi(user.id, user.openapi + '\n# drifted\n');
contracts = await listContracts();
user2 = contracts.find((c) => c.id === 'contract-user');
const { getCandidateDrift, getEffectiveCandidateStatus } = await import(
  './dist-test/contract.js'
);
assert.deepEqual(getCandidateDrift(user2.candidates[0], user2), ['openapi']);
assert.equal(getEffectiveCandidateStatus(user2.candidates[0], user2), 'stale');
await assert.rejects(
  () => freezeCandidate(user.id, rc.id),
  /已过期/,
);

// 5. 还原工作副本 → 候选重新有效（漂移消失），冻结成功
await updateContractOpenApi(user.id, user.openapi);
contracts = await listContracts();
user2 = contracts.find((c) => c.id === 'contract-user');
assert.equal(getEffectiveCandidateStatus(user2.candidates[0], user2), 'ready');
await freezeCandidate(user.id, rc.id);
contracts = await listContracts();
user2 = contracts.find((c) => c.id === 'contract-user');
assert.equal(user2.status, 'frozen');
assert.equal(user2.version, '1.15.0');
const ver = user2.versions[0];
assert.equal(ver.candidateId, rc.id);
assert.equal(ver.checksum, rc.openapiChecksum);
assert.equal(ver.notes, '新增 effectiveRoles 字段');
assert.equal(ver.changes.length, 1);
assert.equal(ver.changes[0].id, 'chg-user-1');
assert.equal(user2.candidates[0].status, 'frozen');
assert.equal(user2.candidates[0].frozenVersionId, ver.id);

// 6. 冻结后再改工作副本，历史版本与候选不变；且候选仍显示 frozen
await updateContractOpenApi(user.id, user.openapi + '\n# post-freeze\n');
contracts = await listContracts();
user2 = contracts.find((c) => c.id === 'contract-user');
assert.equal(getEffectiveCandidateStatus(user2.candidates[0], user2), 'frozen');
assert.equal(user2.versions[0].openapi, user.openapi);
assert.equal(user2.versions[0].changes[0].reviewState, 'accepted');

// 7. 评审结论变化同样使候选过期：order 先评审掉 pending（已有豁免）→ 候选 → 再改评审
contracts = await listContracts();
let order2 = contracts.find((c) => c.id === 'contract-order');
await reviewChange(order2.id, 'chg-order-2', 'exemption', '测试人', '豁免处理');
await createReleaseCandidate(order2.id, '2.9.0', '订单发布');
contracts = await listContracts();
order2 = contracts.find((c) => c.id === 'contract-order');
const rcOrder = order2.candidates[0];
assert.equal(getEffectiveCandidateStatus(rcOrder, order2), 'ready');
// 另一个人把已确认变更退回 → 候选过期
await reviewChange(order2.id, 'chg-order-1', 'returned', '另一评审人', '接口定义变了，重新评审');
contracts = await listContracts();
order2 = contracts.find((c) => c.id === 'contract-order');
const drift = getCandidateDrift(order2.candidates[0], order2);
assert.ok(drift.includes('changes'), `expected changes drift, got ${drift}`);
assert.equal(getEffectiveCandidateStatus(order2.candidates[0], order2), 'stale');

// 8. 废弃候选不能冻结；过期候选可废弃
await assert.rejects(
  () => freezeCandidate(order2.id, rcOrder.id),
  /已过期/,
);
await discardReleaseCandidate(order2.id, rcOrder.id);
contracts = await listContracts();
order2 = contracts.find((c) => c.id === 'contract-order');
assert.equal(order2.candidates[0].status, 'discarded');
await assert.rejects(
  () => freezeCandidate(order2.id, rcOrder.id),
  /已废弃/,
);

// 9. 重复版本号拦截
await reviewChange(order2.id, 'chg-order-1', 'accepted', '测试人', '重新确认');
await createReleaseCandidate(order2.id, '2.9.0', '再次生成');
await assert.rejects(
  () => createReleaseCandidate(order2.id, '2.9.0', '重复'),
  /已存在/,
);

// 10. 持久化：localStorage 中确实保存了候选与版本（关浏览器再开等价）
const raw = JSON.parse(store.get('pair-wise-gsb-70-contracts'));
assert.ok(raw.find((c) => c.id === 'contract-user').versions[0].candidateId);
assert.equal(raw.find((c) => c.id === 'contract-user').candidates[0].status, 'frozen');
assert.ok(raw.find((c) => c.id === 'contract-user').candidates[0].openapi.length > 0);

// 11. 旧数据归一化：删掉 candidates 字段重新读取，不崩且补空数组
const legacy = JSON.parse(store.get('pair-wise-gsb-70-contracts')).map((c) => {
  delete c.candidates;
  return c;
});
store.set('pair-wise-gsb-70-contracts', JSON.stringify(legacy));
contracts = await listContracts();
assert.deepEqual(contracts.map((c) => c.candidates), [[], [], []]);

console.log('所有候选状态机断言通过 ✅');
