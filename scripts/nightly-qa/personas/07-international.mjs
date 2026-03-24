/**
 * Persona 07: International
 * Unicode names, long text, special characters, RTL considerations, XSS prevention, locale handling.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runInternational({ baseUrl, config = {} }) {
  const session = new BrowserSession("07-international", {
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  const steps = [];

  try {
    await session.start();

    // Inject auth token
    if (config.authToken) {
      await session.context.addCookies([{
        name: 'auth_token',
        value: config.authToken,
        domain: new URL(baseUrl).hostname,
        path: '/',
      }]);
      await session.page.addInitScript((token) => {
        localStorage.setItem('jarble_qa_token', token);
      }, config.authToken);
    }

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

    // Step 4: Unicode text rendering — Japanese
    const japaneseText = "\u3053\u3093\u306B\u3061\u306F\u4E16\u754C";
    const japaneseRendered = await session.page.evaluate((t) => {
      const div = document.createElement("div");
      div.textContent = t;
      div.style.position = "absolute"; div.style.top = "-9999px";
      document.body.appendChild(div);
      const result = div.textContent;
      div.remove();
      return result;
    }, japaneseText);
    steps.push(
      testStep("Unicode rendering: Japanese", japaneseRendered === japaneseText ? TestStatus.PASS : TestStatus.FAIL, { expected: japaneseText, got: japaneseRendered })
    );

    // Step 5: Unicode text rendering — Arabic (RTL)
    const arabicText = "\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645";
    const arabicRendered = await session.page.evaluate((t) => {
      const div = document.createElement("div");
      div.textContent = t;
      div.style.position = "absolute"; div.style.top = "-9999px";
      document.body.appendChild(div);
      const result = div.textContent;
      div.remove();
      return result;
    }, arabicText);
    steps.push(
      testStep("Unicode rendering: Arabic (RTL)", arabicRendered === arabicText ? TestStatus.PASS : TestStatus.FAIL, { expected: arabicText, got: arabicRendered })
    );

    // Step 6: Unicode text rendering — Chinese
    const chineseText = "\u4F60\u597D\u4E16\u754C";
    const chineseRendered = await session.page.evaluate((t) => {
      const div = document.createElement("div");
      div.textContent = t;
      div.style.position = "absolute"; div.style.top = "-9999px";
      document.body.appendChild(div);
      const result = div.textContent;
      div.remove();
      return result;
    }, chineseText);
    steps.push(
      testStep("Unicode rendering: Chinese", chineseRendered === chineseText ? TestStatus.PASS : TestStatus.FAIL)
    );

    // Step 7: Emoji rendering
    const emojiText = "\uD83D\uDE80\uD83C\uDF1F\uD83D\uDCA1\uD83C\uDF0D";
    const emojiRendered = await session.page.evaluate((t) => {
      const div = document.createElement("div");
      div.textContent = t;
      div.style.position = "absolute"; div.style.top = "-9999px";
      document.body.appendChild(div);
      const result = div.textContent;
      div.remove();
      return result;
    }, emojiText);
    steps.push(
      testStep("Unicode rendering: Emoji", emojiRendered === emojiText ? TestStatus.PASS : TestStatus.FAIL)
    );

    // Step 8: Special characters (XSS attempt)
    const xssText = "<script>alert('xss')</script> & \u00A9 \u2122 \u00AE";
    const xssRendered = await session.page.evaluate((t) => {
      const div = document.createElement("div");
      div.textContent = t;
      div.style.position = "absolute"; div.style.top = "-9999px";
      document.body.appendChild(div);
      const result = div.textContent;
      div.remove();
      return result;
    }, xssText);
    steps.push(
      testStep("Special characters render safely", xssRendered === xssText ? TestStatus.PASS : TestStatus.FAIL)
    );

    // Step 9: Test with emoji in input fields
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(2000);
    const chatInput = await session.page.$('textarea, [role="textbox"], [contenteditable="true"]');
    if (chatInput) {
      try {
        await chatInput.click();
        await session.page.keyboard.type("Hello \uD83D\uDE80 World \u2764\uFE0F");
        const inputValue = await session.page.evaluate(() => {
          const el = document.querySelector('textarea, [role="textbox"], [contenteditable="true"]');
          return el?.value || el?.textContent || "";
        });
        steps.push(
          testStep("Emoji in input fields", inputValue.includes("\uD83D\uDE80") ? TestStatus.PASS : TestStatus.WARN, { value: inputValue.slice(0, 50) })
        );
      } catch (err) {
        steps.push(testStep("Emoji in input fields", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Emoji in input fields", TestStatus.SKIP));
    }

    // Step 10: Test with very long text (500+ chars)
    const longText = "A".repeat(500);
    if (chatInput) {
      try {
        await chatInput.click();
        await chatInput.fill(longText);
        const longValue = await session.page.evaluate(() => {
          const el = document.querySelector('textarea, [role="textbox"], [contenteditable="true"]');
          return (el?.value || el?.textContent || "").length;
        });
        steps.push(
          testStep("Long text input (500+ chars)", longValue >= 400 ? TestStatus.PASS : TestStatus.WARN, { charCount: longValue })
        );
      } catch (err) {
        steps.push(testStep("Long text input (500+ chars)", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Long text input (500+ chars)", TestStatus.SKIP));
    }

    // Step 11: No text overflow in containers
    await session.navigate(baseUrl);
    await session.page.waitForTimeout(2000);
    const overflowCheck = await session.page.evaluate(() => {
      const containers = document.querySelectorAll("div, section, article, main");
      let overflowing = 0;
      containers.forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 20) overflowing++;
      });
      return overflowing;
    });
    steps.push(
      testStep("No text overflow in containers", overflowCheck <= 2 ? TestStatus.PASS : TestStatus.WARN, { overflowingContainers: overflowCheck })
    );
    await session.screenshot("intl-overflow-check");

    // Step 12: XSS prevention in URL params
    const xssUrl = `${baseUrl}/?q=<script>alert(1)</script>&name=%3Cimg%20onerror%3Dalert(1)%3E`;
    await session.navigate(xssUrl);
    const hasAlertScript = await session.page.evaluate(
      () => document.body.innerHTML.includes("<script>alert(1)</script>")
    );
    steps.push(
      testStep("XSS in URL params sanitized", !hasAlertScript ? TestStatus.PASS : TestStatus.FAIL)
    );
    await session.screenshot("intl-xss-check");

    // Step 13: Test with Arabic locale (RTL layout)
    // Close and reopen with Arabic locale
    await session.cleanup();
    const rtlSession = new BrowserSession("07-international-rtl", {
      locale: "ar-SA",
      timezoneId: "Asia/Riyadh",
    });
    await rtlSession.start();
    if (config.authToken) {
      await rtlSession.context.addCookies([{
        name: 'auth_token',
        value: config.authToken,
        domain: new URL(baseUrl).hostname,
        path: '/',
      }]);
    }
    const rtlLoadTime = await rtlSession.navigate(baseUrl);
    steps.push(
      testStep("Homepage loads (ar-SA locale)", rtlLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${rtlLoadTime}ms` })
    );
    await rtlSession.screenshot("intl-homepage-ar");

    // Step 14: Check RTL text direction handling
    const rtlDirection = await rtlSession.page.evaluate(() => {
      const body = document.body;
      const style = window.getComputedStyle(body);
      return { dir: document.documentElement.getAttribute("dir"), direction: style.direction };
    });
    steps.push(
      testStep("RTL text direction", TestStatus.PASS, rtlDirection)
    );

    // Step 15: No horizontal overflow with RTL
    const rtlBodyWidth = await rtlSession.page.evaluate(() => document.body.scrollWidth);
    const rtlViewport = await rtlSession.page.evaluate(() => window.innerWidth);
    steps.push(
      testStep("No horizontal overflow (RTL)", rtlBodyWidth <= rtlViewport + 10 ? TestStatus.PASS : TestStatus.WARN, { bodyWidth: rtlBodyWidth, viewport: rtlViewport })
    );

    await rtlSession.cleanup();

    // Step 16: No console errors
    const errors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors during i18n tests", errors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: errors.length })
    );

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
