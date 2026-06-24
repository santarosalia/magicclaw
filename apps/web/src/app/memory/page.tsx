"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getMemoryStatus,
  setupMemory,
  turnOffMemoryProvider,
  type MemoryStatusResponse,
} from "@/lib/memory-api";

export default function MemoryPage() {
  const [status, setStatus] = useState<MemoryStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getMemoryStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (patch: {
      provider?: string;
      memoryEnabled?: boolean;
      userProfileEnabled?: boolean;
    }) => {
      setSaving(true);
      setError(null);
      try {
        await setupMemory(patch);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">메모리 설정</h1>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>내장 메모리 (MEMORY.md / USER.md)</CardTitle>
          <CardDescription>
            에이전트가 대화 간 유지하는 큐레이션 메모리입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading || !status ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={status.config.memoryEnabled}
                  disabled={saving}
                  onChange={(e) =>
                    void save({ memoryEnabled: e.target.checked })
                  }
                />
                MEMORY.md 활성화
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={status.config.userProfileEnabled}
                  disabled={saving}
                  onChange={(e) =>
                    void save({ userProfileEnabled: e.target.checked })
                  }
                />
                USER.md 활성화
              </label>
              <p className="text-xs text-muted-foreground">
                한도: MEMORY {status.config.memoryCharLimit}자 / USER{" "}
                {status.config.userCharLimit}자 / 컨텍스트{" "}
                {status.config.maxContextMessages}메시지
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>외부 메모리 Provider</CardTitle>
          <CardDescription>
            시맨틱 장기 메모리 (현재 1개만 활성화 가능)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status ? (
            <>
              <p className="text-sm">
                현재: {status.status.provider || "없음 (내장만)"}
                {status.status.externalName
                  ? ` — ${status.status.externalAvailable ? "사용 가능" : "사용 불가"}`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {status.bundledProviders.map((p) => (
                  <Button
                    key={p.name}
                    variant={
                      status.config.provider === p.name ? "default" : "outline"
                    }
                    size="sm"
                    disabled={saving || !p.available}
                    onClick={() => void save({ provider: p.name })}
                  >
                    {p.name}
                    {!p.available ? " (키 없음)" : ""}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => void turnOffMemoryProvider().then(refresh)}
                >
                  끄기
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Mem0 사용 시 서버 환경변수 MEM0_API_KEY를 설정하세요.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
