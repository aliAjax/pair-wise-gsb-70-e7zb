import { seedContracts } from '../data/seed';
import type {
  ApiContract,
  ContractChange,
  ContractVersion,
  ReleaseCandidate,
  ReviewState,
} from '../models/contract';
import {
  selectConfirmedChanges,
  validateForRelease,
  workingCopyFingerprint,
} from '../models/contract';
import { stableChecksum, formatDateTime } from '../lib/utils';

const STORAGE_KEY = 'pair-wise-gsb-70-contracts';
const LATENCY = 180;

function clone<T>(value: T): T {
  return structuredClone(value);
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
      const normalized = parsed.map(migrateContract);
      return normalized;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  persistContracts(seedContracts);
  return clone(seedContracts);
}

/** 兼容旧版本本地数据：补齐发布候选字段。 */
function migrateContract(contract: ApiContract): ApiContract {
  return {
    ...contract,
    candidates: contract.candidates ?? [],
    versions: contract.versions ?? [],
  };
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

/**
 * 生成发布候选：门禁通过后对当前工作副本打不可变快照。
 * 快照记录版本号、校验值、发布说明和已确认的变更。
 */
export async function createReleaseCandidate(input: {
  contractId: string;
  version: string;
  notes: string;
}): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === input.contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const blockers = validateForRelease(contract).filter(
    (issue) => issue.severity === 'blocker',
  );
  if (blockers.length) {
    throw new Error(`发布门禁仍有 ${blockers.length} 个阻断项，不能生成候选。`);
  }
  const version = input.version.trim();
  if (contract.versions.some((release) => release.version === version)) {
    throw new Error(`版本 v${version} 已存在，请使用新的版本号。`);
  }
  if (
    contract.candidates.some(
      (candidate) => !candidate.frozenVersionId && candidate.version === version,
    )
  ) {
    throw new Error(`已有未冻结的候选 v${version}。`);
  }

  const confirmed = selectConfirmedChanges(contract.changes);
  const candidate: ReleaseCandidate = {
    id: `rc-${Date.now()}`,
    contractId: input.contractId,
    version,
    notes: input.notes.trim(),
    createdAt: new Date().toISOString(),
    checksum: stableChecksum(contract.openapi),
    workingFingerprint: workingCopyFingerprint(contract.openapi, contract.changes),
    gateIssues: validateForRelease(contract),
    openapi: contract.openapi,
    changes: clone(confirmed),
  };
  const updated: ApiContract = {
    ...contract,
    status: 'ready',
    candidates: [candidate, ...contract.candidates],
  };
  persistContracts(contracts.map((item) => (item.id === input.contractId ? updated : item)));
  await wait();
  return clone(updated);
}

/** 废弃未冻结的候选。 */
export async function discardReleaseCandidate(
  contractId: string,
  candidateId: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const updated: ApiContract = {
    ...contract,
    candidates: contract.candidates.filter((candidate) => candidate.id !== candidateId),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

/**
 * 基于发布候选冻结正式版本。版本内容（OpenAPI、变更清单、校验值）全部取自
 * 候选快照而非实时工作副本；候选一旦过期（工作副本被改动）即拒绝冻结。
 */
export async function freezeFromCandidate(
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
    throw new Error('发布候选不存在，请重新生成。');
  }
  if (candidate.frozenVersionId) {
    throw new Error('该候选已经冻结为正式版本。');
  }
  if (
    workingCopyFingerprint(contract.openapi, contract.changes) !==
    candidate.workingFingerprint
  ) {
    throw new Error('候选已过期：生成后工作副本又被修改，请废弃后基于最新内容重新生成。');
  }
  if (contract.versions.some((release) => release.version === candidate.version)) {
    throw new Error(`版本 v${candidate.version} 已存在，请调整候选版本号。`);
  }

  const release: ContractVersion = {
    id: `ver-${Date.now()}`,
    contractId,
    version: candidate.version,
    releasedAt: new Date().toISOString(),
    checksum: candidate.checksum,
    notes: candidate.notes || '契约兼容性评审完成，正式冻结。',
    changeIds: candidate.changes.map((change) => change.id),
    openapi: candidate.openapi,
    candidateId: candidate.id,
    changes: clone(candidate.changes),
  };
  const updated: ApiContract = {
    ...contract,
    version: candidate.version,
    status: 'frozen',
    versions: [release, ...contract.versions],
    candidates: contract.candidates.map((item) =>
      item.id === candidate.id ? { ...item, frozenVersionId: release.id } : item,
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

export function diffVersionSummary(contract: ApiContract): string {
  const previous = contract.versions[0];
  if (!previous) {
    return '无可比较的历史正式版本。';
  }
  return [
    `上一版 ${previous.version}`,
    `发布于 ${formatDateTime(previous.releasedAt)}`,
    `校验值 ${previous.checksum}`,
    `本版变更 ${contract.changes.length} 项`,
  ].join('\n');
}

function persistContracts(contracts: ApiContract[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
}
