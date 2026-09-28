import {
  CheckCircle2,
  History,
  LockKeyhole,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { CHANGE_KIND_LABELS } from '../../models/contract';
import {
  CANDIDATE_DRIFT_LABELS,
  CANDIDATE_STATUS_LABELS,
  getCandidateDrift,
  getEffectiveCandidateStatus,
  validateForRelease,
  type ApiContract,
  type CandidateStatus,
  type ReleaseCandidate,
} from '../../models/contract';
import { formatDateTime } from '../../lib/utils';
import {
  useCreateCandidate,
  useDiscardCandidate,
  useFreezeCandidate,
} from '../../services/contract-queries';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

interface ReleaseCandidatePanelProps {
  contract: ApiContract | undefined;
  /** 切换契约时同步建议版本号并清空错误 */
  suggestVersion?: (current: string) => string;
}

export function ReleaseCandidatePanel({ contract, suggestVersion }: ReleaseCandidatePanelProps) {
  const createCandidate = useCreateCandidate();
  const discardCandidate = useDiscardCandidate();
  const freezeCandidate = useFreezeCandidate();
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [trackedContractId, setTrackedContractId] = useState(contract?.id);

  // 切换契约时重置错误并按目标契约当前版本建议候选版本号（渲染期调整 state）
  if (contract?.id !== trackedContractId) {
    setTrackedContractId(contract?.id);
    setError('');
    if (contract && suggestVersion) setVersion(suggestVersion(contract.version));
  }

  const issues = useMemo(() => (contract ? validateForRelease(contract) : []), [contract]);
  const blockers = issues.filter((issue) => issue.severity === 'blocker').length;

  const candidates = useMemo(
    () =>
      [...(contract?.candidates ?? [])].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [contract],
  );

  async function runAction(action: () => Promise<unknown>): Promise<boolean> {
    setError('');
    try {
      await action();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试');
      return false;
    }
  }

  async function handleCreate() {
    if (!contract || !version.trim()) return;
    const ok = await runAction(() =>
      createCandidate.mutateAsync({
        contractId: contract.id,
        version: version.trim(),
        notes: notes.trim() || '契约兼容性评审完成，生成发布候选。',
      }),
    );
    if (ok) setNotes('');
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-slate-700">候选版本号</label>
        <Input
          className="mt-1.5"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
          placeholder="2.9.0"
          disabled={!contract}
        />
        <label className="mt-4 block text-xs font-medium text-slate-700">发布说明</label>
        <Textarea
          className="mt-1.5"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="版本变化、兼容层和调用方升级状态，将随快照冻结"
          disabled={!contract}
        />

        {contract && (
          <div
            className={
              blockers
                ? 'mt-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3'
                : 'mt-4 flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3'
            }
          >
            {blockers ? (
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            )}
            <div>
              <strong className="text-sm">
                {blockers ? `${blockers} 个门禁阻断项` : '发布门禁通过'}
              </strong>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {blockers
                  ? '门禁通过后才能生成发布候选，阻断项需先在差异评审中处理。'
                  : '生成候选会冻结当前接口定义、已确认变更与发布说明的快照。'}
              </p>
            </div>
          </div>
        )}

        <Button
          className="mt-4 w-full"
          disabled={!contract || !!blockers || !version.trim() || createCandidate.isPending}
          onClick={() => void handleCreate()}
        >
          <History className="h-4 w-4" />
          {createCandidate.isPending ? '生成中' : '生成发布候选'}
        </Button>

        {error && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          候选清单（{candidates.length}）
        </p>
        <div className="mt-3 space-y-3">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              contract={contract}
              busy={freezeCandidate.isPending || discardCandidate.isPending}
              onFreeze={() =>
                void runAction(() =>
                  freezeCandidate.mutateAsync({
                    contractId: contract!.id,
                    candidateId: candidate.id,
                  }),
                )
              }
              onDiscard={() =>
                void runAction(() =>
                  discardCandidate.mutateAsync({
                    contractId: contract!.id,
                    candidateId: candidate.id,
                  }),
                )
              }
            />
          ))}
          {!candidates.length && (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500">
              尚无发布候选，门禁通过后生成一个不可变快照。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  contract,
  busy,
  onFreeze,
  onDiscard,
}: {
  candidate: ReleaseCandidate;
  contract?: ApiContract;
  busy: boolean;
  onFreeze: () => void;
  onDiscard: () => void;
}) {
  const effectiveStatus = contract
    ? getEffectiveCandidateStatus(candidate, contract)
    : candidate.status;
  const drift = contract ? getCandidateDrift(candidate, contract) : [];

  return (
    <div
      className={cardTone(effectiveStatus)}
      data-testid={`candidate-${candidate.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <strong className="text-sm">v{candidate.version}</strong>
            <StatusBadge status={effectiveStatus} />
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            {candidate.id} · 校验值 {candidate.openapiChecksum}
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-slate-500">
          {formatDateTime(candidate.createdAt)}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{candidate.notes}</p>

      <ul className="mt-2 space-y-1">
        {candidate.changes.slice(0, 3).map((change) => (
          <li key={change.id} className="text-[11px] leading-4 text-slate-500">
            <span className="font-mono">{change.method}</span> {change.path} ·{' '}
            {CHANGE_KIND_LABELS[change.kind]}
          </li>
        ))}
        {candidate.changes.length > 3 && (
          <li className="text-[11px] text-slate-400">
            等 {candidate.changes.length} 项已确认变更
          </li>
        )}
      </ul>

      {effectiveStatus === 'stale' && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800">
          工作副本已变化：{drift.map((kind) => CANDIDATE_DRIFT_LABELS[kind]).join('、')}
          。该候选不能冻结，请按当前副本重新生成。
        </div>
      )}
      {effectiveStatus === 'frozen' && (
        <p className="mt-2 text-[11px] text-emerald-800">
          已冻结为正式版本{candidate.frozenAt ? ` · ${formatDateTime(candidate.frozenAt)}` : ''}
        </p>
      )}

      {effectiveStatus === 'ready' && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1" disabled={busy} onClick={onFreeze}>
            <LockKeyhole className="h-3.5 w-3.5" />
            冻结此候选
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onDiscard}>
            <Trash2 className="h-3.5 w-3.5" />
            废弃
          </Button>
        </div>
      )}
      {effectiveStatus === 'stale' && (
        <Button size="sm" variant="outline" className="mt-3 w-full" disabled={busy} onClick={onDiscard}>
          <RefreshCw className="h-3.5 w-3.5" />
          废弃过期候选
        </Button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CandidateStatus }) {
  const tone = {
    ready: 'green',
    stale: 'amber',
    frozen: 'slate',
    discarded: 'neutral',
  }[status] as 'green' | 'amber' | 'slate' | 'neutral';
  return <Badge tone={tone}>{CANDIDATE_STATUS_LABELS[status]}</Badge>;
}

function cardTone(status: CandidateStatus): string {
  const base = 'rounded-md border p-3';
  switch (status) {
    case 'ready':
      return `${base} border-emerald-200 bg-emerald-50/40`;
    case 'stale':
      return `${base} border-amber-200 bg-amber-50/50`;
    case 'frozen':
      return `${base} border-slate-300 bg-slate-50`;
    case 'discarded':
      return `${base} border-slate-200 bg-white opacity-60`;
  }
}
