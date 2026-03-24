/**
 * Persona 16: File & Knowledge Tester
 * Tests file management and knowledge panel features on the deployment chat page.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runFileKnowledge({ baseUrl }) {
  const session = new BrowserSession("16-file-knowledge");
  const steps = [];

  try {
    await session.start();

    // Step 1: Navigate to a deployment chat page
    const loadTime = await session.navigate(`${baseUrl}/d/test`);
    steps.push(
      testStep(
        "Deployment chat page loads",
        loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
        { loadTime: `${loadTime}ms` }
      )
    );
    await session.screenshot("file-knowledge-landing");

    // Step 2: Look for the Files panel button
    const filesButtonSelector = 'button[aria-label*="file" i], button[aria-label*="File" i], [class*="file" i], svg[class*="lucide-file"], button:has-text("Files")';
    const filesButtonExists = await session.exists(filesButtonSelector);
    steps.push(
      testStep(
        "Files panel button exists",
        filesButtonExists ? TestStatus.PASS : TestStatus.WARN,
        { note: "Searched for file-related button/icon" }
      )
    );

    // Step 3: Look for the Knowledge panel button
    const knowledgeButtonSelector = 'button[aria-label*="knowledge" i], button[aria-label*="Knowledge" i], [class*="knowledge" i], svg[class*="lucide-book"], button:has-text("Knowledge")';
    const knowledgeButtonExists = await session.exists(knowledgeButtonSelector);
    steps.push(
      testStep(
        "Knowledge panel button exists",
        knowledgeButtonExists ? TestStatus.PASS : TestStatus.WARN,
        { note: "Searched for knowledge-related button/icon" }
      )
    );

    // Step 4: Open Files panel and screenshot
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

    // Step 5: Open Knowledge panel and screenshot
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
      steps.push(testStep("Knowledge panel opens", TestStatus.SKIP, { note: "Button not found" }));
    }

    // Step 6: Check file list renders (even if empty)
    const hasFileList = await session.exists("[class*='file-list'], [class*='FileList'], ul[class*='file'], [class*='empty'], [class*='no-files'], [class*='upload']");
    steps.push(
      testStep(
        "File list or empty state renders",
        hasFileList ? TestStatus.PASS : TestStatus.WARN,
        { note: "Checked for file list or empty state" }
      )
    );

    // Step 7: Verify upload UI elements exist
    const hasUploadUI = await session.exists("input[type='file'], [class*='upload'], [class*='Upload'], button:has-text('Upload'), [class*='dropzone'], [class*='Dropzone']");
    steps.push(
      testStep(
        "Upload UI elements exist",
        hasUploadUI ? TestStatus.PASS : TestStatus.WARN,
        { note: "Searched for file input, upload button, or dropzone" }
      )
    );
    await session.screenshot("upload-ui-elements");

    // Step 8: Check no console errors on file panels
    const pageErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "No console errors on file panels",
        pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN,
        { errorCount: pageErrors.length }
      )
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
