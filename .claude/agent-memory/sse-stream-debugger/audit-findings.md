# SSE Audit Findings - 2026-02-18

## Full audit of all 3 SSE endpoints + 3 frontend hooks

### Bugs Found
1. No `res.flushHeaders()` on any endpoint (lines 508-513, 634-639, 665-670, 822-828)
2. QR mock log event field mismatch: `{message}` (line 641) vs real mode `{line}` (line 741)
3. useLogStream isPaused tracked but never gates incoming data
4. QR mock setTimeout (line 645) not cleared on req.close
5. Status stream delta events have no `event:` field (line 917) -- mismatch with snapshot using `event: snapshot`
6. Log stream EventSource auto-reconnect fires after server sends `end` event
7. Global rate limiter counts SSE connection establishment against 300/min IP limit
8. QR stream keepAlive interval not cleared on timeout path (line 760-766)
9. Status stream buildStatusSnapshot fires unawaited DB updates (line 869-873)
