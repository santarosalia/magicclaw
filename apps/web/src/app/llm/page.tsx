'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Trash2, Star, StarOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useLlmStatus } from '@/lib/llm-status-context';

type ContextWindowSource = 'api' | 'heuristic' | 'manual' | 'fallback';

type LlmConfig = {
  id: string;
  name: string;
  baseURL: string;
  model: string;
  apiKey?: string;
  createdAt: string;
  isDefault?: boolean;
  contextWindow?: number;
  contextWindowSource?: ContextWindowSource;
  contextWindowCheckedAt?: string;
};

const SOURCE_LABEL: Record<ContextWindowSource, string> = {
  api: 'API',
  heuristic: '추정',
  manual: '수동',
  fallback: '폴백',
};

function formatContextWindow(config: LlmConfig): string {
  if (!config.contextWindow) return '미확인';
  const source = config.contextWindowSource
    ? SOURCE_LABEL[config.contextWindowSource]
    : '?';
  return `${config.contextWindow.toLocaleString()} (${source})`;
}

export default function LlmPage() {
  const { refreshLlmStatus } = useLlmStatus();
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: '',
    baseURL: 'http://localhost:11434/v1',
    model: 'llama3.2',
    apiKey: '',
    contextWindow: '',
  });
  const [saving, setSaving] = useState(false);
  const [editingContextId, setEditingContextId] = useState<string | null>(null);
  const [editContextValue, setEditContextValue] = useState('');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    const res = await fetch('/api/llm/configs');
    if (!res.ok) return;
    const data = (await res.json()) as LlmConfig[];
    setConfigs(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchConfigs().finally(() => setLoading(false));
  }, [fetchConfigs]);

  const addConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.baseURL.trim() || !form.model.trim() || saving) return;
    setSaving(true);
    try {
      const parsedWindow = form.contextWindow.trim()
        ? Number(form.contextWindow.trim())
        : undefined;
      await fetch('/api/llm/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          baseURL: form.baseURL.trim(),
          model: form.model.trim(),
          apiKey: form.apiKey.trim() || undefined,
          ...(parsedWindow && Number.isFinite(parsedWindow) && parsedWindow > 0
            ? { contextWindow: Math.floor(parsedWindow) }
            : {}),
        }),
      });
      setForm({
        name: '',
        baseURL: 'http://localhost:11434/v1',
        model: 'llama3.2',
        apiKey: '',
        contextWindow: '',
      });
      await fetchConfigs();
      refreshLlmStatus();
    } finally {
      setSaving(false);
    }
  };

  const saveContextWindow = async (id: string) => {
    const n = Number(editContextValue.trim());
    if (!Number.isFinite(n) || n <= 0) return;
    await fetch(`/api/llm/configs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextWindow: Math.floor(n) }),
    });
    setEditingContextId(null);
    await fetchConfigs();
    refreshLlmStatus();
  };

  const refreshContextWindow = async (id: string) => {
    setRefreshingId(id);
    try {
      await fetch(`/api/llm/configs/${id}/refresh-context-window`, {
        method: 'POST',
      });
      await fetchConfigs();
      refreshLlmStatus();
    } finally {
      setRefreshingId(null);
    }
  };

  const setDefault = async (id: string) => {
    const res = await fetch(`/api/llm/configs/${id}/default`, { method: 'POST' });
    if (!res.ok) return;
    await fetchConfigs();
    refreshLlmStatus();
  };

  const removeConfig = async (id: string) => {
    if (!confirm('이 LLM 설정을 삭제할까요?')) return;
    await fetch(`/api/llm/configs/${id}`, { method: 'DELETE' });
    await fetchConfigs();
    refreshLlmStatus();
  };

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">LLM 설정 관리</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>LLM 설정 추가</CardTitle>
          <CardDescription>
            로컬 LLM 서버(Ollama, LM Studio 등) 또는 OpenAI 호환 API를 설정할 수 있습니다.
            Context window는 연결 시 자동 조회되며, 필요하면 수동으로 지정할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addConfig} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">이름</label>
              <Input
                placeholder="예: 로컬 Ollama"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Base URL</label>
              <Input
                placeholder="http://localhost:11434/v1"
                value={form.baseURL}
                onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
                required
              />
              <p className="text-xs text-muted-foreground">
                예: Ollama - http://localhost:11434/v1, LM Studio - http://localhost:1234/v1
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Model</label>
              <Input
                placeholder="llama3.2"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                required
              />
              <p className="text-xs text-muted-foreground">
                사용할 모델 이름을 입력하세요 (예: llama3.2, gpt-4o-mini)
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Context window (선택)</label>
              <Input
                type="number"
                min={1}
                placeholder="비우면 연결 시 자동 조회"
                value={form.contextWindow}
                onChange={(e) =>
                  setForm((f) => ({ ...f, contextWindow: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                토큰 단위. 입력하면 수동(manual)으로 고정되고 자동 조회가 덮어쓰지 않습니다.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key (선택사항)</label>
              <Input
                type="password"
                placeholder="API 키가 필요한 경우 입력"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                로컬 LLM의 경우 대부분 필요 없습니다.
              </p>
            </div>
            <Button type="submit" disabled={saving || !form.name.trim() || !form.baseURL.trim() || !form.model.trim()}>
              추가
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>LLM 설정 목록</CardTitle>
          <CardDescription>
            채팅 시 기본값으로 설정된 LLM이 사용됩니다. 별표를 클릭하여 기본값을 변경할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">로딩 중...</p>
          ) : configs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              등록된 LLM 설정이 없습니다. 위 폼에서 설정을 추가하세요.
            </p>
          ) : (
            <ul className="space-y-3">
              {configs.map((config) => (
                <li key={config.id}>
                  <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{config.name}</span>
                        {config.isDefault && (
                          <Badge variant="default" className="text-xs">
                            기본값
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">Base URL:</span>{' '}
                          <span className="font-mono">{config.baseURL}</span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">Model:</span>{' '}
                          <span className="font-mono">{config.model}</span>
                        </p>
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">Context window:</span>{' '}
                          {editingContextId === config.id ? (
                            <span className="inline-flex items-center gap-2 mt-1">
                              <Input
                                className="h-8 w-36 font-mono"
                                type="number"
                                min={1}
                                value={editContextValue}
                                onChange={(e) => setEditContextValue(e.target.value)}
                              />
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => saveContextWindow(config.id)}
                              >
                                저장
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingContextId(null)}
                              >
                                취소
                              </Button>
                            </span>
                          ) : (
                            <span className="font-mono">
                              {formatContextWindow(config)}
                            </span>
                          )}
                        </div>
                        {config.apiKey && (
                          <p className="text-xs text-muted-foreground">
                            API Key: ••••••••
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingContextId(config.id);
                          setEditContextValue(
                            config.contextWindow ? String(config.contextWindow) : ''
                          );
                        }}
                        title="Context window 수동 수정"
                      >
                        수정
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={refreshingId === config.id}
                        onClick={() => refreshContextWindow(config.id)}
                        title="Context window 다시 조회 (수동값도 덮어씀)"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${
                            refreshingId === config.id ? 'animate-spin' : ''
                          }`}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDefault(config.id)}
                        title={config.isDefault ? '기본값 해제' : '기본값으로 설정'}
                      >
                        {config.isDefault ? (
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        ) : (
                          <StarOff className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => removeConfig(config.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
