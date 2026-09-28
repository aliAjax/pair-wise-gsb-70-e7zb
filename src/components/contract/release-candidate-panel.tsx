import { Link } from '@tanstack/react-router';
import {
  CheckCircle2,
  GitCommitHorizontal,
  Hourglass,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { formatDateTime } from '../../lib/utils';
import {
  CANDIDATE_STATUS_LABELS,
  CHANGE_KIND_LABELS,
  getCandidateStatus,
  validateForRelease,
  type ApiContract,
  type CandidateStatus,
  type ReleaseCandidate,
} from '../../models/contract';
import {
  useCreateCandidate,
  useDiscardCandidate,
  useFreezeCandidate,
} from '../../services/contract-queries';
import { CompatibilityBadge } from './compatibility-badge';

const STATUS_TONE: Record<CandidateStatus, 'green' | 'amber' | 'slate'> = {
  active: 'green',
  stale: 'amber',
  frozen: 'slate',
};

export function ReleaseCandidatePanel({ contract }: { contract: ApiContract }) {
  const createCandidate = useCreateCandidate();
  const discardCandidate = useDiscardCandidate();
  const freezeCandidate = useFreezeCandidate();
  const [version, setVersion] = useState(() => suggestVersion(contract.version));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const issues = useMemo(() => validateForRelease(contract), [contract]);
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const candidates = useMemo(
    () =>
      [...contract.candidates].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [contract.candidates],
  );

  async function handleCreate() {
    if (!version.trim() || blockers.length) return;
    setError('');
    try {
      await createCandidate.mutateAsync({
        contractId: contract.id,
        version: version.trim(),
        notes: notes.trim(),
      });
      setNotes('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '候选生成失败。');
    }
  }

  async function handleFreeze(candidateId: string) {
    setError('');
    try {
      await freezeCandidate.mutateAsync({ contractId: contract.id, candidateId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '冻结失败。');
    }
  }

  async function handleDiscard(candidateId: string) {
    setError('');
    try {
      await discardCandidate.mutateAsync({ contractId: contract.id, candidateId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '废弃候选失败。');
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>发布门禁与候选快照</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            门禁通过后生成不可变候选；评审确认与冻结之间工作副本再被修改，候选会立即过期。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={
              blockers.length
                ? 'flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3'
                : 'flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3'
            }
          >
            {blockers.length ? (
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            ) : (
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            )}
            <div>
              <strong className="text-sm">
                {blockers.length ? `${blockers.length} 个阻断项` : '发布门禁通过'}
              </strong>
              <ul className="mt-1 space-y-0.5 text-xs leading-5 text-slate-600">
                {blockers.length ? (
                  blockers.map((issue) => <li key={issue.id}>· {issue.title}：{issue.detail}</li>)
                ) : (
                  <li>所有变更已确认、影响说明与迁移方案齐备，可以生成发布候选。</li>
                )}
              </ul>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">候选版本号</label>
            <Input
              className="mt-1.5"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="2.9.0"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">发布说明</label>
            <Textarea
              className="mt-1.5"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="版本变化、兼容层和调用方升级状态"
            />
          </div>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}
          <Button
            className="w-full"
            variant="secondary"
            disabled={
              blockers.length > 0 || !version.trim() || createCandidate.isPending
            }
            onClick={() => void handleCreate()}
          >
            <Sparkles className="h-4 w-4" />
            {createCandidate.isPending ? '生成中' : '门禁通过，生成发布候选'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>发布候选</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            {candidates.length} 个候选，候选快照在浏览器关闭后仍保留
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              contract={contract}
              candidate={candidate}
              freezing={freezeCandidate.isPending}
              discarding={discardCandidate.isPending}
              onFreeze={() => void handleFreeze(candidate.id)}
              onDiscard={() => void handleDiscard(candidate.id)}
            />
          ))}
          {!candidates.length && (
            <p className="py-8 text-center text-xs text-slate-500">
              尚无候选。门禁通过后先在此生成不可变快照，再冻结正式版本。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateCard({
  contract,
  candidate,
  freezing,
  discarding,
  onFreeze,
  onDiscard,
}: {
  contract: ApiContract;
  candidate: ReleaseCandidate;
  freezing: boolean;
  discarding: boolean;
  onFreeze: () => void;
  onDiscard: () => void;
}) {
  const status = getCandidateStatus(candidate, contract);
  const frozenRelease = candidate.frozenVersionId
    ? contract.versions.find((release) => release.id === candidate.frozenVersionId)
    : undefined;

  return (
    <div
      className={
        status === 'stale'
          ? 'rounded-md border border-amber-300 bg-amber-50/50 p-3'
          : status === 'frozen'
            ? 'rounded-md border border-slate-300 bg-slate-50 p-3'
            : 'rounded-md border border-sky-200 bg-sky-50/40 p-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="slate">候选 v{candidate.version}</Badge>
          <Badge tone={STATUS_TONE[status]}>{CANDIDATE_STATUS_LABELS[status]}</Badge>
          <span className="text-[11px] text-slate-500">{formatDateTime(candidate.createdAt)}</span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">
          checksum {candidate.checksum}
        </span>
      </div>

      {candidate.notes && (
        <p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-600">
          {candidate.notes}
        </p>
      )}

      <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          已确认变更快照（{candidate.changes.length} 项）
        </p>
        {candidate.changes.length ? (
          <ul className="mt-1.5 space-y-1">
            {candidate.changes.map((change) => (
              <li
                key={change.id}
                className="flex flex-wrap items-center gap-2 text-[11px] leading-5 text-slate-600"
              >
                <span className="font-mono text-slate-700">
                  {change.method} {change.path}
                </span>
                <span>{CHANGE_KIND_LABELS[change.kind]}</span>
                <CompatibilityBadge value={change.compatibility} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-slate-400">候选不包含已确认变更（纯发布或文档性版本）。</p>
        )}
      </div>

      {status === 'stale' && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-amber-800">
          <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          生成候选后工作副本的接口定义或评审结论又被修改，该候选已过期，不能冻结。
          请确认最新工作副本门禁通过后重新生成候选。
        </p>
      )}

      {status === 'frozen' && frozenRelease && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          已冻结为正式版本 v{frozenRelease.version}（{formatDateTime(frozenRelease.releasedAt)}）
          <Link
            to="/contracts/$contractId"
            params={{ contractId: contract.id }}
            className="font-medium text-sky-800 hover:underline"
          >
            查看版本历史
          </Link>
        </p>
      )}

      {status === 'active' && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1" disabled={freezing} onClick={onFreeze}>
            <LockKeyhole className="h-3.5 w-3.5" />
            {freezing ? '冻结中' : '按此候选冻结正式版本'}
          </Button>
          <Button size="sm" variant="outline" disabled={discarding} onClick={onDiscard}>
            <Trash2 className="h-3.5 w-3.5" />
            废弃
          </Button>
        </div>
      )}
    </div>
  );
}

function suggestVersion(current: string): string {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return current;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}
