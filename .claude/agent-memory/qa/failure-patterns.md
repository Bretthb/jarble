# Failure Patterns

Recurring issues discovered by QA agents and their root causes.

## Format

Each entry should include:
- **Pattern**: What the failure looks like
- **Root cause**: Why it happens
- **Classification**: REAL_BUG | FLAKY | ENVIRONMENT | EXPECTED_CHANGE
- **First seen**: Date
- **Frequency**: How often it occurs
- **Resolution**: Fix applied or workaround

---

### FP-001: tRPC SuperJSON input format requires wrapped objects

- **Pattern**: Calling `runtimeCatalog.getBySlug?input={"json":"openclaw"}` returns 400. Calling `marketplace.browse` with no input returns 400.
- **Root cause**: tRPC + SuperJSON requires all inputs to be wrapped in `{"json": {...}}` even for simple string params or all-default inputs. The procedure schemas use `z.object()` wrappers.
- **Classification**: EXPECTED_CHANGE (not a bug — this is how tRPC works)
- **First seen**: 2026-03-24
- **Frequency**: Every time (deterministic)
- **Resolution**: Always use `?input={"json":{"slug":"value"}}` format for object inputs, `?input={"json":{}}` for procedures with all-optional inputs.
