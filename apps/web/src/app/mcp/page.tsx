'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

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
  const [form, setForm] = useState({ name: '', command: 'npx', args: '-y @modelcontextprotocol/server-everything' });
  const [saving, setSaving] = useState(false);

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

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>← 홈</Link>
      </div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>MCP 서버 관리</h1>

      <form
        onSubmit={addServer}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', margin: 0 }}>서버 추가 (stdio)</h2>
        <input
          placeholder="이름"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          style={{
            padding: '0.5rem 0.75rem',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
          }}
        />
        <input
          placeholder="command (예: npx)"
          value={form.command}
          onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
          style={{
            padding: '0.5rem 0.75rem',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
          }}
        />
        <input
          placeholder="args (공백 구분, 예: -y @modelcontextprotocol/server-everything)"
          value={form.args}
          onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
          style={{
            padding: '0.5rem 0.75rem',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
          }}
        />
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          추가
        </button>
      </form>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>로딩 중...</p>
      ) : servers.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>등록된 MCP 서버가 없습니다. 위 폼으로 추가하세요.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {servers.map((s) => (
            <li
              key={s.id}
              style={{
                padding: '1rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong>{s.name}</strong>
                <button
                  type="button"
                  onClick={() => removeServer(s.id)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    background: 'transparent',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    fontSize: '0.85rem',
                  }}
                >
                  삭제
                </button>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                {s.command} {s.args.join(' ')}
              </div>
              {(toolsByServer[s.id]?.length ?? 0) > 0 && (
                <div style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  도구: {toolsByServer[s.id].map((t) => t.name).join(', ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
