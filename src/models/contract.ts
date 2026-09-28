import { stableChecksum } from '../lib/utils';

export type ContractStatus = 'draft' | 'review' | 'ready' | 'released' | 'frozen';export type ChangeKind =
  | 'field_added'
  | 'field_removed'
  | 'optionality_changed'
  | 'enum_expanded'
  | 'error_code_added'
  | 'error_code_removed';
export type Compatibility = 'compatible' | 'warning' | 'breaking';
export type ReviewState = 'pending' | 'accepted' | 'returned' | 'exemption';

export interface ContractChange {
  id: string;
  path: string;
  method: string;
  kind: ChangeKind;
  before: string;
  after: string;
  compatibility: Compatibility;
  rationale: string;
  impactStatement: string;
  migrationPlan: string;
  reviewState: ReviewState;
  reviewer: string;
  reviewComment: string;
  reviewedAt?: string;
}

export interface ApiConsumer {
  id: string;
  name: string;
  owner: string;
  environment: '生产' | '预发' | '灰度';
  clientVersion: string;
  requestsPerDay: number;
  contact: string;
}

export interface Exemption {
  id: string;
  changeId: string;
  scope: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
}

export interface ContractVersion {
  id: string;
  contractId: string;
  version: string;
  releasedAt: string;
  checksum: string;
  notes: string;
  changeIds: string[];
  openapi: string;
  candidateId?: string;
  changes?: ContractChange[];
}

export type CandidateStatus = 'ready' | 'stale' | 'frozen' | 'discarded';
export type CandidateDriftKind = 'openapi' | 'changes' | 'exemptions';

export interface ReleaseCandidate {
  id: string;
  version: string;
  notes: string;
  createdAt: string;
  createdBy: string;
  status: CandidateStatus;
  /** 候选生成时门禁是否存在非阻断警告（不影响冻结） */
  warningsCount: number;
  /** 候选生成时工作副本 OpenAPI 的校验值，冻结版本沿用该值 */
  openapiChecksum: string;
  /** 工作副本整体指纹，用于判断候选是否已过期 */
  workFingerprint: string;
  /** 指纹中 OpenAPI 部分，用于定位漂移来源 */
  openapiFingerprint: string;
  /** 不可变的已确认变更快照 */
  changes: ContractChange[];
  /** 不可变的豁免快照 */
  exemptions: Exemption[];
  /** 不可变的接口定义快照，冻结时据此生成正式版本 */
  openapi: string;
  frozenVersionId?: string;
  frozenAt?: string;
  discardedAt?: string;
}

export interface ApiContract {
  id: string;
  name: string;
  version: string;
  domain: string;
  owner: string;
  protocol: 'REST' | 'GraphQL' | 'gRPC-Web';
  status: ContractStatus;
  updatedAt: string;
  openapi: string;
  changes: ContractChange[];
  consumers: ApiConsumer[];
  exemptions: Exemption[];
  versions: ContractVersion[];
  candidates: ReleaseCandidate[];
}

export interface ReleaseIssue {
  id: string;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  changeId?: string;
}

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  field_added: '新增字段',
  field_removed: '删除字段',
  optionality_changed: '可选性变化',
  enum_expanded: '枚举扩展',
  error_code_added: '新增错误码',
  error_code_removed: '删除错误码',
};

export const COMPATIBILITY_LABELS: Record<Compatibility, string> = {
  compatible: '兼容',
  warning: '警告',
  breaking: '不兼容',
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  pending: '待评审',
  accepted: '已接受',
  returned: '已退回',
  exemption: '兼容层豁免',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: '草稿',
  review: '评审中',
  ready: '待发布',
  released: '已发布',
  frozen: '已冻结',
};

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  ready: '候选有效',
  stale: '已过期',
  frozen: '已冻结',
  discarded: '已废弃',
};

export const CANDIDATE_DRIFT_LABELS: Record<CandidateDriftKind, string> = {
  openapi: '接口定义已修改',
  changes: '变更清单或评审结论已变化',
  exemptions: '豁免记录已变化',
};

