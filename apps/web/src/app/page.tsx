import Link from "next/link";
import { MessageSquare, Server, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-8 text-center flex flex-col items-center">
        <div>
          <Image src="/icon.png" alt="MagicClaw" width={256} height={256} />
          <h1 className="text-3xl font-bold tracking-tight">MagicClaw</h1>
          <p className="text-muted-foreground mt-2">AI Agent with MCP</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="transition-colors hover:bg-accent/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                채팅
              </CardTitle>
              <CardDescription>
                도구를 사용하는 AI와 대화합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/chat">채팅</Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="transition-colors hover:bg-accent/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Server className="h-5 w-5" />
                MCP 서버
              </CardTitle>
              <CardDescription>MCP 서버를 등록하고 관리합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href="/mcp">MCP 서버 관리</Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="transition-colors hover:bg-accent/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5" />
                LLM 설정
              </CardTitle>
              <CardDescription>
                로컬 LLM 또는 OpenAI 호환 API를 설정합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href="/llm">LLM 설정 관리</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
