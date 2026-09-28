import { Link } from '@tanstack/react-router';
import { Archive, GitCommitHorizontal, LockKeyhole, PackageCheck } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { ReleaseCandidatePanel } from '../components/contract/release-candidate-panel';
import { formatDateTime } from '../lib/utils';
import { CHANGE_KIND_LABELS } from '../models/contract';
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

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Release Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
          契约版本发布
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          评审通过后先生成发布候选并冻结为不可变快照；工作副本再被修改时候选立即过期、无法冻结，
          杜绝评审确认与正式冻结之间新旧内容混杂。
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <Card>
          <CardHeader>
            <CardTitle>正式版本记录</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {versions.length} 个冻结版本，均标注来源候选与所含变更
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">契约</th>
                    <th className="px-4 py-3 font-medium">版本 / 来源候选</th>
                    <th className="px-4 py-3 font-medium">发布时间</th>
                    <th className="px-4 py-3 font-medium">校验值</th>
                    <th className="px-4 py-3 font-medium">所含变更与发布说明</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {versions.map(({ contract, release }) => {
                    const candidate = contract.candidates.find(
                      (item) => item.id === release.candidateId,
                    );
                    const changes = release.changes ?? [];
                    return (
                      <tr key={release.id} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-4">
                          <div className="font-medium">{contract.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{contract.domain}</div>
                        </td>
                        <td className="px-4 py-4">
                          <Badge tone="slate">v{release.version}</Badge>
                          <div className="mt-1.5 text-[11px] text-slate-500">
                            {candidate ? (
                              <>
                                来自候选 v{candidate.version}
                                <div className="font-mono text-[10px] text-slate-400">
                                  {candidate.id}
                                </div>
                              </>
                            ) : (
                              '历史版本（候选机制上线前冻结）'
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-600">
                          {formatDateTime(release.releasedAt)}
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-slate-600">
                          {release.checksum}
                        </td>
                        <td className="max-w-md px-4 py-4 text-slate-600">
                          {changes.length ? (
                            <ul className="space-y-1 text-xs leading-5">
                              {changes.map((change) => (
                                <li key={change.id}>
                                  <GitCommitHorizontal className="mr-1 inline h-3 w-3 text-slate-400" />
                                  <span className="font-mono">
                                    {change.method} {change.path}
                                  </span>{' '}
                                  · {CHANGE_KIND_LABELS[change.kind]}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-400">无记录的变更项</p>
                          )}
                          <p className="mt-2 whitespace-pre-line border-t border-slate-100 pt-2 text-xs leading-5">
                            {release.notes}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-right">
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
                  })}
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
              <CardTitle>选择契约</CardTitle>
              <p className="mt-1 text-xs text-slate-500">针对其工作副本运行门禁并生成候选</p>
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
              {!selectedContract && (
                <p className="mt-3 text-xs text-slate-500">
                  请先选择一个契约，再生成发布候选。
                </p>
              )}
            </CardContent>
          </Card>

          {selectedContract && <ReleaseCandidatePanel contract={selectedContract} />}

          <Card>
            <CardHeader>
              <CardTitle>冻结策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <Policy icon={Archive} text="候选快照包含完整 OpenAPI、已确认变更、版本号、校验值与发布说明。" />
              <Policy icon={PackageCheck} text="冻结只能来自未过期的候选，内容取自快照而非实时工作副本。" />
              <Policy icon={LockKeyhole} text="冻结后版本不可覆盖，历史中可追溯来源候选，关闭浏览器仍保留。" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
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
