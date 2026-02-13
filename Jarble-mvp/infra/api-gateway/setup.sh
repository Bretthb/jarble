#!/bin/bash
# Phase 1: Create API Gateway with /health endpoint
# Run: ./setup.sh

set -e

REGION="us-east-1"
API_NAME="jarble-api"

echo "Creating API Gateway..."

# Create HTTP API
API_ID=$(aws apigatewayv2 create-api \
  --name "$API_NAME" \
  --protocol-type HTTP \
  --cors-configuration '{
    "AllowOrigins": ["http://localhost:3000", "https://jarble.ai", "https://*.vercel.app"],
    "AllowMethods": ["GET", "POST", "DELETE", "OPTIONS"],
    "AllowHeaders": ["Content-Type", "Authorization", "x-api-key"],
    "MaxAge": 86400
  }' \
  --region "$REGION" \
  --query 'ApiId' \
  --output text)

echo "API Gateway created: $API_ID"

# Create /health route with mock integration
aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key "GET /health" \
  --region "$REGION"

# Create mock integration for /health
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type HTTP_PROXY \
  --integration-method GET \
  --integration-uri "https://httpbin.org/get" \
  --region "$REGION" \
  --query 'IntegrationId' \
  --output text)

# Actually, let's use a Lambda for proper response
# First create the Lambda

echo "Creating health check Lambda..."

# Create Lambda execution role
ROLE_ARN=$(aws iam create-role \
  --role-name jarble-lambda-basic \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' \
  --query 'Role.Arn' \
  --output text 2>/dev/null || \
  aws iam get-role --role-name jarble-lambda-basic --query 'Role.Arn' --output text)

echo "Lambda role: $ROLE_ARN"

# Attach basic execution policy
aws iam attach-role-policy \
  --role-name jarble-lambda-basic \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

# Wait for role to propagate
sleep 10

# Create Lambda function
cd "$(dirname "$0")"
zip -j health-lambda.zip health-lambda.js

LAMBDA_ARN=$(aws lambda create-function \
  --function-name jarble-health \
  --runtime nodejs18.x \
  --role "$ROLE_ARN" \
  --handler index.handler \
  --zip-file fileb://health-lambda.zip \
  --region "$REGION" \
  --query 'FunctionArn' \
  --output text 2>/dev/null || \
  aws lambda update-function-code \
    --function-name jarble-health \
    --zip-file fileb://health-lambda.zip \
    --region "$REGION" \
    --query 'FunctionArn' \
    --output text)

echo "Lambda created: $LAMBDA_ARN"

# Add Lambda permission for API Gateway
aws lambda add-permission \
  --function-name jarble-health \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:*:$API_ID/*" \
  --region "$REGION" 2>/dev/null || true

# Create Lambda integration
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$LAMBDA_ARN" \
  --payload-format-version "2.0" \
  --region "$REGION" \
  --query 'IntegrationId' \
  --output text)

echo "Integration created: $INTEGRATION_ID"

# Update route to use Lambda integration
ROUTE_ID=$(aws apigatewayv2 get-routes \
  --api-id "$API_ID" \
  --region "$REGION" \
  --query 'Items[?RouteKey==`GET /health`].RouteId' \
  --output text)

aws apigatewayv2 update-route \
  --api-id "$API_ID" \
  --route-id "$ROUTE_ID" \
  --target "integrations/$INTEGRATION_ID" \
  --region "$REGION"

# Create default stage with auto-deploy
aws apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name '$default' \
  --auto-deploy \
  --region "$REGION"

# Get the API endpoint
ENDPOINT=$(aws apigatewayv2 get-api \
  --api-id "$API_ID" \
  --region "$REGION" \
  --query 'ApiEndpoint' \
  --output text)

echo ""
echo "=========================================="
echo "✅ API Gateway created!"
echo "=========================================="
echo "API ID: $API_ID"
echo "Endpoint: $ENDPOINT"
echo ""
echo "Test it:"
echo "  curl $ENDPOINT/health"
echo ""
echo "Add to Jarble .env.local:"
echo "  NEXT_PUBLIC_API_GATEWAY_URL=$ENDPOINT"
echo "=========================================="

# Save config
cat > config.json <<EOF
{
  "apiId": "$API_ID",
  "endpoint": "$ENDPOINT",
  "region": "$REGION",
  "lambdaArn": "$LAMBDA_ARN"
}
EOF

echo "Config saved to config.json"
