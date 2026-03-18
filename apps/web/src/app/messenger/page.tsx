"use client";

import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
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

export default function MessengerSettingsPage() {
  const [telegramToken, setTelegramToken] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [saving, setSaving] = useState(false);

  const apiOrigin =
    process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
  const baseUrl = apiOrigin.replace(/\/$/, "");

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${baseUrl}/messenger/telegram/status`);
        if (!res.ok) return;
        const data = (await res.json()) as { hasToken: boolean };
        setIsConnected(data.hasToken);
      } catch {
        // ignore for now; UI는 기본값(연결 안 됨) 유지
      } finally {
        setLoadingStatus(false);
      }
    };
    fetchStatus();
  }, [baseUrl]);

  const handleConnect = async () => {
    const token = telegramToken.trim();
    if (!token || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/messenger/telegram/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ botToken: token }),
      });
      if (res.ok) {
        setIsConnected(true);
        setTelegramToken("");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!isConnected || saving) return;
    setSaving(true);
    try {
      await fetch(`${baseUrl}/messenger/telegram/token`, {
        method: "DELETE",
      });
      setIsConnected(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col p-6">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold">메신저 설정</h1>
          <p className="text-sm text-muted-foreground">
            텔레그램을 MagicClaw 에이전트와 연결합니다.
          </p>
        </div>
      </div>

      <div className="max-w-xl space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <MessageCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">텔레그램</CardTitle>
              <CardDescription>
                텔레그램 봇을 통해 MagicClaw 에이전트와 대화할 수 있습니다.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="telegram-token">봇 토큰</Label>
              <Input
                id="telegram-token"
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              />
              <p className="text-xs text-muted-foreground">
                BotFather 에서 발급받은 텔레그램 봇 토큰을 입력하세요.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                상태:{" "}
                <span
                  className={
                    isConnected
                      ? "text-emerald-500 font-medium"
                      : "text-red-500"
                  }
                >
                  {loadingStatus
                    ? "확인 중..."
                    : isConnected
                    ? "연결됨"
                    : "연결 안 됨"}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleDisconnect}
                  disabled={!isConnected || saving}
                >
                  연결 해제
                </Button>
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={!telegramToken.trim() || saving}
                >
                  {saving ? "저장 중..." : "연결하기"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
