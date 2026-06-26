import { formatMcpConnectionError } from "./mcp-connection-error.util.js";

describe("formatMcpConnectionError", () => {
  it("maps connection refused to a helpful message", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    });
    expect(formatMcpConnectionError(error)).toContain("Connection refused");
  });
});
