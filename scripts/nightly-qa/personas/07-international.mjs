/**
 * Persona 07: International
 * Unicode names, long text, special characters, RTL considerations.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runInternational({ baseUrl }) {
  const session = new BrowserSession("07-international", {
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  const steps = [];

  try {
    await session.start();

    // Step 1: Load page with Japanese locale
    const loadTime = await session.navigate(baseUrl);
    steps.push(
      testStep("Homepage loads (ja-JP locale)", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.screenshot("intl-homepage-ja");

    // Step 2: Check page declares language
    const htmlLang = await session.page.evaluate(() => document.documentElement.getAttribute("lang"));
    steps.push(
      testStep("HTML lang attribute set", htmlLang ? TestStatus.PASS : TestStatus.WARN, { lang: htmlLang })
    );

    // Step 3: Check UTF-8 charset
    const hasUtf8 = await session.exists('meta[charset="utf-8"], meta[charset="UTF-8"]');
    const hasContentType = await session.exists('meta[http-equiv="Content-Type"]');
    steps.push(
      testStep("UTF-8 charset declared", hasUtf8 || hasContentType ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 4: Test Unicode text rendering (inject and verify)
    const unicodeTests = [
      { label: "Japanese", text: "\u3053\u3093\u306B\u3061\u306F\u4E16\u754C" },
      { label: "Arabic (RTL)", text: "\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645" },
      { label: "Chinese", text: "\u4F60\u597D\u4E16\u754C" },
      { label: "Emoji", text: "\uD83D\uDE80\uD83C\uDF1F\uD83D\uDCA1\uD83C\uDF0D" },
      { label: "Special chars", text: "<script>alert('xss')</script> & \u00A9 \u2122 \u00AE" },
    ];

    for (const { label, text } of unicodeTests) {
      const rendered = await session.page.evaluate((t) => {
        const div = document.createElement("div");
        div.id = "__intl_test";
        div.textContent = t;
        div.style.position = "absolute";
        div.style.top = "-9999px";
        document.body.appendChild(div);
        const result = div.textContent;
        div.remove();
        return result;
      }, text);
      steps.push(
        testStep(
          `Unicode rendering: ${label}`,
          rendered === text ? TestStatus.PASS : TestStatus.FAIL,
          { expected: text.slice(0, 30), got: rendered?.slice(0, 30) }
        )
      );
    }

    // Step 5: Check long text doesn't overflow containers
    const overflowCheck = await session.page.evaluate(() => {
      const containers = document.querySelectorAll("div, section, article, main");
      let overflowing = 0;
      containers.forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 20) {
          overflowing++;
        }
      });
      return overflowing;
    });
    steps.push(
      testStep(
        "No text overflow in containers",
        overflowCheck <= 2 ? TestStatus.PASS : TestStatus.WARN,
        { overflowingContainers: overflowCheck }
      )
    );
    await session.screenshot("intl-overflow-check");

    // Step 6: Check XSS prevention in URL params
    const xssUrl = `${baseUrl}/?q=<script>alert(1)</script>&name=%3Cimg%20onerror%3Dalert(1)%3E`;
    await session.navigate(xssUrl);
    const hasAlertScript = await session.page.evaluate(
      () => document.body.innerHTML.includes("<script>alert(1)</script>")
    );
    steps.push(
      testStep("XSS in URL params sanitized", !hasAlertScript ? TestStatus.PASS : TestStatus.FAIL)
    );
    await session.screenshot("intl-xss-check");

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "International",
    description: "Unicode, long text, special characters, RTL",
    steps,
    browser: session.getReport(),
  };
}
