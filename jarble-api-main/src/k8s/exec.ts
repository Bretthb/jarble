import stream from "stream";
import { logger } from "../utils/logger.js";
import { coreApi, execClient } from "./client.js";
import { NAMESPACE, LEGACY_CONTAINER_NAME, getContainerName, podLabelSelector } from "./constants.js";
import type { ManagedBy } from "./constants.js";

/**
 * Execute a command in a pod (no stdin, capture stdout/stderr).
 */
export async function execInPod(
  podName: string,
  command: string[],
  containerName: string = LEGACY_CONTAINER_NAME
): Promise<string> {
  const stdout = new stream.PassThrough();
  const stderr = new stream.PassThrough();

  let stdoutData = "";
  let stderrData = "";
  stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
  stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

  await new Promise<void>((resolve, reject) => {
    execClient.exec(
      NAMESPACE,
      podName,
      containerName,
      command,
      stdout,
      stderr,
      null,
      false,
      (status) => {
        if (status.status === "Success") {
          resolve();
        } else {
          reject(new Error(`exec failed: ${status.message || stderrData || "unknown"}`));
        }
      }
    ).catch(reject);
  });

  return stdoutData;
}

/**
 * Execute a command in a pod with stdin content piped in.
 * Used for writing file contents via `cat > /path`.
 */
export async function execInPodWithStdin(
  podName: string,
  command: string[],
  stdinContent: string,
  timeoutMs: number = 30000,
  containerName: string = LEGACY_CONTAINER_NAME
): Promise<void> {
  const stdout = new stream.PassThrough();
  const stderr = new stream.PassThrough();

  // Create a Readable stream from the content for stdin
  const stdinStream = new stream.Readable();
  stdinStream.push(stdinContent);
  stdinStream.push(null); // signal EOF

  let stderrData = "";
  stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

  await new Promise<void>((resolve, reject) => {
    // Add timeout to prevent hanging forever
    const timeout = setTimeout(() => {
      reject(new Error(`execInPodWithStdin timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    execClient.exec(
      NAMESPACE,
      podName,
      containerName,
      command,
      stdout,
      stderr,
      stdinStream,
      false,
      (status) => {
        clearTimeout(timeout);
        if (status.status === "Success") {
          resolve();
        } else {
          reject(new Error(`exec failed: ${status.message || stderrData || "unknown"}`));
        }
      }
    ).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Execute a command in a pod with streaming stdout (long-running processes).
 * Unlike execInPod() which waits for exit, this streams output line-by-line.
 * Returns an abort handle to terminate the exec WebSocket.
 */
export async function streamExecInPod(
  podName: string,
  command: string[],
  onLine: (line: string) => void,
  onExit: (success: boolean, message?: string) => void,
  containerName: string = LEGACY_CONTAINER_NAME
): Promise<{ abort: () => void }> {
  const stdout = new stream.PassThrough();
  const stderr = new stream.PassThrough();
  let buffer = "";

  stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        onLine(line);
      }
    }
  });

  let stderrData = "";
  stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

  let execWs: any;
  try {
    execWs = await execClient.exec(
      NAMESPACE,
      podName,
      containerName,
      command,
      stdout,
      stderr,
      null,
      false,
      (status) => {
        // Flush remaining buffer
        if (buffer.trim()) {
          onLine(buffer);
          buffer = "";
        }
        onExit(status.status === "Success", status.message || stderrData || undefined);
      }
    );
  } catch (err: unknown) {
    onExit(false, err instanceof Error ? err.message : "exec failed to start");
    return { abort: () => {} };
  }

  return {
    abort: () => {
      try { execWs?.close?.(); } catch {}
    },
  };
}

/**
 * Find the running pod for a deployment.
 * Returns the pod name or null if no pod exists.
 *
 * @param requireReady - if true (default), pod must pass readiness probe.
 *   For exec operations (e.g. pairing commands), set false — the pod just needs
 *   to be in Running phase so we can exec into it.
 * @param managedBy - "legacy" or "operator" — determines label selector and container name
 */
export async function findPodForDeployment(
  deploymentId: string,
  opts?: { requireReady?: boolean; managedBy?: ManagedBy }
): Promise<string | null> {
  const requireReady = opts?.requireReady ?? true;
  const managedBy = opts?.managedBy ?? "legacy";
  const labelSelector = podLabelSelector(deploymentId, managedBy);
  const targetContainer = getContainerName(managedBy);

  const pods = await coreApi.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    labelSelector
  );

  if (pods.body.items.length === 0) return null;

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;

  // Find the correct container's status by name (operator pods have 2 containers)
  const containerStatus = pod.status?.containerStatuses?.find(
    (cs) => cs.name === targetContainer
  ) ?? pod.status?.containerStatuses?.[0];

  const isRunning = pod.status?.phase === "Running" &&
    (requireReady ? containerStatus?.ready : true);

  if (!podName || !isRunning) return null;
  return podName;
}

/**
 * Escape a value for use in single-quoted shell assignment.
 * Handles embedded single quotes: ' → '\''
 */
export function escapeShellValue(value: string): string {
  return value.replace(/'/g, "'\\''");
}
