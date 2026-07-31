import {
  hostMandatedUseResponsesApi,
  resolveChatOpenAIOptions,
  shouldUseResponsesApi,
} from "./api-mode.util.js";

describe("api-mode.util", () => {
  describe("hostMandatedUseResponsesApi", () => {
    it("forces Responses for api.openai.com", () => {
      expect(hostMandatedUseResponsesApi("https://api.openai.com/v1")).toBe(
        true
      );
      expect(hostMandatedUseResponsesApi("https://api.openai.com")).toBe(true);
    });

    it("forces Responses for api.x.ai", () => {
      expect(hostMandatedUseResponsesApi("https://api.x.ai/v1")).toBe(true);
    });

    it("does not force Responses for generic OpenAI-compatible hosts", () => {
      expect(hostMandatedUseResponsesApi("http://localhost:11434/v1")).toBe(
        false
      );
      expect(
        hostMandatedUseResponsesApi("https://openrouter.ai/api/v1")
      ).toBe(false);
      expect(
        hostMandatedUseResponsesApi("https://api.openai.com.attacker.test/v1")
      ).toBe(false);
      expect(
        hostMandatedUseResponsesApi("https://proxy.test/api.openai.com/v1")
      ).toBe(false);
    });

    it("treats empty/undefined baseURL as OpenAI default host", () => {
      expect(hostMandatedUseResponsesApi(undefined)).toBe(true);
      expect(hostMandatedUseResponsesApi("")).toBe(true);
      expect(hostMandatedUseResponsesApi("   ")).toBe(true);
    });
  });

  describe("shouldUseResponsesApi", () => {
    it("enables Responses for gpt-5.6 on api.openai.com (tools+reasoning path)", () => {
      expect(
        shouldUseResponsesApi({
          baseURL: "https://api.openai.com/v1",
          model: "gpt-5.6-sol",
        })
      ).toBe(true);
    });

    it("keeps chat completions for local models even if name looks like gpt-5", () => {
      expect(
        shouldUseResponsesApi({
          baseURL: "http://localhost:11434/v1",
          model: "gpt-5.6-sol",
        })
      ).toBe(false);
    });
  });

  describe("resolveChatOpenAIOptions", () => {
    it("keeps streaming on for Responses hosts (Hermes-style SSE path)", () => {
      const opts = resolveChatOpenAIOptions({
        model: "gpt-5.6-sol",
        apiKey: "sk-test",
        maxTokens: 4096,
        baseURL: "https://api.openai.com/v1",
      });
      expect(opts.useResponsesApi).toBe(true);
      expect(opts.streaming).toBe(true);
    });

    it("keeps streaming on for chat-completions hosts", () => {
      const opts = resolveChatOpenAIOptions({
        model: "llama3",
        apiKey: "not-needed",
        maxTokens: 2048,
        baseURL: "http://localhost:11434/v1",
      });
      expect(opts.useResponsesApi).toBe(false);
      expect(opts.streaming).toBe(true);
      expect(opts.configuration).toEqual({
        baseURL: "http://localhost:11434/v1",
      });
    });
  });
});
