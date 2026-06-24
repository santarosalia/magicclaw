import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractProfileFacts } from "../dist/memory/builtin-user-facts.util.js";

describe("extractProfileFacts", () => {
  it("extracts Korean name statements", () => {
    const facts = extractProfileFacts("내 이름은 민수야");
    assert.ok(facts.some((f) => f.includes("민수")));
  });

  it("extracts English name statements", () => {
    const facts = extractProfileFacts("My name is Alice");
    assert.ok(facts.some((f) => f.includes("Alice")));
  });

  it("extracts remember directives", () => {
    const facts = extractProfileFacts("기억해: 커피는 아메리카노만 마셔");
    assert.ok(facts.some((f) => f.includes("아메리카노")));
  });
});
