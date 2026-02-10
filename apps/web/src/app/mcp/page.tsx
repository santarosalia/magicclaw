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
  type: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  createdAt: string;
};

type ToolItem = { name: string; description?: string };

export default function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [toolsByServer, setToolsByServer] = useState<
    Record<string, ToolItem[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: "",
    command: "",
    args: "",
    env: "",
  });
  const [saving, setSaving] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const fetchServers = useCallback(async () => {
    const res = await fetch("/api/mcp/servers");
    if (!res.ok) return;
    const data = (await res.json()) as McpServer[];
    setServers(data);
    const toolMap: Record<string, ToolItem[]> = {};
    for (const s of data) {
      const tr = await fetch(`/api/mcp/servers/${s.id}/tools`);
      const td = (await tr.json()) as { tools: ToolItem[] };
      toolMap[s.id] = td.tools ?? [];
    }
    setToolsByServer(toolMap);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchServers().finally(() => setLoading(false));
  }, [fetchServers]);

  const parseEnv = (envString: string): Record<string, string> | undefined => {
    if (!envString.trim()) return undefined;
    try {
      // JSON 형식으로 파싱 시도
      const parsed = JSON.parse(envString);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, string>;
      }
    } catch {
      // JSON이 아니면 KEY=VALUE 형식으로 파싱
      const lines = envString.split("\n").filter((line) => line.trim());
      const env: Record<string, string> = {};
      for (const line of lines) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim();
          env[key] = value;
        }
      }
      return Object.keys(env).length > 0 ? env : undefined;
    }
    return undefined;
  };

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
                            </div>
                            <p className="text-sm text-muted-foreground font-mono mt-1">
                              {s.command} {s.args.join(" ")}
                            </p>
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
