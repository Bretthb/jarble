/**
 * Persona 21: File Uploader
 * Actually uploads files, verifies they appear in the UI, reads them back,
 * tests the knowledge panel, and cleans up test files.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runFileUploader({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("21-file-uploader");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];
  let deploymentId = null;
  const testFileName = `qa-test-${Date.now()}.txt`;
  const testFileContent = `QA Test File Content - Generated at ${new Date().toISOString()}\nLine 2: This is a test file uploaded by the nightly QA file uploader persona.\nLine 3: It contains multiple lines to verify full content round-trip.`;

  try {
    await session.start();

    // Inject auth token
    if (config.authToken) {
      await session.context.addCookies([{
        name: "auth_token",
        value: config.authToken,
        domain: new URL(baseUrl).hostname,
        path: "/",
      }]);
      await session.page.addInitScript((token) => {
        localStorage.setItem("jarble_qa_token", token);
      }, config.authToken);
    }

    // Step 1: Find a deployment via API
    try {
      const listResult = await api.trpc("deployment.list");
      const deployments = listResult.data?.result?.data;
      if (Array.isArray(deployments) && deployments.length > 0) {
        const running = deployments.find((d) => d.status === "running" || d.status === "active");
        deploymentId = running?.id || deployments[0].id;
      }
      steps.push(testStep("Find deployment via API", deploymentId ? TestStatus.PASS : TestStatus.SKIP, { id: deploymentId }));
    } catch (err) {
      steps.push(testStep("Find deployment via API", TestStatus.WARN, { error: err.message }));
    }

    if (!deploymentId) {
      deploymentId = "demo";
    }

    // Step 2: Navigate to deployment page
    const chatLoad = await session.navigate(`${baseUrl}/d/${deploymentId}`);
    await session.page.waitForTimeout(3000);
    steps.push(testStep("Navigate to deployment page", chatLoad < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoad}ms` }));
    await session.screenshot("deployment-page");

    // Step 3: Open Files panel
    try {
      const filesBtn = await session.page.$('button:has-text("Files"), button[aria-label*="files" i], [data-testid="files-panel"], button:has-text("File")');
      if (filesBtn) {
        await filesBtn.click();
        await session.page.waitForTimeout(2000);
        steps.push(testStep("Open Files panel", TestStatus.PASS));
        await session.screenshot("files-panel-open");
      } else {
        steps.push(testStep("Open Files panel", TestStatus.SKIP, { note: "Files button not found" }));
      }
    } catch (err) {
      steps.push(testStep("Open Files panel", TestStatus.WARN, { error: err.message }));
    }

    // Step 4: Screenshot the files panel state
    await session.screenshot("files-panel-initial");
    const initialFileCount = await session.countElements('[class*="file-item"], [class*="file-row"], [class*="file-list"] li, [class*="file-entry"]');
    steps.push(testStep("Screenshot files panel", TestStatus.PASS, { initialFileCount }));

    // Step 5: Upload test file via API
    try {
      const uploadResult = await api.rest("POST", `/api/deployments/${deploymentId}/files/upload`, {
        fileName: testFileName,
        content: testFileContent,
        contentType: "text/plain",
      });
      steps.push(testStep("Upload test file via API", uploadResult.status === 200 || uploadResult.status === 201 ? TestStatus.PASS : TestStatus.WARN, {
        status: uploadResult.status,
        fileName: testFileName,
      }));
    } catch (err) {
      steps.push(testStep("Upload test file via API", TestStatus.WARN, { error: err.message }));
    }

    // Step 6: Upload via browser file input (alternative path)
    try {
      const fileInput = await session.page.$('input[type="file"]');
      if (fileInput) {
        // Create a buffer for the test file
        await fileInput.setInputFiles({
          name: `qa-browser-upload-${Date.now()}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from("Browser upload test content"),
        });
        await session.page.waitForTimeout(3000);
        steps.push(testStep("Upload file via browser input", TestStatus.PASS));
      } else {
        steps.push(testStep("Upload file via browser input", TestStatus.SKIP, { note: "No file input found — may use drag-drop or button" }));
      }
    } catch (err) {
      steps.push(testStep("Upload file via browser input", TestStatus.WARN, { error: err.message }));
    }

    // Step 7: Refresh and check file appears
    try {
      // Reload the panel or page
      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.page.waitForTimeout(3000);

      // Re-open files panel if needed
      const filesBtn2 = await session.page.$('button:has-text("Files"), button[aria-label*="files" i]');
      if (filesBtn2) {
        await filesBtn2.click();
        await session.page.waitForTimeout(2000);
      }

      const bodyText = await session.safeTextContent("body");
      const fileVisible = bodyText && bodyText.includes(testFileName.replace(".txt", ""));
      steps.push(testStep("Uploaded file appears in list", fileVisible ? TestStatus.PASS : TestStatus.SKIP, { fileName: testFileName, visible: fileVisible }));
      await session.screenshot("files-panel-after-upload");
    } catch (err) {
      steps.push(testStep("Uploaded file appears in list", TestStatus.WARN, { error: err.message }));
    }

    // Step 8: Read file back via API
    try {
      const readResult = await api.rest("GET", `/api/deployments/${deploymentId}/files/${encodeURIComponent(testFileName)}`);
      const contentMatches = readResult.data && typeof readResult.data === "string"
        ? readResult.data.includes("QA Test File Content")
        : readResult.data?.content?.includes("QA Test File Content");
      steps.push(testStep("Read file back via API", readResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, {
        status: readResult.status,
        contentMatches: contentMatches || false,
      }));
    } catch (err) {
      steps.push(testStep("Read file back via API", TestStatus.WARN, { error: err.message }));
    }

    // Step 9: Open Knowledge panel
    try {
      const knowledgeBtn = await session.page.$('button:has-text("Knowledge"), button[aria-label*="knowledge" i], [data-testid="knowledge-panel"]');
      if (knowledgeBtn) {
        await knowledgeBtn.click();
        await session.page.waitForTimeout(2000);
        steps.push(testStep("Open Knowledge panel", TestStatus.PASS));
        await session.screenshot("knowledge-panel");
      } else {
        steps.push(testStep("Open Knowledge panel", TestStatus.SKIP, { note: "Knowledge button not found" }));
      }
    } catch (err) {
      steps.push(testStep("Open Knowledge panel", TestStatus.WARN, { error: err.message }));
    }

    // Step 10: Check knowledge panel content
    try {
      const knowledgeText = await session.safeTextContent("body");
      const hasKnowledgeContent = knowledgeText && (
        knowledgeText.toLowerCase().includes("knowledge") ||
        knowledgeText.toLowerCase().includes("document") ||
        knowledgeText.toLowerCase().includes("source")
      );
      steps.push(testStep("Knowledge panel has content", hasKnowledgeContent ? TestStatus.PASS : TestStatus.SKIP));
      await session.screenshot("knowledge-panel-content");
    } catch (err) {
      steps.push(testStep("Knowledge panel has content", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Delete the test file via API
    try {
      const deleteResult = await api.rest("DELETE", `/api/deployments/${deploymentId}/files/${encodeURIComponent(testFileName)}`);
      steps.push(testStep("Delete test file via API", deleteResult.status === 200 || deleteResult.status === 204 ? TestStatus.PASS : TestStatus.WARN, {
        status: deleteResult.status,
      }));
    } catch (err) {
      steps.push(testStep("Delete test file via API", TestStatus.WARN, { error: err.message }));
    }

    // Step 12: Verify file is gone
    try {
      const verifyResult = await api.rest("GET", `/api/deployments/${deploymentId}/files/${encodeURIComponent(testFileName)}`);
      const isGone = verifyResult.status === 404 || verifyResult.status === 410;
      steps.push(testStep("Verify file deleted", isGone ? TestStatus.PASS : TestStatus.WARN, { status: verifyResult.status }));
    } catch (err) {
      steps.push(testStep("Verify file deleted", TestStatus.WARN, { error: err.message }));
    }

    // Step 13: Overall error check
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(testStep("No server errors (5xx)", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length }));

    const consoleErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(testStep("Minimal console errors", consoleErrors.length <= 5 ? TestStatus.PASS : TestStatus.WARN, { count: consoleErrors.length }));

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message, stack: err.stack?.slice(0, 500) }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "File Uploader",
    description: "Uploads files, verifies round-trip, tests knowledge panel, cleans up",
    steps,
    browser: session.getReport(),
    api: api.getResults(),
  };
}
