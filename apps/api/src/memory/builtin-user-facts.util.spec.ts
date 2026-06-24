import { extractProfileFacts } from "./builtin-user-facts.util.js";

describe("extractProfileFacts", () => {
  it("extracts Korean name statements", () => {
    const facts = extractProfileFacts("내 이름은 민수야");
    expect(facts.some((f) => f.includes("민수"))).toBe(true);
  });

  it("extracts English name statements", () => {
    const facts = extractProfileFacts("My name is Alice");
    expect(facts.some((f) => f.includes("Alice"))).toBe(true);
  });

  it("extracts remember directives", () => {
    const facts = extractProfileFacts("기억해: 커피는 아메리카노만 마셔");
    expect(facts.some((f) => f.includes("아메리카노"))).toBe(true);
  });
});
