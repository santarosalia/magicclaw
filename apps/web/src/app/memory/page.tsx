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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMemoryStatus,
  setupMem0,
  setupMemory,
  turnOffMemoryProvider,
  type Mem0Mode,
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

  const saveMem0 = useCallback(
    async (patch: Parameters<typeof setupMem0>[0]) => {
      setSaving(true);
      setError(null);
      try {
        await setupMem0(patch);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const mem0 = status?.config.mem0;
  const mem0Mode: Mem0Mode = mem0?.mode === "oss" ? "oss" : "platform";
  const oss = mem0?.oss;

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
                    {!p.available ? ` (${p.hint ?? "사용 불가"})` : ""}
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
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mem0 설정</CardTitle>
          <CardDescription>
            Platform(클라우드) 또는 Self-hosted(OSS) 모드를 선택합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !status ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={mem0Mode === "platform" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => void saveMem0({ mode: "platform" })}
                >
                  Platform (클라우드)
                </Button>
                <Button
                  size="sm"
                  variant={mem0Mode === "oss" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => void saveMem0({ mode: "oss" })}
                >
                  Self-hosted (OSS)
                </Button>
              </div>

              {mem0Mode === "platform" ? (
                <p className="text-xs text-muted-foreground">
                  API 서버 환경변수 <code>MEM0_API_KEY</code>를 설정한 뒤 mem0
                  provider를 활성화하세요. 키는{" "}
                  <a
                    className="underline"
                    href="https://app.mem0.ai"
                    target="_blank"
                    rel="noreferrer"
                  >
                    app.mem0.ai
                  </a>
                  에서 발급할 수 있습니다.
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    OSS 모드는 API 서버에서 로컬 Mem0를 실행합니다. OpenAI
                    기반 기본값은 <code>OPENAI_API_KEY</code>가 필요합니다.
                    Ollama를 쓰려면 provider를 ollama로 바꾸세요.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="mem0-llm-provider">LLM</Label>
                      <select
                        id="mem0-llm-provider"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        disabled={saving}
                        value={oss?.llm.provider ?? "openai"}
                        onChange={(e) =>
                          void saveMem0({
                            oss: {
                              llm: {
                                provider: e.target.value,
                                config: oss?.llm.config ?? {},
                              },
                            },
                          })
                        }
                      >
                        <option value="openai">openai</option>
                        <option value="ollama">ollama</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="mem0-embedder-provider">Embedder</Label>
                      <select
                        id="mem0-embedder-provider"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        disabled={saving}
                        value={oss?.embedder.provider ?? "openai"}
                        onChange={(e) =>
                          void saveMem0({
                            oss: {
                              embedder: {
                                provider: e.target.value,
                                config: oss?.embedder.config ?? {},
                              },
                            },
                          })
                        }
                      >
                        <option value="openai">openai</option>
                        <option value="ollama">ollama</option>
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="mem0-vector-provider">Vector Store</Label>
                      <select
                        id="mem0-vector-provider"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        disabled={saving}
                        value={oss?.vectorStore.provider ?? "memory"}
                        onChange={(e) =>
                          void saveMem0({
                            oss: {
                              vectorStore: {
                                provider: e.target.value,
                                config: oss?.vectorStore.config ?? {},
                              },
                            },
                          })
                        }
                      >
                        <option value="memory">memory (인메모리, 기본)</option>
                        <option value="qdrant">qdrant (로컬/서버)</option>
                        <option value="pgvector">pgvector</option>
                      </select>
                    </div>
                  </div>

                  {oss?.vectorStore.provider === "qdrant" ? (
                    <div className="space-y-1">
                      <Label htmlFor="mem0-qdrant-path">Qdrant path</Label>
                      <Input
                        id="mem0-qdrant-path"
                        disabled={saving}
                        placeholder="~/.magicclaw/mem0_qdrant"
                        defaultValue={String(
                          oss.vectorStore.config.path ?? "~/.magicclaw/mem0_qdrant"
                        )}
                        onBlur={(e) =>
                          void saveMem0({
                            oss: {
                              vectorStore: {
                                provider: "qdrant",
                                config: {
                                  ...oss.vectorStore.config,
                                  path: e.target.value,
                                },
                              },
                            },
                          })
                        }
                      />
                    </div>
                  ) : null}

                  {oss?.vectorStore.provider === "pgvector" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          ["host", "Host", "localhost"],
                          ["port", "Port", "5432"],
                          ["user", "User", "postgres"],
                          ["dbname", "Database", "postgres"],
                        ] as const
                      ).map(([key, label, placeholder]) => (
                        <div key={key} className="space-y-1">
                          <Label>{label}</Label>
                          <Input
                            disabled={saving}
                            placeholder={placeholder}
                            defaultValue={String(
                              oss.vectorStore.config[key] ?? placeholder
                            )}
                            onBlur={(e) =>
                              void saveMem0({
                                oss: {
                                  vectorStore: {
                                    provider: "pgvector",
                                    config: {
                                      ...oss.vectorStore.config,
                                      [key]:
                                        key === "port"
                                          ? Number(e.target.value)
                                          : e.target.value,
                                    },
                                  },
                                },
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    설정 저장 후 mem0 버튼으로 provider를 활성화하세요. 데이터는{" "}
                    <code>~/.magicclaw/config/</code> 아래에 저장됩니다.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
