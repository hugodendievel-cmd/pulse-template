import { describe, expect, it } from "vitest";

import { sanitizeDailyEdition } from "../apis/utils/sanitize.mjs";

describe("sanitizeDailyEdition", () => {
  it("strips HTML tags from string fields", () => {
    const clean = sanitizeDailyEdition({
      dateOf: "September <b>10</b>, 2026",
      tldr: "hello <script>alert(1)</script>world",
      topStories: [
        {
          title: "<script>alert(2)</script>GPT-5.5 lands",
          body: "OpenAI <em>shipped</em>",
          category: "model-release",
          impact: "high",
          url: "https://example.com",
        },
      ],
      modelReleases: [],
      paperPick: { title: "Io<b>C</b> safety", authors: "A et al.", insight: "x", url: "" },
      communityBuzz: [`quote &quot; test`],
    });

    expect(clean.dateOf).toBe("September 10, 2026");
    expect(clean.tldr).toBe("hello alert(1)world");
    expect(clean.topStories[0].title).toBe("alert(2)GPT-5.5 lands");
    expect(clean.topStories[0].body).toBe("OpenAI shipped");
    expect(clean.paperPick.title).toBe("IoC safety");
    expect(clean.communityBuzz[0]).toContain('"');
  });

  it("drops non-http(s) URLs but keeps https", () => {
    const clean = sanitizeDailyEdition({
      topStories: [
        {
          title: "t",
          body: "b",
          url: "javascript:alert(1)",
        },
      ],
      paperPick: { title: "p", url: "http://ok.example.com/a" },
    });

    expect(clean.topStories[0].url).toBe("");
    expect(clean.paperPick.url).toBe("http://ok.example.com/a");
  });

  it("sanitizes quickLinks text and urls, and still supports legacy communityBuzz", () => {
    const clean = sanitizeDailyEdition({
      quickLinks: [
        { text: "<b>link</b> text", url: "https://example.com/a" },
        { text: "bad", url: "javascript:alert(1)" },
        null,
      ],
      communityBuzz: ["<i>legacy</i> buzz"],
    });

    expect(clean.quickLinks).toHaveLength(2);
    expect(clean.quickLinks[0]).toEqual({
      text: "link text",
      url: "https://example.com/a",
    });
    expect(clean.quickLinks[1].url).toBe("");
    expect(clean.communityBuzz[0]).toBe("legacy buzz");
  });

  it("passes unknown top-level fields through untouched", () => {
    const clean = sanitizeDailyEdition({
      tldr: "x",
      topStories: [],
      customField: { keep: "me" },
    });

    expect(clean.customField).toEqual({ keep: "me" });
  });

  it("survives missing optional sections", () => {
    const clean = sanitizeDailyEdition({ tldr: "only tldr" });
    expect(clean.tldr).toBe("only tldr");
    expect(clean.topStories).toBeUndefined();
    expect(clean.paperPick).toBeUndefined();
  });

  it("returns non-objects unchanged", () => {
    expect(sanitizeDailyEdition(null)).toBeNull();
    expect(sanitizeDailyEdition("nope")).toBe("nope");
  });
});
