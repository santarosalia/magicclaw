/**
 * Hermes-style API mode selection for OpenAI-compatible endpoints.
 *
 * api.openai.com rejects function tools + reasoning on /v1/chat/completions
 * for gpt-5.6* (and related reasoning models). Hermes forces those hosts onto
 * the Responses API (`codex_responses`). We mirror that by enabling
 * LangChain ChatOpenAI `useResponsesApi` for the same hosts.
 */

/** Exact hostname match only — reject lookalikes and path spoofs. */
export function baseUrlHostname(baseURL: string): string | null {
  const trimmed = baseURL.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Hosts that mandate the Responses API (Hermes `host_mandated_api_mode`).
 * Empty/undefined baseURL means the OpenAI SDK default (api.openai.com).
 */
export function hostMandatedUseResponsesApi(baseURL?: string): boolean {
  const trimmed = baseURL?.trim() ?? "";
  if (!trimmed) return true;

  const hostname = baseUrlHostname(trimmed);
  if (!hostname) return false;
  return hostname === "api.openai.com" || hostname === "api.x.ai";
}

/** Whether ChatOpenAI should use `/v1/responses` instead of chat completions. */
export function shouldUseResponsesApi(opts: {
  baseURL?: string;
  model?: string;
}): boolean {
  void opts.model;
  return hostMandatedUseResponsesApi(opts.baseURL);
}
