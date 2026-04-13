-- Drop all Marketplace tables.
-- Code that referenced these was removed in PR #131 (cleanup: remove Marketplace).
-- CASCADE is used so FK constraints / dependent views are dropped automatically;
-- drop order is not significant with CASCADE, but it's ordered children-first for readability.

-- Component marketplace (leaves)
DROP TABLE IF EXISTS component_installs CASCADE;
DROP TABLE IF EXISTS component_purchases CASCADE;
DROP TABLE IF EXISTS component_reviews CASCADE;
DROP TABLE IF EXISTS component_versions CASCADE;

-- Service/package marketplace (leaves)
DROP TABLE IF EXISTS package_components CASCADE;
DROP TABLE IF EXISTS package_skills CASCADE;
DROP TABLE IF EXISTS package_credentials CASCADE;
DROP TABLE IF EXISTS package_usage CASCADE;
DROP TABLE IF EXISTS service_reviews CASCADE;
DROP TABLE IF EXISTS service_rate_limits CASCADE;
DROP TABLE IF EXISTS service_circuit_breakers CASCADE;
DROP TABLE IF EXISTS service_heartbeats CASCADE;
DROP TABLE IF EXISTS service_async_jobs CASCADE;
DROP TABLE IF EXISTS service_benchmark_samples CASCADE;
DROP TABLE IF EXISTS service_benchmark_aggregates CASCADE;
DROP TABLE IF EXISTS package_installs CASCADE;

-- Marketplace parent tables
DROP TABLE IF EXISTS marketplace_components CASCADE;
DROP TABLE IF EXISTS marketplace_packages CASCADE;
DROP TABLE IF EXISTS creator_profiles CASCADE;

-- Deployment rating / domain system (unused; tracked per earlier audit)
DROP TABLE IF EXISTS deployment_ratings CASCADE;
DROP TABLE IF EXISTS deployment_domain_scores CASCADE;
DROP TABLE IF EXISTS domains CASCADE;
