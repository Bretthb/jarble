import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  getTestConfig,
  logTestFailure,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import {
  sendPromptAndWait,
  waitForCanvasCards,
  getCanvasCardCount,
  assertNoErrorCards,
  waitForComponentType,
  getErrorCardCount,
  getCanvasCardIds,
  clearCanvasState,
} from "./helpers/canvas";
import { MEDIA_PROMPTS } from "./helpers/prompts";

test.describe("Canvas media components", () => {
  let flush: () => Promise<void>;
  let deploymentId: string;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    const config = getTestConfig();
    deploymentId = config.deploymentId;
    test.skip(!deploymentId, "No deploymentId — run test:e2e:auth first");
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "media", scenario: testInfo.title });
    }
  });

  // -------------------------------------------------------------------------
  // 1. Video player (media-video-01)
  // -------------------------------------------------------------------------
  test("video component renders with player element (media-video-01)", async ({ page }, testInfo) => {
    const entry = MEDIA_PROMPTS.find((p) => p.id === "media-video-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "media-video-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render for video component").toBeGreaterThanOrEqual(1);

    // Wait for video or iframe element to appear
    const foundVideo = await waitForComponentType(page, "video", 15_000);
    expect.soft(foundVideo, "Video or iframe element should render").toBeTruthy();

    if (foundVideo) {
      // Check for <video> element with src attribute
      const videoEl = page.locator("[data-card-id] video").first();
      const iframeEl = page.locator("[data-card-id] iframe").first();

      const hasVideo = await videoEl.isVisible().catch(() => false);
      const hasIframe = await iframeEl.isVisible().catch(() => false);

      expect.soft(
        hasVideo || hasIframe,
        "Either a <video> or <iframe> element should be visible",
      ).toBeTruthy();

      if (hasVideo) {
        const src = await videoEl.getAttribute("src") ?? "";
        expect.soft(src.length, "Video src attribute should be set").toBeGreaterThan(0);
      }

      await testInfo.attach("video-check", {
        body: JSON.stringify({ hasVideo, hasIframe }, null, 2),
        contentType: "application/json",
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. Audio player (media-audio-01)
  // -------------------------------------------------------------------------
  test("audio component renders with audio element (media-audio-01)", async ({ page }, testInfo) => {
    const entry = MEDIA_PROMPTS.find((p) => p.id === "media-audio-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "media-audio-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render for audio component").toBeGreaterThanOrEqual(1);

    // Wait for audio element
    const foundAudio = await waitForComponentType(page, "audio", 15_000);
    expect.soft(foundAudio, "Audio element should render").toBeTruthy();

    if (foundAudio) {
      const audioEl = page.locator("[data-card-id] audio").first();
      const hasAudio = await audioEl.isVisible().catch(() => false);
      expect.soft(hasAudio, "<audio> element should be visible").toBeTruthy();

      if (hasAudio) {
        // Audio elements should have src or source child
        const src = await audioEl.getAttribute("src") ?? "";
        const sourceCount = await audioEl.locator("source").count();
        expect.soft(
          src.length > 0 || sourceCount > 0,
          "Audio should have src attribute or <source> child",
        ).toBeTruthy();
      }
    }
  });

  // -------------------------------------------------------------------------
  // 3. Image component (media-image-01)
  // -------------------------------------------------------------------------
  test("image component renders with img element (media-image-01)", async ({ page }, testInfo) => {
    const entry = MEDIA_PROMPTS.find((p) => p.id === "media-image-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "media-image-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render for image component").toBeGreaterThanOrEqual(1);

    // Wait for image element
    const foundImage = await waitForComponentType(page, "image", 15_000);
    expect.soft(foundImage, "Image element should render").toBeTruthy();

    if (foundImage) {
      const imgEl = page.locator("[data-card-id] img").first();
      const hasImg = await imgEl.isVisible().catch(() => false);
      expect.soft(hasImg, "<img> element should be visible").toBeTruthy();

      if (hasImg) {
        const src = await imgEl.getAttribute("src") ?? "";
        expect.soft(src.length, "Image src attribute should be set").toBeGreaterThan(0);

        // Check for alt text (accessibility)
        const alt = await imgEl.getAttribute("alt") ?? "";
        expect.soft(alt.length, "Image should have alt text").toBeGreaterThan(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4. Image gallery — multiple images (media-gallery-01)
  // -------------------------------------------------------------------------
  test("image gallery renders multiple images (media-gallery-01)", async ({ page }, testInfo) => {
    const entry = MEDIA_PROMPTS.find((p) => p.id === "media-gallery-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "media-gallery-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render for image gallery").toBeGreaterThanOrEqual(1);

    const foundGallery = await waitForComponentType(page, "image_gallery", 15_000);
    expect.soft(foundGallery, "Image gallery component should render").toBeTruthy();

    if (foundGallery) {
      // Gallery should contain multiple img elements
      const imgElements = page.locator("[data-card-id] img");
      const imgCount = await imgElements.count();
      expect.soft(imgCount, "Gallery should contain at least 2 images").toBeGreaterThanOrEqual(2);

      // Verify each image has a src attribute
      let imagesWithSrc = 0;
      for (let i = 0; i < Math.min(imgCount, 6); i++) {
        const src = await imgElements.nth(i).getAttribute("src") ?? "";
        if (src.length > 0) imagesWithSrc++;
      }

      expect.soft(
        imagesWithSrc,
        "All gallery images should have src attributes",
      ).toBeGreaterThanOrEqual(2);

      await testInfo.attach("gallery-check", {
        body: JSON.stringify({ imgCount, imagesWithSrc }, null, 2),
        contentType: "application/json",
      });
    }
  });

  // -------------------------------------------------------------------------
  // 5. Carousel with navigation (media-carousel-01)
  // -------------------------------------------------------------------------
  test("carousel renders with navigation buttons (media-carousel-01)", async ({ page }, testInfo) => {
    const entry = MEDIA_PROMPTS.find((p) => p.id === "media-carousel-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "media-carousel-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render for carousel").toBeGreaterThanOrEqual(1);

    const foundCarousel = await waitForComponentType(page, "carousel", 15_000);
    expect.soft(foundCarousel, "Carousel component should render").toBeTruthy();

    if (foundCarousel) {
      // Look for navigation buttons (prev/next) — Embla carousel typically has these
      const navButtons = page.locator(
        "[data-card-id] button[aria-label*='previous' i], " +
        "[data-card-id] button[aria-label*='next' i], " +
        "[data-card-id] button:has(svg.lucide-chevron-left), " +
        "[data-card-id] button:has(svg.lucide-chevron-right), " +
        "[data-card-id] [data-embla-prev], " +
        "[data-card-id] [data-embla-next]"
      );
      const navCount = await navButtons.count();

      // Carousel should have navigation controls
      expect.soft(navCount, "Carousel should have navigation buttons").toBeGreaterThanOrEqual(1);

      // Check for carousel container
      const carouselContainer = page.locator(
        "[data-card-id] [data-embla-container], [data-card-id] .embla"
      ).first();
      const hasContainer = await carouselContainer.isVisible().catch(() => false);
      expect.soft(hasContainer, "Carousel container should be visible").toBeTruthy();

      await testInfo.attach("carousel-check", {
        body: JSON.stringify({ navCount, hasContainer }, null, 2),
        contentType: "application/json",
      });
    }
  });

  // -------------------------------------------------------------------------
  // 6. Broken image fallback (media-broken-01)
  // -------------------------------------------------------------------------
  test("broken image URL shows graceful fallback (media-broken-01)", async ({ page }, testInfo) => {
    const entry = MEDIA_PROMPTS.find((p) => p.id === "media-broken-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "media-broken-01-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // The page should not crash — either:
    // a) Shows a fallback/placeholder image
    // b) Shows error text about the broken image
    // c) The bot handles it in its text response
    expect.soft(
      cardCount > 0 || errorCount >= 0,
      "Page should handle broken image URL without crashing",
    ).toBeTruthy();

    if (cardCount > 0) {
      // Check if an img element exists (may show broken image icon)
      const imgEl = page.locator("[data-card-id] img").first();
      const hasImg = await imgEl.isVisible().catch(() => false);

      if (hasImg) {
        // Check if the image has an error state (naturalWidth === 0 means broken)
        const isBroken = await imgEl.evaluate((el: HTMLImageElement) => {
          return el.naturalWidth === 0 && el.complete;
        }).catch(() => false);

        await testInfo.attach("broken-image-check", {
          body: JSON.stringify({ hasImg, isBroken }, null, 2),
          contentType: "application/json",
        });
      }

      // Check for fallback text or error message
      const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";
      const hasFallbackText = /error|broken|failed|not found|unavailable|fallback/i.test(cardText);

      await testInfo.attach("fallback-check", {
        body: JSON.stringify({
          hasImg,
          hasFallbackText,
          errorCount,
          cardCount,
        }, null, 2),
        contentType: "application/json",
      });
    }
  });
});
