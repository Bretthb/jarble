"use client";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthogInstance: any = null;

/**
 * Lazily initializes PostHog analytics.
 * The posthog-js library (~40KB) is only loaded when this function is called
 * and NEXT_PUBLIC_POSTHOG_KEY is set, keeping it out of the initial bundle.
 */
export async function initPostHog(): Promise<void> {
  if (initialized || !key || typeof window === "undefined") return;
  const { default: posthog } = await import("posthog-js");
  posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: false, // we handle manually
  });
  posthogInstance = posthog;
  initialized = true;
}

/**
 * Returns the PostHog instance, loading the library if needed.
 * Returns null if PostHog is not configured (no NEXT_PUBLIC_POSTHOG_KEY).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPostHog(): Promise<any> {
  if (!key || typeof window === "undefined") return null;
  if (!initialized) await initPostHog();
  return posthogInstance;
}
