import { describe, it, expect } from "vitest";
import {
  placeholderCommunityLabels,
  communityLabelLines,
  parseLabelResponse,
} from "../src/llm/index.js";


describe("placeholderCommunityLabels", () => {
  it("assigns Community N to each id", () => {
    const communities = { 0: ["a", "b"], 1: ["c"], 5: ["d", "e"] };
    const labels = placeholderCommunityLabels(communities);
    expect(labels[0]).toBe("Community 0");
    expect(labels[1]).toBe("Community 1");
    expect(labels[5]).toBe("Community 5");
  });

  it("handles empty communities", () => {
    const labels = placeholderCommunityLabels({});
    expect(Object.keys(labels)).toHaveLength(0);
  });
});

describe("communityLabelLines", () => {
  const G = {
    nodes: {
      n1: { label: "authService" },
      n2: { label: "userService" },
      n3: { label: "dbLayer" },
      n4: { label: "cache" },
    },
  };

  it("produces label lines sorted by community size descending", () => {
    const communities = { 0: ["n1", "n2", "n3"], 1: ["n4"] };
    const { lines, labeledCids } = communityLabelLines(G, communities, null, 200, 12);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Community 0");
    expect(labeledCids).toContain(0);
    expect(labeledCids).toContain(1);
  });

  it("prioritises god nodes", () => {
    const communities = { 0: ["n1", "n2", "n3", "n4"] };
    const gods = ["n3"];
    const { lines } = communityLabelLines(G, communities, gods, 200, 12);
    // dbLayer (god) should appear first in the list
    const firstLine = lines[0];
    const dbIdx = firstLine.indexOf("dbLayer");
    const authIdx = firstLine.indexOf("authService");
    expect(dbIdx).toBeLessThan(authIdx);
  });

  it("respects maxCommunities limit", () => {
    const communities: Record<number, string[]> = {};
    for (let i = 0; i < 10; i++) communities[i] = [`n${i}`];
    const { labeledCids } = communityLabelLines(G, communities, null, 3, 12);
    expect(labeledCids.length).toBeLessThanOrEqual(3);
  });

  it("respects topK limit", () => {
    const members = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const communities = { 0: members };
    const Gmany: { nodes?: Record<string, Record<string, unknown>> } = { nodes: {} };
    for (let i = 0; i < 20; i++) (Gmany.nodes as Record<string, Record<string, unknown>>)[`n${i}`] = { label: `node${i}` };
    const { lines } = communityLabelLines(Gmany, communities, null, 200, 5);
    // The names list should have at most 5 items
    const namesStr = lines[0].split(": ").slice(1).join(": ");
    expect(namesStr.split(", ").length).toBeLessThanOrEqual(5);
  });
});

describe("parseLabelResponse", () => {
  it("parses valid JSON object", () => {
    const text = JSON.stringify({ 0: "Auth Layer", 1: "Cache" });
    const result = parseLabelResponse(text, [0, 1]);
    expect(result[0]).toBe("Auth Layer");
    expect(result[1]).toBe("Cache");
  });

  it("strips markdown fences", () => {
    const text = "```json\n" + JSON.stringify({ 0: "Core" }) + "\n```";
    const result = parseLabelResponse(text, [0]);
    expect(result[0]).toBe("Core");
  });

  it("ignores cids not in labeledCids", () => {
    const text = JSON.stringify({ 0: "A", 1: "B", 99: "Z" });
    const result = parseLabelResponse(text, [0, 1]);
    expect(result[0]).toBe("A");
    expect(result[1]).toBe("B");
    expect(result[99]).toBeUndefined();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLabelResponse("not json", [0])).toThrow();
  });

  it("throws on non-object JSON (array)", () => {
    expect(() => parseLabelResponse("[1,2,3]", [0])).toThrow();
  });

  it("skips non-string values", () => {
    const text = JSON.stringify({ 0: "OK", 1: 42 });
    const result = parseLabelResponse(text, [0, 1]);
    expect(result[0]).toBe("OK");
    expect(result[1]).toBeUndefined();
  });
});
