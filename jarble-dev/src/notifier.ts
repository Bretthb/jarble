import type { CIEvent } from "./types.js";
import type { Logger } from "./logger.js";
import { EventEmitter } from "events";

export class Notifier {
  private webhookUrls: string[];
  private logger: Logger;
  private queue: Promise<void> = Promise.resolve();

  constructor(webhookUrls: string[], logger: Logger) {
    this.webhookUrls = webhookUrls;
    this.logger = logger;
    if (webhookUrls.length > 0) {
      this.logger.info(`Notifier configured with ${webhookUrls.length} webhook(s)`);
    }
  }

  /** Subscribe to CI events from the spawner */
  subscribe(emitter: EventEmitter): void {
    emitter.on("ci:event", (evt: CIEvent) => {
      this.queue = this.queue.then(() => this.notify(evt)).catch(() => {});
    });
  }

  /** POST an event to all webhook URLs */
  private async notify(event: CIEvent): Promise<void> {
    if (this.webhookUrls.length === 0) return;

    const body = JSON.stringify(event);

    const results = await Promise.allSettled(
      this.webhookUrls.map(async (url) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        this.logger.warn(
          `Webhook delivery failed for ${this.webhookUrls[i]}: ${result.reason}`,
        );
      }
    }
  }

  /** Wait for all pending notifications to complete */
  async flush(): Promise<void> {
    await this.queue;
  }
}
