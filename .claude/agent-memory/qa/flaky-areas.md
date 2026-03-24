# Flaky Areas

Areas of the platform that intermittently fail during QA testing. These are not real bugs — they pass sometimes and fail sometimes due to timing, race conditions, or environment state.

QA agents should expect these and not classify them as REAL_BUG.

## Format

Each entry should include:
- **Area**: What part of the platform
- **Symptom**: What the intermittent failure looks like
- **Likely cause**: Why it's flaky
- **Workaround**: How to reduce false positives (e.g., add wait time)
- **Frequency**: Roughly how often it fails (e.g., 1 in 3 runs)

---

(No flaky areas recorded yet — 2 runs completed, no intermittent failures observed. All failures have been deterministic environment issues.)
