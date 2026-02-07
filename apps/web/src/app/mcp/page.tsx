'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  MCP_CATALOG,
  getMcpCatalogByCategory,
  type McpCatalogEntry,
} from '@/data/mcp-catalog';

type McpServer = {
  id: string;
  name: string;
  type: string;
  command: string;
  args: string[];
  createdAt: string;
};

type ToolItem = { name: string; description?: string };

export default function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [toolsByServer, setToolsByServer] = useState<Record<string, ToolItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: '',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-everything',
  });
  const [saving, setSaving] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    const res = await fetch('/api/mcp/servers');
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

  const addFromCatalog = async (entry: McpCatalogEntry) => {
    if (addingId) return;
    setAddingId(entry.id);
    try {
      await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: entry.name,
          type: 'stdio',
          command: entry.command,
          args: entry.args,
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
      await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          type: 'stdio',
          command: form.command.trim() || 'npx',
          args: args.length ? args : ['-y', '@modelcontextprotocol/server-everything'],
        }),
      });
      setForm({ name: '', command: 'npx', args: '-y @modelcontextprotocol/server-everything' });
      await fetchServers();
    } finally {
      setSaving(false);
    }
  };

  const removeServer = async (id: string) => {
    if (!confirm('이 MCP 서버를 삭제할까요?')) return;
    await fetch(`/api/mcp/servers/${id}`, { method: 'DELETE' });
    await fetchServers();
  };

  const catalogByCategory = getMcpCatalogByCategory();

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">MCP 서버 관리</h1>
      </div>

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
            에서 선별한 서버입니다. 추가하기를 누르면 사용할 목록에 추가됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {Array.from(catalogByCategory.entries()).map(([category, entries]) => (
            <div key={category}>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{category}</h3>
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{entry.name}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {entry.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                          {entry.command} {entry.args.join(' ')}
                        </p>
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
          ))}
        </CardContent>
      </Card>

      {/* 수동 추가 폼 */}
      <Card>
        <CardHeader>
          <CardTitle>서버 수동 추가 (stdio)</CardTitle>
          <CardDescription>직접 command/args를 입력해 추가할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addServer} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">이름</label>
              <Input
                placeholder="예: my-mcp"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">command</label>
              <Input
                placeholder="npx"
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">args (공백 구분)</label>
              <Input
                placeholder="-y @modelcontextprotocol/server-everything"
                value={form.args}
                onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
              />
            </div>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              추가
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 사용 중인 서버 목록 */}
      <Card>
        <CardHeader>
          <CardTitle>사용 중인 MCP 서버</CardTitle>
          <CardDescription>채팅 시 이 서버들의 도구를 사용할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">로딩 중...</p>
          ) : servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              등록된 MCP 서버가 없습니다. 위 카탈로그에서 추가하기를 누르거나 수동으로 추가하세요.
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
                        {s.command} {s.args.join(' ')}
                      </p>
                      {(toolsByServer[s.id]?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {toolsByServer[s.id].slice(0, 8).map((t) => (
                            <Badge key={t.name} variant="secondary" className="text-xs">
                              {t.name}
                            </Badge>
                          ))}
                          {toolsByServer[s.id].length > 8 && (
                            <Badge variant="outline">+{toolsByServer[s.id].length - 8}</Badge>
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
    </main>
  );
}
