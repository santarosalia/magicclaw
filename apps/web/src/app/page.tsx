import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: '2rem', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>MagicClaw</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>
        AI 에이전트 + MCP 서버 관리 (openclaw 참고)
      </p>
      <nav style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <Link
          href="/chat"
          style={{
            padding: '0.75rem 1.25rem',
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 8,
            fontWeight: 600,
          }}
        >
          채팅 (도구 사용)
        </Link>
        <Link
          href="/mcp"
          style={{
            padding: '0.75rem 1.25rem',
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontWeight: 600,
          }}
        >
          MCP 서버 관리
        </Link>
      </nav>
    </main>
  );
}
