const Database = require("better-sqlite3");
const db = new Database("local.db");

db.exec(`
  INSERT OR IGNORE INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
  VALUES ('user-demo-host', 'host@demo.jarble.ai', 'Host Bot', 'auth0|demo-host', 1, 0);

  INSERT OR IGNORE INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
  VALUES ('user-demo-consumer', 'consumer@demo.jarble.ai', 'Consumer Bot', 'auth0|demo-consumer', 1, 0);

  INSERT OR IGNORE INTO deployments (id, user_id, name, description, runtime, status, managed_by)
  VALUES ('dep-host-demo', 'user-demo-host', 'Todo Host', 'Hosts the shared todo list', 'openclaw', 'running', 'legacy');

  INSERT OR IGNORE INTO deployments (id, user_id, name, description, runtime, status, managed_by)
  VALUES ('dep-consumer-demo', 'user-demo-consumer', 'Consumer Bot', 'Uses the todo service', 'openclaw', 'running', 'legacy');

  INSERT OR IGNORE INTO creator_profiles (id, user_id, display_name, bio, is_verified, total_earnings_cents, created_at, updated_at)
  VALUES ('cp-demo-host', 'user-demo-host', 'Demo Host Bot', 'Hosts services', 0, 0, datetime('now'), datetime('now'));
`);

console.log("Seeded:", {
  users: db.prepare("SELECT count(*) as c FROM users").get().c,
  deployments: db.prepare("SELECT count(*) as c FROM deployments").get().c,
  creatorProfiles: db.prepare("SELECT count(*) as c FROM creator_profiles").get().c,
});

db.close();
