import { seedContracts } from '../data/seed';
import type {
  ApiContract,
  ContractChange,
  ContractVersion,
  ReleaseCandidate,
  ReviewState,
} from '../models/contract';
import { computeCandidateFingerprint, validateForRelease } from '../models/contract';
import { formatDateTime } from '../lib/utils';

const STORAGE_KEY = 'pair-wise-gsb-70-contracts';
const LATENCY = 180;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 兼容旧版 localStorage 数据：补齐候选字段与历史版本的候选溯源信息。 */
function normalize(contract: ApiContract): ApiContract {
  return {
    ...contract,
    candidates: Array.isArray(contract.candidates) ? contract.candidates : [],
    versions: contract.versions.map((release) => ({
      ...release,
      changeIds: release.changeIds ?? [],
    })),
  };
}

async function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ApiContract[];
      return parsed.map(normalize);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  persistContracts(seedContracts);
  return clone(seedContracts);
}

export async function getContract(id: string): Promise<ApiContract | undefined> {
  const contracts = await listContracts();
  return contracts.find((contract) => contract.id === id);
}

export async function saveContract(updated: ApiContract): Promise<ApiContract> {
  const contracts = await listContracts();
  const exists = contracts.some((contract) => contract.id === updated.id);
  const saved = { ...updated, updatedAt: new Date().toISOString() };
  const next = exists
    ? contracts.map((contract) => (contract.id === updated.id ? saved : contract))
    : [saved, ...contracts];
  persistContracts(next);
  await wait();
  return clone(saved);
}

