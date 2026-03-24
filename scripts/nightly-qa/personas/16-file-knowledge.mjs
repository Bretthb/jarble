/**
 * Persona 16: File & Knowledge Tester
 * Tests file management, knowledge panel, upload UI, file list, drag-and-drop zones.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runFileKnowledge({ baseUrl, config = {} }) {
  const session = new BrowserSession("16-file-knowledge");
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

    // Step 1: Navigate to deployment chat page
    const loadTime = await session.navigate(`${baseUrl}/d/test`);
    steps.push(
      testStep("Deployment chat page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("file-knowledge-landing");

    // Step 2: Check chat interface rendered
    const hasChatInput = await session.exists('textarea, [role="textbox"], [contenteditable="true"]');
    steps.push(
      testStep("Chat interface rendered", hasChatInput ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 3: Look for the Files panel button
    const filesButtonSelector = 'button[aria-label*="file" i], button[aria-label*="File" i], [class*="file" i]';
    const filesButtonExists = await session.exists(filesButtonSelector);
    steps.push(
      testStep("Files panel button exists", filesButtonExists ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 4: Look for the Knowledge panel button
    const knowledgeButtonSelector = 'button[aria-label*="knowledge" i], button[aria-label*="Knowledge" i], [class*="knowledge" i]';
    const knowledgeButtonExists = await session.exists(knowledgeButtonSelector);
    steps.push(
      testStep("Knowledge panel button exists", knowledgeButtonExists ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 5: Open Files panel
    if (filesButtonExists) {
      try {
        await session.page.click(filesButtonSelector);
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Files panel opens", TestStatus.PASS));
        await session.screenshot("files-panel-open");
      } catch (err) {
        steps.push(testStep("Files panel opens", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Files panel opens", TestStatus.SKIP, { note: "Button not found" }));
    }

    // Step 6: Check file list renders (even if empty)
    const hasFileList = await session.exists("[class*='file-list'], [class*='FileList'], ul[class*='file'], [class*='empty'], [class*='no-files'], [class*='upload']");
    steps.push(
      testStep("File list or empty state renders", hasFileList ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 7: Verify upload UI elements exist
    const hasUploadUI = await session.exists("input[type='file'], [class*='upload'], [class*='Upload'], button:has-text('Upload'), [class*='dropzone'], [class*='Dropzone']");
    steps.push(
      testStep("Upload UI elements exist", hasUploadUI ? TestStatus.PASS : TestStatus.WARN)
    );
    await session.screenshot("upload-ui-elements");

    // Step 8: Check drag-and-drop zone
    const hasDropzone = await session.exists("[class*='dropzone'], [class*='Dropzone'], [class*='drag'], [class*='Drag']");
    steps.push(
      testStep("Drag-and-drop zone present", hasDropzone ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 9: Check file type restrictions info
    const fileInfo = await session.safeTextContent("body");
    const hasFileTypeInfo = fileInfo && (
      fileInfo.toLowerCase().includes("pdf") ||
      fileInfo.toLowerCase().includes("txt") ||
      fileInfo.toLowerCase().includes("file type") ||
      fileInfo.toLowerCase().includes("supported") ||
      fileInfo.toLowerCase().includes("max size")
    );
    steps.push(
      testStep("File type/size info visible", hasFileTypeInfo ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 10: Open Knowledge panel
    if (knowledgeButtonExists) {
      try {
        await session.page.click(knowledgeButtonSelector);
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Knowledge panel opens", TestStatus.PASS));
        await session.screenshot("knowledge-panel-open");
      } catch (err) {
        steps.push(testStep("Knowledge panel opens", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Knowledge panel opens", TestStatus.SKIP));
    }

    // Step 11: Check knowledge content or empty state
    const hasKnowledgeContent = await session.exists(
      "[class*='knowledge-list'], [class*='KnowledgeList'], [class*='empty'], [class*='no-knowledge'], [class*='add-knowledge']"
    );
    steps.push(
      testStep("Knowledge list or empty state renders", hasKnowledgeContent ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 12: Check for add knowledge button
    const hasAddKnowledge = await session.exists(
      "button:has-text('Add'), button:has-text('Upload'), button:has-text('New'), button[class*='add' i]"
    );
    steps.push(
      testStep("Add knowledge button present", hasAddKnowledge ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 13: Check panel close button
    const hasCloseButton = await session.exists(
      "button[aria-label*='close' i], button:has-text('Close'), button[class*='close' i], [class*='panel'] button"
    );
    steps.push(
      testStep("Panel close button present", hasCloseButton ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 14: Switch between panels
    if (filesButtonExists && knowledgeButtonExists) {
      try {
        await session.page.click(filesButtonSelector);
        await session.page.waitForTimeout(500);
        await session.page.click(knowledgeButtonSelector);
        await session.page.waitForTimeout(500);
        steps.push(testStep("Switch between panels works", TestStatus.PASS));
      } catch (err) {
        steps.push(testStep("Switch between panels works", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Switch between panels works", TestStatus.SKIP));
    }

    // Step 15: Check file panel accessibility
    const filePanelA11y = await session.page.evaluate(() => {
      const panel = document.querySelector('[class*="file"], [class*="File"], [class*="knowledge"], [class*="Knowledge"]');
      if (!panel) return null;
      const hasRole = panel.hasAttribute("role");
      const hasLabel = panel.hasAttribute("aria-label") || panel.hasAttribute("aria-labelledby");
      return { hasRole, hasLabel };
    });
    steps.push(
      testStep("File/knowledge panel accessibility", filePanelA11y?.hasRole || filePanelA11y?.hasLabel ? TestStatus.PASS : TestStatus.WARN, filePanelA11y)
    );

    // Step 16: Navigate to different deployment — panels reset
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(1500);
    const panelsReset = await session.exists(filesButtonSelector) || await session.exists(knowledgeButtonSelector);
    steps.push(
      testStep("Panels available on different deployment", panelsReset ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 17: Check marketplace panel also exists
    const marketplaceBtn = 'button[aria-label*="marketplace" i], button[aria-label*="store" i]';
    const hasMarketplace = await session.exists(marketplaceBtn);
    steps.push(
      testStep("Marketplace panel button present", hasMarketplace ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 18: Check config panel (settings gear)
    const gearExists = await session.exists('button[aria-label*="settings" i], button[aria-label*="config" i]');
    steps.push(
      testStep("Config panel gear button present", gearExists ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 19: No console errors on file panels
    const pageErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors on file panels", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: pageErrors.length })
    );

    // Step 20: No server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "File & Knowledge Tester",
    description: "Tests file management and knowledge panel features",
    steps,
    browser: session.getReport(),
  };
}
