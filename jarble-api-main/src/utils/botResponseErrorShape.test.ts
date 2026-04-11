import { describe, it, expect } from "vitest";
import { isErrorShapedBotReply } from "./botResponseErrorShape.js";

describe("isErrorShapedBotReply", () => {
  // ─── Positive cases (must flag as error) ─────────────────────────────────

  it("flags the exact string observed in the Dev deployment", () => {
    // This is the Cycle 1 observation verbatim — the Dev deployment's chat
    // history had this persisted 3 times as an assistant message.
    expect(isErrorShapedBotReply("401 Missing Authentication header")).toBe(true);
  });

  it("flags HTTP status codes followed by short status phrases", () => {
    expect(isErrorShapedBotReply("401 Unauthorized")).toBe(true);
    expect(isErrorShapedBotReply("403 Forbidden")).toBe(true);
    expect(isErrorShapedBotReply("404 Not Found")).toBe(true);
    expect(isErrorShapedBotReply("429 Too Many Requests")).toBe(true);
    expect(isErrorShapedBotReply("500 Internal Server Error")).toBe(true);
    expect(isErrorShapedBotReply("502 Bad Gateway")).toBe(true);
    expect(isErrorShapedBotReply("503 Service Unavailable")).toBe(true);
  });

  it("flags JavaScript Error prototype toStrings", () => {
    expect(isErrorShapedBotReply("Error: Request failed with status 401")).toBe(true);
    expect(isErrorShapedBotReply("TypeError: Cannot read property 'foo' of undefined")).toBe(true);
    expect(isErrorShapedBotReply("RangeError: Maximum call stack size exceeded")).toBe(true);
    expect(isErrorShapedBotReply("SyntaxError: Unexpected token")).toBe(true);
    expect(isErrorShapedBotReply("ReferenceError: x is not defined")).toBe(true);
  });

  it("flags bare authentication failure phrases", () => {
    expect(isErrorShapedBotReply("Missing Authentication header")).toBe(true);
    expect(isErrorShapedBotReply("Invalid API key")).toBe(true);
    expect(isErrorShapedBotReply("Invalid API Key provided")).toBe(true);
    expect(isErrorShapedBotReply("Unauthorized")).toBe(true);
    expect(isErrorShapedBotReply("Forbidden")).toBe(true);
  });

  it("flags upstream LLM provider error shapes", () => {
    expect(isErrorShapedBotReply("API request failed with status 401")).toBe(true);
    expect(isErrorShapedBotReply("LLM API error 401: Missing Authentication header")).toBe(true);
    expect(isErrorShapedBotReply("LLM API error 500: upstream timeout")).toBe(true);
  });

  it("flags error shapes with trailing whitespace / newlines", () => {
    expect(isErrorShapedBotReply("401 Unauthorized\n")).toBe(true);
    expect(isErrorShapedBotReply("  401 Missing Authentication header  ")).toBe(true);
    expect(isErrorShapedBotReply("Error: timeout\n\n")).toBe(true);
  });

  // ─── Negative cases (must NOT flag as error — false positives cost more) ─

  it("does NOT flag genuine bot responses explaining HTTP codes", () => {
    // Legitimate bot explanation mentioning error codes in prose
    expect(
      isErrorShapedBotReply(
        "Here are the common HTTP status codes: 401 is Unauthorized, 403 is Forbidden, and 500 is a server error.",
      ),
    ).toBe(false);
  });

  it("does NOT flag responses that start with prose before mentioning codes", () => {
    expect(
      isErrorShapedBotReply("The HTTP 401 status code means the request lacks valid authentication credentials."),
    ).toBe(false);
  });

  it("does NOT flag a bot response that happens to start with a number", () => {
    // A bot answering "how many dollars?" might start with a number — make
    // sure we don't misclassify that as an HTTP status.
    expect(isErrorShapedBotReply("100 dollars in savings")).toBe(false);
    expect(isErrorShapedBotReply("42 is the answer to life")).toBe(false);
    expect(isErrorShapedBotReply("2024 was a great year")).toBe(false); // 4-digit years don't match
  });

  it("does NOT flag long responses even if they start with an error pattern", () => {
    // Legitimate bot explanations that begin by quoting an error code but
    // then continue with a long helpful explanation. The 200-char cap lets
    // these through.
    const longExplanation =
      "401 Unauthorized is returned when the client lacks valid authentication credentials. To fix this, you need to provide a valid API key in the Authorization header. The API key can be obtained from your account settings. Make sure to keep it secret.";
    expect(longExplanation.length).toBeGreaterThan(200);
    expect(isErrorShapedBotReply(longExplanation)).toBe(false);
  });

  it("does NOT flag empty / whitespace-only / null / undefined", () => {
    expect(isErrorShapedBotReply("")).toBe(false);
    expect(isErrorShapedBotReply("   ")).toBe(false);
    expect(isErrorShapedBotReply("\n\n\t")).toBe(false);
    expect(isErrorShapedBotReply(null as any)).toBe(false);
    expect(isErrorShapedBotReply(undefined as any)).toBe(false);
  });

  it("does NOT flag non-string inputs", () => {
    expect(isErrorShapedBotReply(42 as any)).toBe(false);
    expect(isErrorShapedBotReply({} as any)).toBe(false);
    expect(isErrorShapedBotReply([] as any)).toBe(false);
    expect(isErrorShapedBotReply(true as any)).toBe(false);
  });

  it("does NOT flag normal conversational bot replies", () => {
    expect(isErrorShapedBotReply("Hello! How can I help you today?")).toBe(false);
    expect(isErrorShapedBotReply("Sure, let me look that up for you.")).toBe(false);
    expect(isErrorShapedBotReply("The weather is sunny today.")).toBe(false);
    expect(isErrorShapedBotReply("I don't know the answer to that.")).toBe(false);
  });

  it("does NOT flag responses mentioning 'error' in prose", () => {
    expect(isErrorShapedBotReply("There was no error in your calculation.")).toBe(false);
    expect(isErrorShapedBotReply("Errors can sometimes be hard to debug.")).toBe(false);
  });

  it("does NOT flag responses starting with a 3-digit number followed by lowercase", () => {
    // HTTP status phrases are always capitalized; a lowercase word after the
    // number suggests prose, not an error.
    expect(isErrorShapedBotReply("401 is a status code")).toBe(false);
  });

  // ─── Boundary cases ─────────────────────────────────────────────────────

  it("respects the 200-char length cap exactly", () => {
    // Use "Error: " prefix because its pattern has no internal length cap,
    // so we can isolate the overall-length check. (The HTTP-status pattern
    // caps the phrase at 150 chars internally, which is a separate guard.)
    // 199-char error is flagged
    const under = "Error: " + "x".repeat(192);
    expect(under.length).toBe(199);
    expect(isErrorShapedBotReply(under)).toBe(true);

    // 201-char version is NOT flagged (over the overall 200-char cap)
    const over = "Error: " + "x".repeat(194);
    expect(over.length).toBe(201);
    expect(isErrorShapedBotReply(over)).toBe(false);
  });

  it("HTTP status phrase has its own internal 150-char limit", () => {
    // Real HTTP status phrases are always short. A synthetic very-long
    // phrase after "401 " is NOT flagged, because the regex caps the
    // phrase part at 150 chars to avoid false positives on prose that
    // happens to start with a number + capital letter.
    const synthetic = "401 " + "X".repeat(190); // phrase = 190 chars (> 150 limit)
    expect(isErrorShapedBotReply(synthetic)).toBe(false);

    // A realistic 100-char phrase IS flagged
    const realistic = "401 " + "Missing Authentication Header " + "x".repeat(70);
    expect(isErrorShapedBotReply(realistic)).toBe(true);
  });
});