export async function reviewChange(
  contractId: string,
  changeId: string,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const updated: ApiContract = {
    ...contract,
    status: contract.status === 'draft' ? 'review' : contract.status,
    changes: contract.changes.map((change) =>
      change.id === changeId
        ? {
            ...change,
            reviewState,
            reviewer,
            reviewComment: comment,
            reviewedAt: new Date().toISOString(),
          }
        : change,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function bulkReviewChanges(
  selections: Array<{ contractId: string; changeId: string }>,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract[]> {
  const contracts = await listContracts();
  const selected = new Set(selections.map((item) => `${item.contractId}:${item.changeId}`));
  const updated = contracts.map((contract) => ({
    ...contract,
    status:
      selected.has(`${contract.id}:${contract.changes[0]?.id}`) && contract.status === 'draft'
        ? ('review' as const)
        : contract.status,
    changes: contract.changes.map((change) =>
      selected.has(`${contract.id}:${change.id}`)
        ? {
            ...change,
            reviewState,
            reviewer,
            reviewComment: comment,
            reviewedAt: new Date().toISOString(),
          }
        : change,
    ),
  }));
  persistContracts(updated);
  await wait();
  return clone(updated);
}

export async function updateContractOpenApi(
  contractId: string,
  openapi: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const updated = { ...contract, openapi, updatedAt: new Date().toISOString() };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function addExemption(
  contractId: string,
  changeId: string,
  reason: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const exemption = {
    id: `ex-${Date.now()}`,
    changeId,
    scope: contract.changes.find((item) => item.id === changeId)?.path ?? '未指定',
    reason,
    approvedBy: '当前评审人',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  const updated: ApiContract = {
    ...contract,
    exemptions: [...contract.exemptions, exemption],
    changes: contract.changes.map((change) =>
      change.id === changeId ? { ...change, reviewState: 'exemption' } : change,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function createReleaseCandidate(
  contractId: string,
  version: string,
  notes: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const issues = validateForRelease(contract);
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  if (blockers.length) {
    throw new Error(`发布门禁未通过：${blockers[0].title}`);
  }
  const targetVersion = version.trim();
  if (contract.versions.some((release) => release.version === targetVersion)) {
    throw new Error(`版本 v${targetVersion} 已存在，请使用新的版本号`);
  }
  if (
    contract.candidates.some(
      (candidate) =>
        candidate.version === targetVersion &&
        candidate.status !== 'discarded' &&
        candidate.status !== 'frozen',
    )
  ) {
    throw new Error(`已存在版本 v${targetVersion} 的有效候选`);
  }

  const fingerprint = computeCandidateFingerprint(contract);
  const candidate: ReleaseCandidate = {
    id: `rc-${Date.now()}`,
    version: targetVersion,
    notes: notes.trim() || '契约兼容性评审完成，生成发布候选。',
    createdAt: new Date().toISOString(),
    createdBy: '当前发布人',
    status: 'ready',
    warningsCount: issues.filter((issue) => issue.severity === 'warning').length,
    openapiChecksum: fingerprint.openapi,
    workFingerprint: fingerprint.work,
    openapiFingerprint: fingerprint.openapi,
    changes: clone(contract.changes),
    exemptions: clone(contract.exemptions),
    openapi: contract.openapi,
  };
  const updated: ApiContract = {
    ...contract,
    candidates: [candidate, ...contract.candidates],
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function discardReleaseCandidate(
  contractId: string,
  candidateId: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const candidate = contract.candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error('发布候选不存在');
  }
  if (candidate.status === 'frozen') {
    throw new Error('已冻结的候选不能废弃');
  }
  const updated: ApiContract = {
    ...contract,
    candidates: contract.candidates.map((item) =>
      item.id === candidateId
        ? { ...item, status: 'discarded', discardedAt: new Date().toISOString() }
        : item,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function freezeCandidate(
  contractId: string,
  candidateId: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const candidate = contract.candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error('发布候选不存在');
  }
  if (candidate.status === 'frozen') {
    throw new Error('该候选已冻结');
  }
  if (candidate.status === 'discarded') {
    throw new Error('该候选已废弃，不能冻结');
  }

  // 冻结前再次比对工作副本：任何漂移都必须重新生成候选，不能混冻
  const drift = computeCandidateFingerprint(contract);
  if (drift.work !== candidate.workFingerprint) {
    throw new Error('候选已过期：工作副本在候选生成后发生变化，请重新生成候选');
  }

  const release: ContractVersion = {
    id: `ver-${Date.now()}`,
    contractId,
    version: candidate.version,
    releasedAt: new Date().toISOString(),
    checksum: candidate.openapiChecksum,
    notes: candidate.notes,
    changeIds: candidate.changes.map((change) => change.id),
    openapi: candidate.openapi,
    candidateId: candidate.id,
    changes: clone(candidate.changes),
  };
  const frozenAt = release.releasedAt;
  const updated: ApiContract = {
    ...contract,
    version: candidate.version,
    status: 'frozen',
    versions: [release, ...contract.versions],
    candidates: contract.candidates.map((item) =>
      item.id === candidateId
        ? { ...item, status: 'frozen', frozenVersionId: release.id, frozenAt }
        : item,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export function generateExampleRequest(contract: ApiContract, change?: ContractChange): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contract.openapi);
  } catch {
    parsed = null;
  }
  const openapi = parsed as
    | {
        paths?: Record<string, Record<string, { summary?: string }>>;
      }
    | null;
  const candidates = openapi?.paths ? Object.entries(openapi.paths) : [];
  const selectedPath = change?.path ?? candidates[0]?.[0] ?? '/resource';
  const selectedMethod = (
    change?.method ??
    (candidates[0]?.[1] ? Object.keys(candidates[0][1])[0] : 'get')
  ).toUpperCase();
  const fields = change
    ? [change.after.replace(/^新增|移除|变为/g, '').trim()]
    : ['orderId: ORD-20260929-001', 'requestId: req-local-demo'];

  return JSON.stringify(
    {
      method: selectedMethod,
      url: `https://api.example.com${selectedPath.replace('{orderId}', 'ORD-20260929-001').replace('{paymentId}', 'PAY-90218').replace('{userId}', 'U-1024')}`,
      headers: {
        Authorization: 'Bearer <token>',
        'X-Client-Version': contract.version,
      },
      body:
        selectedMethod === 'GET'
          ? undefined
          : Object.fromEntries(
              fields.map((field) => {
                const [key, value] = field.split(':').map((item) => item.trim());
                return [key || 'field', value || 'value'];
              }),
            ),
    },
    null,
    2,
  );
}

export function buildChangeReport(contract: ApiContract): string {
  const lines = [
    `# ${contract.name} ${contract.version} 契约变更报告`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 状态：${contract.status}`,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '## 变更明细',
    ...contract.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}`,
      `- 变更前：${change.before}`,
      `- 变更后：${change.after}`,
      `- 判定依据：${change.rationale}`,
      `- 调用方影响：${change.impactStatement || '未填写'}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}`,
      `- 评审结论：${change.reviewState}`,
      '',
    ]),
    '## 调用方',
    ...contract.consumers.map(
      (consumer) =>
        `- ${consumer.name} / ${consumer.owner} / ${consumer.environment} / ${consumer.clientVersion}`,
    ),
    '',
    '## 豁免记录',
    ...(contract.exemptions.length
      ? contract.exemptions.map(
          (item) => `- ${item.scope}：${item.reason}（至 ${item.expiresAt}）`,
        )
      : ['- 无']),
  ];
  return lines.join('\n');
}

export function diffVersionSummary(
  contract: ApiContract,
  release: ContractVersion | undefined = contract.versions[0],
): string {
  if (!release) {
    return '无可比较的历史正式版本。';
  }
  const lines = [
    `版本 v${release.version}`,
    `发布于 ${formatDateTime(release.releasedAt)}`,
    `校验值 ${release.checksum}`,
  ];
  const candidate = contract.candidates.find((item) => item.id === release.candidateId);
  if (candidate) {
    lines.push(
      `来自发布候选 ${candidate.id}（${formatDateTime(candidate.createdAt)} 生成）`,
    );
  }
  lines.push(`快照变更 ${release.changeIds.length} 项`);
  return lines.join('\n');
}

function persistContracts(contracts: ApiContract[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
}
