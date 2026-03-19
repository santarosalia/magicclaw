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

  type TelegramDmPolicy = "pairing" | "allowlist" | "open" | "disabled";
  const [dmPolicy, setDmPolicy] = useState<TelegramDmPolicy>("pairing");
  const [allowFromText, setAllowFromText] = useState("");
  const [pairedFromText, setPairedFromText] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);

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

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`${baseUrl}/messenger/telegram/config`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          dmPolicy?: TelegramDmPolicy;
          allowFrom?: string[];
          pairedFrom?: string[];
        };
        if (data.dmPolicy) setDmPolicy(data.dmPolicy);
        if (Array.isArray(data.allowFrom)) {
          setAllowFromText(data.allowFrom.join("\n"));
        }
        if (Array.isArray(data.pairedFrom)) {
          setPairedFromText(data.pairedFrom.join("\n"));
        }
      } catch {
        // ignore
      } finally {
        setLoadingConfig(false);
      }
    };

    fetchConfig();
  }, [baseUrl]);

  const parseAllowFrom = () => {
    return allowFromText
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter(Boolean);
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

  const handleConnectAndSavePolicy = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // 1) 연결이 안 되어있으면 토큰부터 저장
      if (!isConnected) {
        const token = telegramToken.trim();
        if (!token) return;

        const tokenRes = await fetch(`${baseUrl}/messenger/telegram/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ botToken: token }),
        });
        if (!tokenRes.ok) return;

        setIsConnected(true);
        setTelegramToken("");
      }

      // 2) DM 접근제어 정책 저장(연결 전/후 공통)
      const allowFrom = parseAllowFrom();
      const cfgRes = await fetch(`${baseUrl}/messenger/telegram/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dmPolicy,
          allowFrom,
        }),
      });
      if (!cfgRes.ok) return;
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
            메신저를 MagicClaw 에이전트와 연결합니다.
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
                disabled={isConnected || saving}
              />
              <p className="text-xs text-muted-foreground">
                BotFather 에서 발급받은 텔레그램 봇 토큰을 입력하세요.
              </p>
            </div>

            <div className="text-sm text-muted-foreground">
              상태:{" "}
              <span
                className={
                  isConnected ? "text-emerald-500 font-medium" : "text-red-500"
                }
              >
                {loadingStatus
                  ? "확인 중..."
                  : isConnected
                  ? "연결됨"
                  : "연결 안 됨"}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="telegram-dm-policy">DM 접근제어 (dmPolicy)</Label>
              <select
                id="telegram-dm-policy"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={dmPolicy}
                disabled={loadingConfig || saving}
                onChange={(e) =>
                  setDmPolicy(e.target.value as TelegramDmPolicy)
                }
              >
                <option value="pairing">pairing</option>
                <option value="allowlist">allowlist</option>
                <option value="open">open</option>
                <option value="disabled">disabled</option>
              </select>
              <p className="text-xs text-muted-foreground">
                `pairing`은 이 프로젝트에서 “처음 접속자를 자동으로 pairedFrom에
                등록” 하는 방식으로 동작합니다.
              </p>
            </div>

            {dmPolicy !== "pairing" && dmPolicy !== "disabled" ? (
              <div className="space-y-2">
                <Label htmlFor="telegram-allow-from">
                  allowFrom (Telegram user ID)
                </Label>
                <textarea
                  id="telegram-allow-from"
                  className="w-full min-h-[110px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={allowFromText}
                  disabled={dmPolicy !== "allowlist" || loadingConfig || saving}
                  onChange={(e) => setAllowFromText(e.target.value)}
                  placeholder={"123456789\ntelegram:987654321\ntg:111222333"}
                />
                <p className="text-xs text-muted-foreground">
                  콤마(,) 또는 줄바꿈으로 구분해서 입력하세요. 숫자 Telegram
                  user ID만 유효합니다.
                </p>
              </div>
            ) : null}

            {dmPolicy === "pairing" ? (
              <div className="space-y-2">
                <Label htmlFor="telegram-paired-from">
                  pairedFrom (Telegram user ID)
                </Label>
                <textarea
                  id="telegram-paired-from"
                  className="w-full min-h-[110px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={pairedFromText}
                  disabled={true}
                  readOnly={true}
                  placeholder={"아직 pairedFrom이 비어있습니다."}
                />
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
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
                onClick={handleConnectAndSavePolicy}
                disabled={loadingConfig || saving}
              >
                {saving
                  ? "저장 중..."
                  : isConnected
                  ? "정책 저장"
                  : "연결하기 & 정책 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
