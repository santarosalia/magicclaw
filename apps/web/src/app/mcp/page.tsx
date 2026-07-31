"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type McpServer = {
  id: string;
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  createdAt: string;
};

type ToolItem = { name: string; description?: string };

type McpConnectionMode = "stdio" | "http" | "sse";

const EMPTY_MANUAL_FORM = {
  name: "",
  mode: "stdio" as McpConnectionMode,
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
};

export default function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [toolsByServer, setToolsByServer] = useState<
    Record<string, ToolItem[]>
  >({});
  const [toolErrorsByServer, setToolErrorsByServer] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const isServerEnabled = (server: McpServer) => server.enabled !== false;
  const fetchServers = useCallback(async () => {
    const res = await fetch("/api/mcp/servers");
    if (!res.ok) return;
    const data = (await res.json()) as McpServer[];
    setServers(data);
    const toolMap: Record<string, ToolItem[]> = {};
    const toolErrors: Record<string, string> = {};
    for (const s of data) {
      if (!isServerEnabled(s)) continue;
      const tr = await fetch(`/api/mcp/servers/${s.id}/tools`);
      const td = (await tr.json()) as { tools: ToolItem[]; error?: string };
      toolMap[s.id] = td.tools ?? [];
      if (td.error) toolErrors[s.id] = td.error;
    }
    setToolsByServer(toolMap);
    setToolErrorsByServer(toolErrors);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchServers().finally(() => setLoading(false));
  }, [fetchServers]);

  const parseKeyValueBlock = (
    raw: string
  ): Record<string, string> | undefined => {
    if (!raw.trim()) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, string>;
      }
    } catch {
      const lines = raw.split("\n").filter((line) => line.trim());
      const result: Record<string, string> = {};
      for (const line of lines) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          result[match[1].trim()] = match[2].trim();
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
    return undefined;
  };

  const parseEnv = parseKeyValueBlock;

  const isRemoteMode =
    manualForm.mode === "http" || manualForm.mode === "sse";

  const canSubmitManual =
    manualForm.name.trim() &&
    (isRemoteMode
      ? manualForm.url.trim()
      : manualForm.command.trim() || manualForm.args.trim());

  const addManualServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitManual || saving) return;
    setSaving(true);
    try {
      const body = isRemoteMode
        ? {
            name: manualForm.name.trim(),
            type: manualForm.mode,
            url: manualForm.url.trim(),
            headers: parseKeyValueBlock(manualForm.headers),
          }
        : {
            name: manualForm.name.trim(),
            type: "stdio" as const,
            command: manualForm.command.trim() || "npx",
            args: manualForm.args.trim().split(/\s+/).filter(Boolean),
            env: parseEnv(manualForm.env),
          };

      await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setManualForm(EMPTY_MANUAL_FORM);
      await fetchServers();
    } finally {
      setSaving(false);
    }
  };

  const formatServerEndpoint = (server: McpServer): string => {
    if (server.type === "http" || server.type === "sse") {
      return server.url ?? "";
    }
    return `${server.command ?? ""} ${(server.args ?? []).join(" ")}`.trim();
  };

  const removeServer = async (id: string) => {
    if (!confirm("이 MCP 서버를 삭제할까요?")) return;
    await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
    await fetchServers();
  };

  const toggleServerEnabled = async (server: McpServer, enabled: boolean) => {
    if (togglingId) return;
    setTogglingId(server.id);
    try {
      await fetch(`/api/mcp/servers/${server.id}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await fetchServers();
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <main className="w-full min-h-screen p-6">
      <div className="flex items-center gap-2 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">MCP 서버 관리</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>서버 추가</CardTitle>
              <CardDescription>
                로컬 stdio 프로세스 또는 원격 MCP URL로 서버를 등록합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={addManualServer} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">이름</label>
                  <Input
                    placeholder="예: my-mcp"
                    value={manualForm.name}
                    onChange={(e) =>
                      setManualForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">연결 방식</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={manualForm.mode}
                    onChange={(e) =>
                      setManualForm((f) => ({
                        ...f,
                        mode: e.target.value as McpConnectionMode,
                      }))
                    }
                  >
                    <option value="stdio">stdio (로컬 프로세스)</option>
                    <option value="http">URL — HTTP (Streamable HTTP)</option>
                    <option value="sse">URL — SSE</option>
                  </select>
                </div>

                {isRemoteMode ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">MCP URL</label>
                      <Input
                        placeholder="https://example.com/mcp"
                        value={manualForm.url}
                        onChange={(e) =>
                          setManualForm((f) => ({ ...f, url: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        요청 헤더 (선택사항)
                      </label>
                      <textarea
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="Authorization=Bearer your-token&#10;X-Api-Key=your-key"
                        value={manualForm.headers}
                        onChange={(e) =>
                          setManualForm((f) => ({
                            ...f,
                            headers: e.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        인증이 필요한 원격 MCP에 KEY=VALUE 형식으로 헤더를
                        입력하세요.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">command</label>
                      <Input
                        placeholder="npx"
                        value={manualForm.command}
                        onChange={(e) =>
                          setManualForm((f) => ({
                            ...f,
                            command: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        args (공백 구분)
                      </label>
                      <Input
                        placeholder="-y @modelcontextprotocol/server-everything"
                        value={manualForm.args}
                        onChange={(e) =>
                          setManualForm((f) => ({ ...f, args: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        환경 변수 (선택사항)
                      </label>
                      <textarea
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="DATABASE_URI=postgresql://user:pass@localhost/db&#10;API_KEY=your-key"
                        value={manualForm.env}
                        onChange={(e) =>
                          setManualForm((f) => ({ ...f, env: e.target.value }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        KEY=VALUE 형식으로 한 줄에 하나씩 입력하거나, JSON
                        형식으로 입력할 수 있습니다.
                      </p>
                    </div>
                  </>
                )}

                <Button type="submit" disabled={saving || !canSubmitManual}>
                  추가
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <Card className="flex flex-col max-h-[calc(100vh-3rem)]">
              <CardHeader>
                <CardTitle>사용 중인 MCP 서버</CardTitle>
                <CardDescription>
                  채팅 시 활성화된 서버의 도구만 사용할 수 있습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-y-auto flex-1">
                {loading ? (
                  <p className="text-muted-foreground text-sm">로딩 중...</p>
                ) : servers.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    등록된 MCP 서버가 없습니다. 왼쪽에서 수동으로 추가하세요.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {servers.map((s) => {
                      const enabled = isServerEnabled(s);
                      return (
                        <li key={s.id}>
                          <div
                            className={`flex items-start justify-between gap-4 rounded-lg border bg-card p-4 ${
                              !enabled ? "opacity-60" : ""
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">{s.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {s.type}
                                </Badge>
                                {!enabled && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    비활성
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground font-mono mt-1 break-all">
                                {formatServerEndpoint(s)}
                              </p>
                              {enabled && toolErrorsByServer[s.id] && (
                                <p className="text-sm text-destructive mt-2 whitespace-pre-wrap">
                                  {toolErrorsByServer[s.id]}
                                </p>
                              )}
                              {!enabled && (
                                <p className="text-sm text-muted-foreground mt-2">
                                  비활성화된 서버는 채팅에서 사용되지 않습니다.
                                </p>
                              )}
                              {s.headers &&
                                Object.keys(s.headers).length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground">
                                      요청 헤더:
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                      {Object.entries(s.headers).map(
                                        ([key, value]) => (
                                          <Badge
                                            key={key}
                                            variant="outline"
                                            className="text-xs font-mono"
                                          >
                                            {key}=
                                            {value.length > 20
                                              ? `${value.substring(0, 20)}...`
                                              : value}
                                          </Badge>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}
                              {s.env && Object.keys(s.env).length > 0 && (
                                <div className="mt-2 space-y-1">
                                  <p className="text-xs font-medium text-muted-foreground">
                                    환경 변수:
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {Object.entries(s.env).map(
                                      ([key, value]) => (
                                        <Badge
                                          key={key}
                                          variant="outline"
                                          className="text-xs font-mono"
                                        >
                                          {key}=
                                          {value.length > 20
                                            ? `${value.substring(0, 20)}...`
                                            : value}
                                        </Badge>
                                      )
                                    )}
                                  </div>
                                </div>
                              )}
                              {enabled &&
                                (toolsByServer[s.id]?.length ?? 0) > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {toolsByServer[s.id]
                                      .slice(0, 8)
                                      .map((t) => (
                                        <Badge
                                          key={t.name}
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {t.name}
                                        </Badge>
                                      ))}
                                    {toolsByServer[s.id].length > 8 && (
                                      <Badge variant="outline">
                                        +{toolsByServer[s.id].length - 8}
                                      </Badge>
                                    )}
                                  </div>
                                )}
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <Switch
                                id={`mcp-enabled-${s.id}`}
                                checked={enabled}
                                disabled={togglingId === s.id}
                                aria-label={`${s.name} ${enabled ? "비활성화" : "활성화"}`}
                                onCheckedChange={(checked) =>
                                  void toggleServerEnabled(s, checked)
                                }
                              />
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => removeServer(s.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
