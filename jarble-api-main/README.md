# Jarble API

Express + tRPC backend service for Jarble. Runs in K3s cluster.

## Tech Stack

- **Express.js** - HTTP server
- **tRPC** - Type-safe API
- **Drizzle ORM** - Database (MySQL/RDS)
- **@kubernetes/client-node** - K8s pod management
- **jose** - JWT verification (Auth0)

## Development

```bash
# Install dependencies
npm install

# Copy env file and configure
cp .env.example .env

# Run in development
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build
```

## API Endpoints

All endpoints use tRPC at `/trpc/*`:

- `user.me` - Get current user
- `user.getProfile` - Get user profile
- `bot.list` - List user's bots
- `bot.create` - Create new bot
- `bot.delete` - Delete bot
- `bot.getStatus` - Get K8s pod status
- `tier.list` - List subscription tiers
- `template.list` - List bot templates
- `openrouter.models` - List LLM models

Health check at `GET /health`

## Deployment

### Docker

```bash
docker build -t jarble/api:latest .
docker push jarble/api:latest
```

### Kubernetes

```bash
# Create namespace (if not exists)
kubectl create namespace jarble

# Create secrets (copy and edit first!)
cp k8s/secrets.yaml.example k8s/secrets.yaml
# Edit k8s/secrets.yaml with real values
kubectl apply -f k8s/secrets.yaml

# Deploy
kubectl apply -f k8s/deployment.yaml

# Check status
kubectl get pods -n jarble -l app=jarble-api
kubectl logs -n jarble -l app=jarble-api
```

## Project Structure

```
src/
├── index.ts              # Express entry point
├── trpc/
│   ├── index.ts          # Router exports
│   ├── context.ts        # Request context
│   ├── middleware.ts     # tRPC setup
│   └── routers/          # API routers
├── db/
│   ├── index.ts          # Drizzle client
│   └── schema.ts         # Table definitions
├── k8s/
│   └── bot-deployment.ts # K8s operations
├── services/
│   └── auth.ts           # JWT verification
└── utils/
    ├── env.ts            # Environment config
    └── logger.ts         # Pino logger
```

## Environment Variables

See `.env.example` for all required variables.
