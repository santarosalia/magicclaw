"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getMcpCatalogByCategory,
  type McpCatalogEntry,
} from "@/data/mcp-catalog";

type McpServer = {
  id: string;
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  createdAt: string;
};

type ToolItem = { name: string; description?: string };

export default function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [toolsByServer, setToolsByServer] = useState<
    Record<string, ToolItem[]>
  >({});
  const [toolErrorsByServer, setToolErrorsByServer] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: "",
    command: "",
    args: "",
    env: "",
  });
  const [urlForm, setUrlForm] = useState({
    name: "",
    url: "",
    transport: "http" as "http" | "sse",
    headers: "",
  });
  const [saving, setSaving] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const fetchServers = useCallback(async () => {
    const res = await fetch("/api/mcp/servers");
    if (!res.ok) return;
    const data = (await res.json()) as McpServer[];
    setServers(data);
    const toolMap: Record<string, ToolItem[]> = {};
    const toolErrors: Record<string, string> = {};
    for (const s of data) {
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

  const addFromCatalog = async (entry: McpCatalogEntry) => {
    if (addingId) return;
    setAddingId(entry.id);
    try {
      await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: entry.name,
          type: "stdio",
          command: entry.command,
          args: entry.args.concat(entry.customArgs ?? []),
          env: entry.env,
        }),
      });
      await fetchServers();
    } finally {
      setAddingId(null);
    }
  };

  const addServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const args = form.args.trim().split(/\s+/).filter(Boolean);
      const env = parseEnv(form.env);
      await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          type: "stdio",
          command: form.command.trim() || "npx",
          args,
          env,
        }),
      });
      setForm({
        name: "",
        command: "",
        args: "",
        env: "",
      });
      await fetchServers();
    } finally {
      setSaving(false);
    }
  };

  const addUrlServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlForm.name.trim() || !urlForm.url.trim() || savingUrl) return;
    setSavingUrl(true);
    try {
      const headers = parseKeyValueBlock(urlForm.headers);
      await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: urlForm.name.trim(),
          type: urlForm.transport,
          url: urlForm.url.trim(),
          headers,
        }),
      });
      setUrlForm({
        name: "",
        url: "",
        transport: "http",
        headers: "",
      });
      await fetchServers();
    } finally {
      setSavingUrl(false);
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

  const catalogByCategory = getMcpCatalogByCategory();

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
        {/* 왼쪽: 카탈로그 및 수동 추가 폼 */}
        <div className="lg:col-span-2 space-y-8">
          {/* 카탈로그: awesome-mcp-servers 스타일 리스트 */}
          <Card>
            <CardHeader>
              <CardTitle>MCP 서버 카탈로그</CardTitle>
              <CardDescription>
                <a
                  href="https://github.com/punkpeye/awesome-mcp-servers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  awesome-mcp-servers
                </a>
                에서 선별한 서버입니다. 추가하기를 누르면 사용할 목록에
                추가됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {Array.from(catalogByCategory.entries()).map(
                ([category, entries]) => (
                  <div key={category}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      {category}
                    </h3>
                    <ul className="space-y-2">
                      {entries.map((entry) => (
                        <li key={entry.id}>
                          <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
                            <div className="min-w-0 flex-1 space-y-2">
                              <p className="font-medium truncate">
                                <a
                                  href={entry.source ?? ""}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {entry.name}
                                </a>
                              </p>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {entry.description}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1 font-mono">
                                {entry.command} {entry.args.join(" ")}
                              </p>
                              <label className="text-sm font-medium">
                                추가 인자 (공백 구분)
                              </label>
                              <Input
                                type="text"
                                value={entry.customArgs?.join(" ")}
                                onChange={(e) =>
                                  (entry.customArgs = e.target.value.split(" "))
                                }
                              />
                              <label className="text-sm font-medium">
                                환경변수 (공백 구분)
                              </label>
                              <textarea
                                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="DATABASE_URI=postgresql://user:pass@localhost/db&#10;API_KEY=your-key"
                                value={Object.entries(entry.env ?? {})
                                  .map(([key, value]) => `${key}=${value}`)
                                  .join("\n")}
                                onChange={(e) =>
                                  (entry.env = Object.fromEntries(
                                    e.target.value
                                      .split("\n")
                                      .map((line) => line.split("="))
                                  ))
                                }
                              />
                            </div>
                            <Button
                              size="sm"
                              onClick={() => addFromCatalog(entry)}
                              disabled={addingId !== null}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              추가하기
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </CardContent>
          </Card>

          {/* 수동 추가 폼 */}
          <Card>
            <CardHeader>
              <CardTitle>서버 수동 추가 (stdio)</CardTitle>
              <CardDescription>
                직접 command/args를 입력해 추가할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={addServer} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">이름</label>
                  <Input
                    placeholder="예: my-mcp"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">command</label>
                  <Input
                    placeholder="npx"
                    value={form.command}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, command: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    args (공백 구분)
                  </label>
                  <Input
                    placeholder="-y @modelcontextprotocol/server-everything"
                    value={form.args}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, args: e.target.value }))
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
                    value={form.env}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, env: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    KEY=VALUE 형식으로 한 줄에 하나씩 입력하거나, JSON 형식으로
                    입력할 수 있습니다.
                    <br />
                    예: DATABASE_URI=postgresql://localhost/db
                  </p>
                </div>
                <Button type="submit" disabled={saving || !form.name.trim()}>
                  추가
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>URL로 추가 (HTTP / SSE)</CardTitle>
              <CardDescription>
                원격 MCP 서버 URL을 직접 등록합니다. Streamable HTTP는 http,
                레거시 SSE 엔드포인트는 sse를 선택하세요.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={addUrlServer} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">이름</label>
                  <Input
                    placeholder="예: remote-mcp"
                    value={urlForm.name}
                    onChange={(e) =>
                      setUrlForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">MCP URL</label>
                  <Input
                    placeholder="https://example.com/mcp"
                    value={urlForm.url}
                    onChange={(e) =>
                      setUrlForm((f) => ({ ...f, url: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">전송 방식</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={urlForm.transport}
                    onChange={(e) =>
                      setUrlForm((f) => ({
                        ...f,
                        transport: e.target.value as "http" | "sse",
                      }))
                    }
                  >
                    <option value="http">HTTP (Streamable HTTP)</option>
                    <option value="sse">SSE</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    요청 헤더 (선택사항)
                  </label>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Authorization=Bearer your-token&#10;X-Api-Key=your-key"
                    value={urlForm.headers}
                    onChange={(e) =>
                      setUrlForm((f) => ({ ...f, headers: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    인증이 필요한 원격 MCP에 KEY=VALUE 형식으로 헤더를
                    입력하세요.
                  </p>
                </div>
                <Button
                  type="submit"
                  disabled={
                    savingUrl || !urlForm.name.trim() || !urlForm.url.trim()
                  }
                >
                  URL로 추가
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* 오른쪽: 사용 중인 서버 목록 (Sticky) */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <Card className="flex flex-col max-h-[calc(100vh-3rem)]">
              <CardHeader>
                <CardTitle>사용 중인 MCP 서버</CardTitle>
                <CardDescription>
                  채팅 시 이 서버들의 도구를 사용할 수 있습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-y-auto flex-1">
                {loading ? (
                  <p className="text-muted-foreground text-sm">로딩 중...</p>
                ) : servers.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    등록된 MCP 서버가 없습니다. 위 카탈로그에서 추가하기를
                    누르거나 수동으로 추가하세요.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {servers.map((s) => (
                      <li key={s.id}>
                        <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold">{s.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {s.type}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground font-mono mt-1 break-all">
                              {formatServerEndpoint(s)}
                            </p>
                            {toolErrorsByServer[s.id] && (
                              <p className="text-sm text-destructive mt-2 whitespace-pre-wrap">
                                {toolErrorsByServer[s.id]}
                              </p>
                            )}
                            {s.headers && Object.keys(s.headers).length > 0 && (
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
                                  {Object.entries(s.env).map(([key, value]) => (
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
                                  ))}
                                </div>
                              </div>
                            )}
                            {(toolsByServer[s.id]?.length ?? 0) > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {toolsByServer[s.id].slice(0, 8).map((t) => (
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
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => removeServer(s.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
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
