import { describe, expect, it } from "vitest";
import { extractJsonObject, parseModelOutput } from "../parse.ts";
import { LlmFailedError } from "../llm.ts";

describe("parse", () => {
  it("parses fenced JSON", () => {
    const text = `\`\`\`json
{"summary":"s","findings":[],"recommendation":"r","mitre":["T1110"]}
\`\`\``;
    const out = parseModelOutput(text);
    expect(out.summary).toBe("s");
    expect(out.mitre).toEqual(["T1110"]);
  });

  it("extractJsonObject throws on garbage", () => {
    expect(() => extractJsonObject("nope")).toThrow(LlmFailedError);
  });
});
