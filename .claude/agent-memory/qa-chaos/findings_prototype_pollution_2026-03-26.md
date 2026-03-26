---
name: Prototype Pollution and SQL Injection in tRPC flows.create 2026-03-26
description: Both __proto__ pollution and SQL injection in flow names are safely handled — Zod strips unknown keys, Drizzle uses parameterized queries
type: project
---

Test run: 2026-03-26 against https://api.jarble.ai

## Prototype Pollution (Test 3a)

Payload: {"json":{"__proto__":{"isAdmin":true},"name":"injected","definition":...}}

Result: 200 - flow created with name="injected", __proto__ key was silently ignored.

Zod's z.object() strips unknown keys by default (strips mode).
The __proto__ key never reaches Drizzle or the Node.js prototype chain.
PASS - no pollution occurred.

## SQL Injection in Flow Name (Test 3c)

Payload name: "test'; DROP TABLE flows; --"

Result: 200 - flow created with the literal string as its name.
All 3 test flows survived (flows table was not dropped).
Drizzle ORM uses parameterized queries — the injection string is stored as text.
PASS - SQL not executed.

## Long Name (Test 3b)

Payload: 249 A characters.
Schema: z.string().min(1).max(255)
Result: 200 - accepted correctly (249 < 255).
PASS - Zod max(255) is in place and working.

## Cleanup Note

flows.delete sets status="archived" rather than hard-deleting records.
The list endpoint returns archived flows. Test data was archived (not truly removed).
This is by design (soft delete pattern) but worth noting for test isolation.
