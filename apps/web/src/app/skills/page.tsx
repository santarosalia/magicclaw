"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Pin, PinOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  getCuratorStatus,
  getSkills,
  installHubSkill,
  pauseCurator,
  pinSkill,
  restoreSkill,
  resumeCurator,
  runCurator,
  saveCuratorConfig,
  uninstallHubSkill,
  type CuratorStatusResponse,
  type SkillsListResponse,
} from "@/lib/skills-api";

export default function SkillsPage() {
  const [skillsData, setSkillsData] = useState<SkillsListResponse | null>(null);
  const [curator, setCurator] = useState<CuratorStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [forceInstall, setForceInstall] = useState(false);

  const hubNames = useMemo(
    () => new Set(skillsData?.hub.map((h) => h.name) ?? []),
    [skillsData]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [skills, curatorStatus] = await Promise.all([
        getSkills(),
        getCuratorStatus(),
      ]);
      setSkillsData(skills);
      setCurator(curatorStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (fn: () => Promise<void>, okMessage?: string) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        await fn();
        if (okMessage) setMessage(okMessage);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const handleInstall = () => {
    const id = identifier.trim();
    if (!id) return;
    void runAction(async () => {
      const result = await installHubSkill({ identifier: id, force: forceInstall });
      if (!result.success) {
        throw new Error(result.error ?? "설치에 실패했습니다.");
      }
      setIdentifier("");
      setMessage(`'${result.name}' 스킬을 설치했습니다.`);
    });
  };

  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">스킬 관리</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          새로고침
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            GitHub에서 설치
          </CardTitle>
          <CardDescription>
            Hub 스킬은 curator가 자동 보관하지 않습니다.{" "}
            <code>owner/repo</code> 또는 <code>owner/repo/path</code> 형식.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="hub-identifier">식별자</Label>
            <Input
              id="hub-identifier"
              placeholder="NousResearch/hermes-agent/skills/github"
              value={identifier}
              disabled={busy}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleInstall();
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={forceInstall}
              disabled={busy}
              onChange={(e) => setForceInstall(e.target.checked)}
            />
            이미 설치된 경우 덮어쓰기 (force)
          </label>
          <Button disabled={busy || !identifier.trim()} onClick={handleInstall}>
            설치
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>설치된 스킬</CardTitle>
          <CardDescription>
            에이전트가 <code>skill_manage</code>로 읽고 실행하는 플레이북입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !skillsData ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : skillsData.skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">설치된 스킬이 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {skillsData.skills.map((skill) => {
                const isHub = hubNames.has(skill.name);
                const hubEntry = skillsData.hub.find((h) => h.name === skill.name);
                const agentMeta = curator?.agentSkills.find(
                  (a) => a.name === skill.name
                );
                return (
                  <li
                    key={skill.path}
                    className="rounded-lg border p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{skill.name}</span>
                      <Badge variant="secondary">{skill.category}</Badge>
                      {isHub ? <Badge variant="outline">hub</Badge> : null}
                      {agentMeta ? (
                        <Badge
                          variant={
                            agentMeta.state === "stale" ? "destructive" : "outline"
                          }
                        >
                          {agentMeta.state}
                        </Badge>
                      ) : null}
                      {agentMeta?.pinned ? (
                        <Badge variant="default">pinned</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {skill.description || "설명 없음"}
                    </p>
                    {hubEntry ? (
                      <p className="text-xs text-muted-foreground truncate">
                        {hubEntry.identifier}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {isHub ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void runAction(async () => {
                              const result = await uninstallHubSkill(skill.name);
                              if (!result.success) {
                                throw new Error(
                                  result.error ?? "제거에 실패했습니다."
                                );
                              }
                            }, `'${skill.name}' 스킬을 제거했습니다.`)
                          }
                        >
                          Hub 제거
                        </Button>
                      ) : null}
                      {agentMeta ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void runAction(async () => {
                              const result = await pinSkill(
                                skill.name,
                                !agentMeta.pinned
                              );
                              if (!result.success) {
                                throw new Error(
                                  result.error ?? "pin 설정에 실패했습니다."
                                );
                              }
                            })
                          }
                        >
                          {agentMeta.pinned ? (
                            <>
                              <PinOff className="h-3 w-3 mr-1" />
                              unpin
                            </>
                          ) : (
                            <>
                              <Pin className="h-3 w-3 mr-1" />
                              pin
                            </>
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Curator</CardTitle>
          <CardDescription>
            에이전트가 만든 스킬의 미사용 lifecycle을 관리합니다. Hub 스킬은
            제외됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !curator ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : (
            <>
              <div className="text-sm space-y-1">
                <p>
                  상태:{" "}
                  {curator.state.paused ? (
                    <span className="text-amber-600">일시정지</span>
                  ) : curator.config.enabled ? (
                    <span className="text-green-600">활성</span>
                  ) : (
                    <span>비활성</span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  에이전트 스킬 {curator.agentCreatedCount}개 · stale{" "}
                  {curator.staleCount}개 · 실행 {curator.state.run_count}회
                </p>
                {curator.state.last_run_summary ? (
                  <p className="text-xs text-muted-foreground">
                    마지막 실행: {curator.state.last_run_summary}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {curator.state.paused ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void runAction(() => resumeCurator(), "Curator를 재개했습니다.")
                    }
                  >
                    재개
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(() => pauseCurator(), "Curator를 일시정지했습니다.")
                    }
                  >
                    일시정지
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const result = await runCurator(false);
                      setMessage(result.summary);
                    })
                  }
                >
                  지금 실행
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const result = await runCurator(true);
                      setMessage(result.summary);
                    })
                  }
                >
                  dry-run
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 border-t pt-4">
                {(
                  [
                    ["staleAfterDays", "Stale (일)", curator.config.staleAfterDays],
                    ["archiveAfterDays", "Archive (일)", curator.config.archiveAfterDays],
                    ["intervalHours", "실행 간격 (시간)", curator.config.intervalHours],
                    ["minIdleHours", "최소 idle (시간)", curator.config.minIdleHours],
                  ] as const
                ).map(([key, label, value]) => (
                  <div key={key} className="space-y-1">
                    <Label>{label}</Label>
                    <Input
                      type="number"
                      min={1}
                      disabled={busy}
                      defaultValue={value}
                      onBlur={(e) => {
                        const num = Number(e.target.value);
                        if (!Number.isFinite(num) || num < 1) return;
                        void runAction(
                          () =>
                            saveCuratorConfig({ [key]: num }).then(() => undefined),
                          "Curator 설정을 저장했습니다."
                        );
                      }}
                    />
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={curator.config.enabled}
                  disabled={busy}
                  onChange={(e) =>
                    void runAction(
                      () =>
                        saveCuratorConfig({ enabled: e.target.checked }).then(
                          () => undefined
                        ),
                      "Curator 활성화 설정을 저장했습니다."
                    )
                  }
                />
                Curator 활성화
              </label>

              {curator.archivedSkills.length > 0 ? (
                <div className="border-t pt-4 space-y-2">
                  <p className="text-sm font-medium">보관된 스킬</p>
                  <ul className="space-y-2">
                    {curator.archivedSkills.map((name) => (
                      <li
                        key={name}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span>{name}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void runAction(async () => {
                              const result = await restoreSkill(name);
                              if (!result.success) {
                                throw new Error(
                                  result.error ?? "복구에 실패했습니다."
                                );
                              }
                            }, `'${name}' 스킬을 복구했습니다.`)
                          }
                        >
                          복구
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
