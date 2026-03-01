/**
 * One-off script: creates K8s resources for a pending deployment.
 * Usage: npx tsx scripts/deploy-local.ts <deploymentId>
 */
import "dotenv/config";
import { createDeployment } from "../src/k8s/lifecycle.js";
import { db } from "../src/db/index.js";
import { sqliteSchema } from "../src/db/index.js";
import { eq } from "drizzle-orm";
import { getHandlerOrNull, type DeploymentFields } from "../src/runtimes/index.js";
import { COMPONENT_LIBRARY } from "../src/data/componentLibrary.js";
import crypto from "crypto";

const { deployments } = sqliteSchema;

async function main() {
  const deploymentId = process.argv[2];
  if (!deploymentId) {
    console.error("Usage: npx tsx scripts/deploy-local.ts <deploymentId>");
    process.exit(1);
  }

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
  });

  if (!deployment) {
    console.error(`Deployment ${deploymentId} not found`);
    process.exit(1);
  }

  console.log(`Deploying ${deploymentId} (${deployment.name})...`);

  // Update status to creating
  await db.update(deployments)
    .set({ status: "creating", error: null })
    .where(eq(deployments.id, deploymentId));

  // Decrypt API key (stored as plain: prefix in dev)
  const rawApiKey = deployment.llmApiKey?.startsWith("plain:")
    ? deployment.llmApiKey.slice(6)
    : deployment.llmApiKey;

  const gatewayToken = crypto.randomBytes(32).toString("hex");

  // Build runtime handler data
  const runtimeHandler = getHandlerOrNull(deployment.runtime);
  const deploymentFields: DeploymentFields = {
    id: deployment.id,
    runtime: deployment.runtime,
    name: deployment.name,
    description: deployment.description ?? null,
    systemPrompt: deployment.systemPrompt ?? null,
    llmMode: deployment.llmMode ?? "byok",
    llmProvider: deployment.llmProvider ?? "openrouter",
    llmModel: deployment.llmModel ?? null,
    llmApiKey: rawApiKey,
    platformCredentials: undefined,
    gatewayToken,
  };

  const initialConfigs = runtimeHandler?.renderConfigs(deploymentFields) ?? [];
  const extraSecretEntries = runtimeHandler?.getSecretEntries(deploymentFields) ?? {};

  // Seed component library
  for (const comp of COMPONENT_LIBRARY) {
    initialConfigs.push({
      path: `/data/components/${comp.name}.json`,
      content: JSON.stringify(comp, null, 2),
    });
  }

  try {
    await createDeployment(deploymentId, deployment.userId, {
      name: deployment.name,
      runtime: deployment.runtime,
      image: deployment.image || undefined,
      cpuLimit: deployment.cpuLimit || undefined,
      memoryMb: deployment.memoryMb || undefined,
      storageMb: deployment.storageMb || undefined,
      initialConfigs,
      extraSecretEntries,
      gatewayToken,
    });

    await db.update(deployments)
      .set({ status: "running" })
      .where(eq(deployments.id, deploymentId));

    console.log(`Deployment ${deploymentId} created successfully and set to running!`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(deployments)
      .set({ status: "failed", error: message })
      .where(eq(deployments.id, deploymentId));
    console.error(`Deployment failed: ${message}`);
    process.exit(1);
  }

  process.exit(0);
}

main();
