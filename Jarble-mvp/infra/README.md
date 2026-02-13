# Jarble Infrastructure

AWS infrastructure setup scripts for Jarble.

## Prerequisites

- AWS CLI installed and configured (`aws configure`)
- Appropriate IAM permissions (API Gateway, Lambda, IAM)

## Phase 1: API Gateway

```bash
cd api-gateway
./setup.sh
```

This creates:
- HTTP API Gateway
- `/health` route with Lambda integration
- CORS configuration for Jarble domains

Output:
- API endpoint URL (add to `.env.local` as `NEXT_PUBLIC_API_GATEWAY_URL`)
- `config.json` with all resource IDs

### Test it:

```bash
# After running setup.sh
curl https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/health
```

Expected response:
```json
{
  "ok": true,
  "service": "jarble-api",
  "timestamp": "2026-02-12T05:30:00.000Z",
  "region": "us-east-1"
}
```

### Verify in Jarble:

1. Add API Gateway URL to `.env.local`:
   ```
   NEXT_PUBLIC_API_GATEWAY_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com
   ```

2. Start dev server: `npm run dev`

3. Add `<ApiHealthCheck />` component to a page and click "Check Health"

## Cleanup

```bash
# Delete API Gateway
aws apigatewayv2 delete-api --api-id YOUR_API_ID

# Delete Lambda
aws lambda delete-function --function-name jarble-health

# Delete IAM role
aws iam detach-role-policy --role-name jarble-lambda-basic --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name jarble-lambda-basic
```

## Next Phases

- Phase 2: Add `/build` route → Lambda → CodeBuild
- Phase 3: Add `/internal/*` routes → Lambdas → RDS
- Phase 4: Add `/deploy/*` routes → VPC Link → EC2
- Phase 5: Full integration testing
