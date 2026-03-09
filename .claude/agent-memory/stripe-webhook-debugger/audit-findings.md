# Stripe Integration Audit Findings - 2026-02-18

## Critical Issues
1. Pending subscription race condition - no retry/polling if webhook arrives late
2. stopDeployment can throw on 404 (K8s deployment already deleted) - not idempotent for real K8s
3. checkout.session.completed does not handle null subscriptionId (one-time payments)
4. subscription.deleted handler does not clear stripeSubscriptionId on the deployment
5. No processedWebhookEvents cleanup - table grows unbounded

## Medium Issues
1. subscriptionEnforcement cancelledAt check on line 194 reads from updates obj not dep
2. Checkout route blocks returning users with existing stripeCustomerId even for new subscriptions
3. Delete deployment does not cancel Stripe subscription first

## Low Issues
1. No webhook event age check (Stripe can replay old events)
2. customer.subscription.updated only finds deployments by subscriptionId, misses pending state
3. linkSubscription fallback picks first unlinked sub regardless of product/runtime match
