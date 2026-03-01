import { createDeployment } from './src/k8s/deployment.js';

const deploymentId = 'test-' + Date.now().toString(36);
const userId = 'test-local';

console.log(`Creating deployment: dep-${deploymentId}`);

try {
  await createDeployment(deploymentId, userId, {
    name: 'Local Test Bot',
    runtime: 'openclaw',
    cpuLimit: '0.5',
    memoryMb: 512,
    storageMb: 5,
  });
  console.log(`✅ Created dep-${deploymentId} — now watching pods...`);
} catch (err: any) {
  console.error('❌ Failed:', err.message);
  process.exit(1);
}
