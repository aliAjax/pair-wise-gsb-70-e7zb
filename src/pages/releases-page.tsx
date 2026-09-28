import { Link } from '@tanstack/react-router';
import { Archive, GitCommit, PackageCheck, LockKeyhole } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { ReleaseCandidatePanel } from '../components/release/release-candidate-panel';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { formatDateTime } from '../lib/utils';
import {
  CHANGE_KIND_LABELS,
  type ApiContract,
  type ContractChange,
  type ContractVersion,
} from '../models/contract';
import { useContracts } from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';

export function ReleasesPage() {
  const contracts = useContracts();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);

  const selectedContract = (contracts.data ?? []).find(
    (contract) => contract.id === selectedContractId,
  );

  const versions = useMemo(
    () =>
      (contracts.data ?? [])
        .flatMap((contract) =>
          contract.versions.map((release) => ({ contract, release })),
        )
        .sort(
          (left, right) =>
            new Date(right.release.releasedAt).getTime() -
            new Date(left.release.releasedAt).getTime(),
        ),
    [contracts.data],
  );

  const suggestVersion = useCallback((current: string): string => {
    const parts = current.split('.').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return current;
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }, []);

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Release Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
          契约版本发布
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          门禁通过后先生成发布候选：版本号、校验值、发布说明和已确认变更在候选中固化为不可变快照。
          工作副本再被修改时候选立即标记为已过期，不能冻结，只能重新生成。
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <Card>
          <CardHeader>
            <CardTitle>正式版本记录</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{versions.length} 个冻结版本</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">契约</th>
                    <th className="px-4 py-3 font-medium">版本</th>
                    <th className="px-4 py-3 font-medium">发布时间</th>
                    <th className="px-4 py-3 font-medium">校验值</th>
                    <th className="px-4 py-3 font-medium">来源候选</th>
                    <th className="px-4 py-3 font-medium">已确认变更</th>
                    <th className="px-4 py-3 font-medium">发布说明</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {versions.map(({ contract, release }) => (
                    <ReleaseRow key={release.id} contract={contract} release={release} />
                  ))}
                </tbody>
              </table>
              {!versions.length && (
                <p className="px-4 py-16 text-center text-sm text-slate-500">
                  尚无冻结的正式版本。
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>发布候选</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                选择契约，门禁通过后生成不可变快照并从候选冻结
              </p>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedContractId}
                onValueChange={(value) => setSelectedContract(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择一个契约" />
                </SelectTrigger>
                <SelectContent>
                  {(contracts.data ?? []).map((contract) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {contract.name} · v{contract.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="mt-4">
                {selectedContract ? (
                  <ReleaseCandidatePanel
                    contract={selectedContract}
                    suggestVersion={suggestVersion}
                  />
                ) : (
                  <p className="rounded-md border border-dashed border-slate-200 px-3 py-10 text-center text-xs text-slate-500">
                    请先选择一个契约。
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>冻结策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <Policy icon={Archive} text="候选快照固化接口定义、校验值、发布说明和已确认变更。" />
              <Policy icon={GitCommit} text="工作副本一旦改动，候选自动标记过期且禁止冻结。" />
              <Policy icon={PackageCheck} text="正式版本记录来源候选，历史不会被后续编辑覆盖。" />
              <Policy icon={LockKeyhole} text="候选与版本均持久化保存，关闭浏览器后仍然保留。" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReleaseRow({ contract, release }: { contract: ApiContract; release: ContractVersion }) {
  const changes = resolveReleaseChanges(contract, release);
  const candidate = contract.candidates.find((item) => item.id === release.candidateId);
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-4">
        <div className="font-medium">{contract.name}</div>
        <div className="mt-1 text-xs text-slate-500">{contract.domain}</div>
      </td>
      <td className="px-4 py-4">
        <Badge tone="slate">v{release.version}</Badge>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-slate-600">
        {formatDateTime(release.releasedAt)}
      </td>
      <td className="px-4 py-4 font-mono text-xs text-slate-600">{release.checksum}</td>
      <td className="px-4 py-4">
        {candidate ? (
          <div>
            <Badge tone="green">候选</Badge>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{candidate.id}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {formatDateTime(candidate.createdAt)} 生成
            </p>
          </div>
        ) : (
          <span className="text-xs text-slate-400">候选机制前版本</span>
        )}
      </td>
      <td className="px-4 py-4">
        <ChangeSummary changes={changes} />
      </td>
      <td className="max-w-xs px-4 py-4 text-slate-600">
        <p className="line-clamp-3">{release.notes}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-right">
        <Link
          to="/contracts/$contractId"
          params={{ contractId: contract.id }}
          className="text-xs font-medium text-sky-800 hover:underline"
        >
          查看版本
        </Link>
      </td>
    </tr>
  );
}

function ChangeSummary({ changes }: { changes: ContractChange[] }) {
  if (!changes.length) {
    return <span className="text-xs text-slate-400">无变更快照</span>;
  }
  return (
    <div>
      <strong className="text-xs">{changes.length} 项</strong>
      <ul className="mt-1 space-y-0.5">
        {changes.slice(0, 2).map((change) => (
          <li key={change.id} className="text-[10px] leading-4 text-slate-500">
            <span className="font-mono">{change.method}</span> {change.path} ·{' '}
            {CHANGE_KIND_LABELS[change.kind]}
          </li>
        ))}
        {changes.length > 2 && (
          <li className="text-[10px] text-slate-400">其余 {changes.length - 2} 项见详情</li>
        )}
      </ul>
    </div>
  );
}

/** 新版本直接携带候选变更快照；旧数据则从当前契约按 id 回溯。 */
function resolveReleaseChanges(
  contract: ApiContract,
  release: ContractVersion,
): ContractChange[] {
  if (release.changes?.length) return release.changes;
  return release.changeIds
    .map((id) => contract.changes.find((change) => change.id === id))
    .filter((change): change is ContractChange => Boolean(change));
}

function Policy({
  icon: Icon,
  text,
}: {
  icon: typeof Archive;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" />
      <span>{text}</span>
    </div>
  );
}
