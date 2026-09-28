import { stableChecksum } from '../lib/utils';

export type ContractStatus = 'draft' | 'review' | 'ready' | 'released' | 'frozen';
export type ChangeKind =
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

export interface ReleaseCandidate {
  id: string;
  contractId: string;
  /** 候选拟定的发布版本号 */
  version: string;
  /** 发布说明 */
  notes: string;
  createdAt: string;
  /** 候选生成时工作副本 OpenAPI 的校验值 */
  checksum: string;
  /**
   * 候选对工作副本计算的指纹（OpenAPI + 变更评审状态与影响/迁移说明）。
   * 工作副本再改后指纹不一致，候选即判定为已过期，不能冻结。
   */
  workingFingerprint: string;
  /** 生成候选时门禁结果的快照，仅用于展示 */
  gateIssues: ReleaseIssue[];
  /** 不可变快照：完整 OpenAPI 定义 */
  openapi: string;
  /** 不可变快照：已确认（非待评审、非退回）的变更 */
  changes: ContractChange[];
  /** 生成后被冻结成的正式版本 id；为空表示尚未冻结 */
  frozenVersionId?: string;
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
  /** 该版本由哪个发布候选冻结而来 */
  candidateId?: string;
  /** 冻结时刻确认的变更快照，正式版本历史据此展示所含变更 */
  changes?: ContractChange[];
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

export type CandidateStatus = 'active' | 'stale' | 'frozen';

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

/** 参与候选快照的变更：评审人已给出结论（接受或兼容层豁免）的变更。 */
export function selectConfirmedChanges(changes: ContractChange[]): ContractChange[] {
  return changes.filter(
    (change) => change.reviewState === 'accepted' || change.reviewState === 'exemption',
  );
}

/**
 * 计算工作副本指纹。评审确认之后只要接口定义或变更结论再被改动
 * （OpenAPI、评审状态、影响说明、迁移方案、评审意见），指纹就会变化。
 */
export function workingCopyFingerprint(
  openapi: string,
  changes: ContractChange[],
): string {
  const digest = changes.map(
    (change) =>
      [
        change.id,
        change.reviewState,
        change.before,
        change.after,
        change.impactStatement,
        change.migrationPlan,
        change.reviewComment,
        change.reviewedAt ?? '',
      ].join(''),
  );
  return stableChecksum(`${openapi} ${digest.join('')}`);
}

export function getCandidateStatus(
  candidate: ReleaseCandidate,
  contract: ApiContract,
): CandidateStatus {
  if (candidate.frozenVersionId) return 'frozen';
  return workingCopyFingerprint(contract.openapi, contract.changes) ===
    candidate.workingFingerprint
    ? 'active'
    : 'stale';
}

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  active: '有效',
  stale: '已过期',
  frozen: '已冻结',
};
