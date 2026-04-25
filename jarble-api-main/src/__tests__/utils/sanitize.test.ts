/**
 * Unit tests for sanitize.ts.
 *
 * sanitize.ts is the XSS defense for non-React surfaces — primarily
 * Resend email templates (org invites, beta welcome) and admin views
 * that render user-supplied name/label fields. React's render-time
 * escape is the primary defense in the browser, but the moment a
 * string flows into an HTML email body or an admin panel that uses
 * raw innerHTML, only sanitize.ts stands between an attacker and a
 * stored-XSS payload.
 *
 * Three exports + their constants:
 *   - stripHtmlTags        — removes any `<...>` substring entirely
 *   - noHtmlTags           — Zod refinement: rejects any HTML start tag
 *   - noDangerousHtml      — Zod refinement: blocks script-shaped tags
 *                            and `on*=` event handlers, while allowing
 *                            harmless XML-like markup (`<think>`,
 *                            `<tool_use>`) used in systemPrompt.
 *
 * Coverage focuses on:
 *   - Real-world XSS payloads
 *   - Lookalike strings that should NOT be flagged (false-positive
 *     audit — too-aggressive validation breaks systemPrompt usage)
 *   - The asymmetry between `noHtmlTags` (any HTML rejected) and
 *     `noDangerousHtml` (script-shaped only).
 */

import { describe, it, expect } from "vitest";
import {
  stripHtmlTags,
  noHtmlTags,
  noDangerousHtml,
  NO_HTML_MESSAGE,
  NO_DANGEROUS_HTML_MESSAGE,
} from "../../utils/sanitize.js";

// ── stripHtmlTags ───────────────────────────────────────────────────────────

describe("stripHtmlTags", () => {
  it("removes simple tags but keeps text content", () => {
    expect(stripHtmlTags("<b>hello</b>")).toBe("hello");
    expect(stripHtmlTags("hello <i>world</i>")).toBe("hello world");
  });

  it("removes tags with attributes", () => {
    expect(stripHtmlTags('<a href="evil">click</a>')).toBe("click");
    expect(stripHtmlTags('<img src=x onerror=alert(1)>')).toBe("");
  });

  it("removes self-closing and unclosed tags", () => {
    expect(stripHtmlTags("<br/>")).toBe("");
    expect(stripHtmlTags("<br>")).toBe("");
  });

  it("preserves loose < and > characters that are not part of a tag", () => {
    // The regex only matches well-formed `<...>` blocks. An orphan `<`
    // or `>` survives so the content "5 < 10" reads as written.
    expect(stripHtmlTags("5 < 10")).toBe("5 < 10");
    expect(stripHtmlTags("a > b")).toBe("a > b");
  });

  it("trims surrounding whitespace", () => {
    expect(stripHtmlTags("  <b>x</b>  ")).toBe("x");
  });

  it("strips multiple tags in one pass", () => {
    expect(stripHtmlTags("<p>one</p><p>two</p>")).toBe("onetwo");
  });

  it("returns empty string for input that is only tags", () => {
    expect(stripHtmlTags("<script>alert(1)</script>")).toBe("alert(1)");
    expect(stripHtmlTags("<div></div>")).toBe("");
  });
});

// ── noHtmlTags (Zod refinement: reject any HTML) ────────────────────────────

describe("noHtmlTags", () => {
  it("accepts plain text", () => {
    expect(noHtmlTags("My Agent")).toBe(true);
    expect(noHtmlTags("user@example.com")).toBe(true);
    expect(noHtmlTags("")).toBe(true);
  });

  it("rejects any opening HTML-shaped tag", () => {
    expect(noHtmlTags("<b>bold</b>")).toBe(false);
    expect(noHtmlTags("<script>alert(1)</script>")).toBe(false);
    expect(noHtmlTags("plain <a href")).toBe(false);
  });

  it("rejects closing tag start (e.g. fragments)", () => {
    expect(noHtmlTags("</p>orphan")).toBe(false);
  });

  it("does NOT reject a bare angle bracket — only HTML-tag-starts", () => {
    // `<3` is not an HTML tag-start. Same with comparisons and arrows.
    expect(noHtmlTags("I <3 cats")).toBe(true);
    expect(noHtmlTags("5 < 10")).toBe(true);
    expect(noHtmlTags("a -> b")).toBe(true);
    expect(noHtmlTags("a => b")).toBe(true);
  });

  it("exposes a stable error message constant", () => {
    expect(NO_HTML_MESSAGE).toContain("HTML");
  });
});

// ── noDangerousHtml (Zod refinement: allow XML-like, block script-shaped) ───

describe("noDangerousHtml", () => {
  it("allows XML-like markup that is legitimate in systemPrompt", () => {
    // OpenClaw and other agents emit / accept markup like <think>,
    // <tool_use>, <answer> in systemPrompt fields. The refinement must
    // not block these or it makes the field unusable.
    expect(noDangerousHtml("<think>reasoning</think>")).toBe(true);
    expect(noDangerousHtml("<tool_use><name>x</name></tool_use>")).toBe(true);
    expect(noDangerousHtml("<answer>final</answer>")).toBe(true);
  });

  it("rejects <script> in any case / spacing variant", () => {
    expect(noDangerousHtml("<script>alert(1)</script>")).toBe(false);
    expect(noDangerousHtml("<SCRIPT>alert(1)</SCRIPT>")).toBe(false);
    expect(noDangerousHtml("< script >alert(1)</script>")).toBe(false);
  });

  it("rejects every entry in the dangerous-tag list", () => {
    const dangerous = ["script", "iframe", "embed", "object", "form", "svg", "math"];
    for (const tag of dangerous) {
      expect(noDangerousHtml(`<${tag}>x</${tag}>`)).toBe(false);
      expect(noDangerousHtml(`pre<${tag} attr=x>post`)).toBe(false);
    }
  });

  it("rejects on* event handlers regardless of the tag they sit on", () => {
    // Even on a tag we'd otherwise allow (<think>), an `onclick=` is
    // dangerous because some sanitizers downstream mishandle it.
    expect(noDangerousHtml("<think onclick=alert(1)>x</think>")).toBe(false);
    expect(noDangerousHtml("<img src=x onerror=alert(1)>")).toBe(false);
    expect(noDangerousHtml("<div onmouseover=evil()>")).toBe(false);
  });

  it("does NOT flag the literal substring 'on=' embedded inside text", () => {
    // The event-handler regex requires a word-boundary `on`. So 'icon='
    // (where `on=` is part of `icon=`) must NOT trigger the rejection.
    expect(noDangerousHtml("the icon=red attribute")).toBe(true);
    expect(noDangerousHtml("upon=arrival")).toBe(true);
  });

  it("allows scripted-looking text content that is not in tag position", () => {
    // The dangerous-tag regex requires the tag to actually open: a `<`
    // followed by the tag name. A literal sentence mentioning the word
    // 'script' should not be blocked.
    expect(noDangerousHtml("Use the script command to launch.")).toBe(true);
    expect(noDangerousHtml("script: lorem ipsum")).toBe(true);
  });

  it("exposes a stable error message constant", () => {
    expect(NO_DANGEROUS_HTML_MESSAGE).toContain("Script");
  });
});
