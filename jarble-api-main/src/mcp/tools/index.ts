/**
 * MCP Tool Registry — Singleton that registers all available tools.
 *
 * Import `mcpRegistry` to access tools in the agent endpoint.
 */
import { ToolRegistry } from "../toolRegistry.js";
import { getDeploymentInfoTool } from "./getDeploymentInfo.js";
import { getPlatformsTool } from "./getPlatforms.js";
import { connectPlatformTool } from "./connectPlatform.js";
import { disconnectPlatformTool } from "./disconnectPlatform.js";
import { updateSystemPromptTool } from "./updateSystemPrompt.js";
import { updateLlmConfigTool } from "./updateLlmConfig.js";
import { listSkillsTool } from "./listSkills.js";
import { installSkillTool } from "./installSkill.js";
import { uninstallSkillTool } from "./uninstallSkill.js";
import { restartBotTool, stopBotTool, startBotTool } from "./lifecycle.js";
import { getLogsTool } from "./getLogs.js";
import { getWhatsappQrTool } from "./getWhatsappQr.js";
import { chatWithBotTool } from "./chatWithBot.js";
import { renderUiTool } from "./renderUi.js";
import { defineComponentTool } from "./defineComponent.js";
import { listComponentsTool } from "./listComponents.js";
import { deleteComponentTool } from "./deleteComponent.js";
import { listFilesTool } from "./listFiles.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";
import { pairingListTool, pairingApproveTool } from "./pairing.js";

export const mcpRegistry = new ToolRegistry();

// Read-only info tools
mcpRegistry.register(getDeploymentInfoTool);
mcpRegistry.register(getPlatformsTool);

// Platform management
mcpRegistry.register(connectPlatformTool);
mcpRegistry.register(disconnectPlatformTool);

// Config management
mcpRegistry.register(updateSystemPromptTool);
mcpRegistry.register(updateLlmConfigTool);

// Skills
mcpRegistry.register(listSkillsTool);
mcpRegistry.register(installSkillTool);
mcpRegistry.register(uninstallSkillTool);

// Lifecycle (confirmation only — no direct execution)
mcpRegistry.register(restartBotTool);
mcpRegistry.register(stopBotTool);
mcpRegistry.register(startBotTool);

// Observability
mcpRegistry.register(getLogsTool);

// WhatsApp QR
mcpRegistry.register(getWhatsappQrTool);

// Bot conversation proxy
mcpRegistry.register(chatWithBotTool);

// Canvas UI rendering
mcpRegistry.register(renderUiTool);
mcpRegistry.register(defineComponentTool);
mcpRegistry.register(listComponentsTool);
mcpRegistry.register(deleteComponentTool);

// Filesystem tools
mcpRegistry.register(listFilesTool);
mcpRegistry.register(readFileTool);
mcpRegistry.register(writeFileTool);

// Pairing management
mcpRegistry.register(pairingListTool);
mcpRegistry.register(pairingApproveTool);