export function classifyChange(input: {
  kind: ChangeKind;
  before: string;
  after: string;
}): { compatibility: Compatibility; rationale: string } {
  switch (input.kind) {
    case 'field_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除字段会使仍读取该字段的客户端解析失败或业务判断缺失。',
      };
    case 'error_code_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除错误码会破坏调用方基于错误码建立的分支与重试策略。',
      };
    case 'field_added':
      if (/required/i.test(input.after) || /必填/.test(input.after)) {
        return {
          compatibility: 'breaking',
          rationale: '新增必填字段要求现有调用方立即修改请求。',
        };
      }
      return {
        compatibility: 'compatible',
        rationale: '新增可选字段不会改变现有请求和响应结构。',
      };
    case 'optionality_changed':
      if (/可选.*必填|optional.*required/i.test(`${input.before} ${input.after}`)) {
        return {
          compatibility: 'breaking',
          rationale: '字段从可选变为必填，现有调用方可能不再满足请求约束。',
        };
      }
      return {
        compatibility: 'warning',
        rationale: '字段从必填变为可选会改变调用方对响应完整性的假设。',
      };
    case 'enum_expanded':
      return {
        compatibility: 'warning',
        rationale: '新增枚举值可能使未实现默认分支的客户端出现解析或展示异常。',
      };
    case 'error_code_added':
      return {
        compatibility: 'warning',
        rationale: '调用方应明确新错误码的展示和重试策略。',
      };
  }
}

export function validateForRelease(contract: ApiContract): ReleaseIssue[] {
  const issues: ReleaseIssue[] = [];
  const pending = contract.changes.filter((change) => change.reviewState === 'pending');
  pending.forEach((change) => {
    issues.push({
      id: `pending-${change.id}`,
      severity: 'blocker',
      title: '存在未处理变更',
      detail: `${change.method} ${change.path} 仍处于待评审状态。`,
      changeId: change.id,
    });
  });

  contract.changes
    .filter((change) => change.reviewState !== 'exemption')
    .forEach((change) => {
      if (change.compatibility === 'compatible') {
        return;
      }
      if (!change.impactStatement.trim()) {
        issues.push({
          id: `impact-${change.id}`,
          severity: 'blocker',
          title: '缺少调用方影响说明',
          detail: `${change.path} 需要说明受影响调用方、流量和业务影响。`,
          changeId: change.id,
        });
      }
      if (!change.migrationPlan.trim()) {
        issues.push({
          id: `migration-${change.id}`,
          severity: 'blocker',
          title: '缺少迁移方案',
          detail: `${change.path} 需要给出客户端升级、兼容层或回滚路径。`,
          changeId: change.id,
        });
      }
    });

  contract.changes
    .filter(
      (change) =>
        change.compatibility === 'breaking' &&
        change.reviewState === 'accepted' &&
        !contract.exemptions.some((item) => item.changeId === change.id),
    )
    .forEach((change) => {
      issues.push({
        id: `breaking-${change.id}`,
        severity: 'warning',
        title: '不兼容变更已接受但未登记豁免',
        detail: `${change.path} 需要记录兼容层的范围、原因和到期时间。`,
        changeId: change.id,
      });
    });

  return issues;
}

/**
 * 发布候选的工作副本指纹：
 * 接口定义、变更（含评审结论）和豁免记录中任一部分变化，指纹都会改变。
 */
export interface CandidateFingerprint {
  work: string;
  openapi: string;
}

export function computeCandidateFingerprint(
  contract: Pick<ApiContract, 'openapi' | 'changes' | 'exemptions'>,
): CandidateFingerprint {
  // stableChecksum 仅用于 localStorage 本地数据一致性校验，不参与安全场景
  const openapi = stableChecksum(contract.openapi);
  const changes = stableChecksum(JSON.stringify(contract.changes));
  const exemptions = stableChecksum(JSON.stringify(contract.exemptions));
  return { openapi, work: stableChecksum(`${openapi}|${changes}|${exemptions}`) };
}

/** 返回候选与当前工作副本不一致的部分；一致时返回空数组。 */
export function getCandidateDrift(
  candidate: ReleaseCandidate,
  contract: Pick<ApiContract, 'openapi' | 'changes' | 'exemptions'>,
): CandidateDriftKind[] {
  const fingerprint = computeCandidateFingerprint(contract);
  if (fingerprint.work === candidate.workFingerprint) return [];
  const drift: CandidateDriftKind[] = [];
  if (fingerprint.openapi !== candidate.openapiFingerprint) drift.push('openapi');
  if (stableChecksum(JSON.stringify(contract.changes)) !== stableChecksum(JSON.stringify(candidate.changes))) {
    drift.push('changes');
  }
  if (
    stableChecksum(JSON.stringify(contract.exemptions)) !==
    stableChecksum(JSON.stringify(candidate.exemptions))
  ) {
    drift.push('exemptions');
  }
  return drift;
}

/** 冻结/废弃状态由记录本身决定；仍处于就绪态的候选需要实时对照工作副本。 */
export function getEffectiveCandidateStatus(
  candidate: ReleaseCandidate,
  contract?: Pick<ApiContract, 'openapi' | 'changes' | 'exemptions'>,
): CandidateStatus {
  if (candidate.status === 'frozen' || candidate.status === 'discarded') return candidate.status;
  if (!contract) return candidate.status;
  return getCandidateDrift(candidate, contract).length ? 'stale' : 'ready';
}
