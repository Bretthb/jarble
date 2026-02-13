# Step Functions - Bot Deployment Pipeline

AWS Step Functions state machine for orchestrating bot deployments.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Bot Deployment Pipeline                       │
├─────────────────────────────────────────────────────────────────┤
│  Start → CreateApiKey → TriggerBuild → WaitForBuild →          │
│  SetupEFS → DeployContainer → HealthCheck → Complete            │
└─────────────────────────────────────────────────────────────────┘
```

## State Machine Definition

```json
{
  "Comment": "Jarble Bot Deployment Pipeline",
  "StartAt": "UpdateStatusCreating",
  "States": {
    
    "UpdateStatusCreating": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "creating",
        "step": "init",
        "message": "Starting deployment..."
      },
      "Next": "CreateOpenRouterKey"
    },

    "CreateOpenRouterKey": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-create-openrouter-key",
      "Parameters": {
        "botId.$": "$.botId",
        "botName.$": "$.botName"
      },
      "ResultPath": "$.openRouterKey",
      "Next": "LogKeyCreated",
      "Catch": [{
        "ErrorEquals": ["States.ALL"],
        "Next": "DeploymentFailed",
        "ResultPath": "$.error"
      }]
    },

    "LogKeyCreated": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "creating",
        "step": "openrouter",
        "message": "API key created"
      },
      "Next": "UpdateStatusBuilding"
    },

    "UpdateStatusBuilding": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "building",
        "step": "codebuild",
        "message": "Starting image build..."
      },
      "Next": "TriggerCodeBuild"
    },

    "TriggerCodeBuild": {
      "Type": "Task",
      "Resource": "arn:aws:states:::codebuild:startBuild.sync",
      "Parameters": {
        "ProjectName": "jarble-bot-builder",
        "EnvironmentVariablesOverride": [
          {
            "Name": "BOT_ID",
            "Value.$": "$.botId",
            "Type": "PLAINTEXT"
          },
          {
            "Name": "BOT_PERSONALITY",
            "Value.$": "$.personality",
            "Type": "PLAINTEXT"
          },
          {
            "Name": "BOT_MODEL",
            "Value.$": "$.model",
            "Type": "PLAINTEXT"
          },
          {
            "Name": "OPENROUTER_KEY",
            "Value.$": "$.openRouterKey.apiKey",
            "Type": "PLAINTEXT"
          }
        ]
      },
      "ResultPath": "$.buildResult",
      "Next": "CheckBuildStatus",
      "Catch": [{
        "ErrorEquals": ["States.ALL"],
        "Next": "DeploymentFailed",
        "ResultPath": "$.error"
      }]
    },

    "CheckBuildStatus": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.buildResult.Build.BuildStatus",
          "StringEquals": "SUCCEEDED",
          "Next": "LogBuildComplete"
        },
        {
          "Variable": "$.buildResult.Build.BuildStatus",
          "StringEquals": "FAILED",
          "Next": "DeploymentFailed"
        }
      ],
      "Default": "DeploymentFailed"
    },

    "LogBuildComplete": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "deploying",
        "step": "codebuild",
        "message": "Image built and pushed to ECR"
      },
      "Next": "SetupEFS"
    },

    "SetupEFS": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-setup-efs",
      "Parameters": {
        "botId.$": "$.botId",
        "personality.$": "$.personality",
        "model.$": "$.model"
      },
      "ResultPath": "$.efsResult",
      "Next": "LogEFSReady",
      "Catch": [{
        "ErrorEquals": ["States.ALL"],
        "Next": "DeploymentFailed",
        "ResultPath": "$.error"
      }]
    },

    "LogEFSReady": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "deploying",
        "step": "efs",
        "message.$": "States.Format('Directory ready: {}', $.efsResult.efsPath)"
      },
      "Next": "DeployContainer"
    },

    "DeployContainer": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-deploy-container",
      "Parameters": {
        "botId.$": "$.botId",
        "imageTag.$": "States.Format('{}:latest', $.botId)",
        "efsPath.$": "$.efsResult.efsPath"
      },
      "ResultPath": "$.deployResult",
      "Next": "LogContainerStarted",
      "Catch": [{
        "ErrorEquals": ["States.ALL"],
        "Next": "DeploymentFailed",
        "ResultPath": "$.error"
      }]
    },

    "LogContainerStarted": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "deploying",
        "step": "container",
        "message.$": "States.Format('Container started: {}', $.deployResult.containerId)"
      },
      "Next": "WaitForHealth"
    },

    "WaitForHealth": {
      "Type": "Wait",
      "Seconds": 10,
      "Next": "HealthCheck"
    },

    "HealthCheck": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-health-check",
      "Parameters": {
        "botId.$": "$.botId"
      },
      "ResultPath": "$.healthResult",
      "Next": "CheckHealth",
      "Retry": [{
        "ErrorEquals": ["States.ALL"],
        "IntervalSeconds": 5,
        "MaxAttempts": 3,
        "BackoffRate": 2
      }],
      "Catch": [{
        "ErrorEquals": ["States.ALL"],
        "Next": "DeploymentFailed",
        "ResultPath": "$.error"
      }]
    },

    "CheckHealth": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.healthResult.status",
          "StringEquals": "running",
          "Next": "DeploymentComplete"
        }
      ],
      "Default": "DeploymentFailed"
    },

    "DeploymentComplete": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "running",
        "step": "complete",
        "message": "🚀 Bot deployed successfully!",
        "containerId.$": "$.deployResult.containerId",
        "efsPath.$": "$.efsResult.efsPath"
      },
      "End": true
    },

    "DeploymentFailed": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-update-bot-status",
      "Parameters": {
        "botId.$": "$.botId",
        "status": "error",
        "step": "error",
        "message.$": "$.error.Cause"
      },
      "Next": "FailState"
    },

    "FailState": {
      "Type": "Fail",
      "Error": "DeploymentFailed",
      "Cause": "Bot deployment failed - check logs"
    }
  }
}
```

## Visual Flow

```
                    ┌──────────────────┐
                    │      Start       │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ CreateApiKey     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ TriggerCodeBuild │──────────┐
                    └────────┬─────────┘          │
                             │                    │ (sync - waits
                             │                    │  for completion)
                             ▼                    │
                    ┌──────────────────┐          │
                    │ CheckBuildStatus │◄─────────┘
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │ SUCCEEDED    │              │ FAILED
              ▼              │              ▼
     ┌──────────────┐        │     ┌──────────────────┐
     │  SetupEFS    │        │     │ DeploymentFailed │
     └──────┬───────┘        │     └────────┬─────────┘
            │                │              │
            ▼                │              ▼
    ┌───────────────┐        │     ┌──────────────────┐
    │DeployContainer│        │     │    FailState     │
    └───────┬───────┘        │     └──────────────────┘
            │                │
            ▼                │
    ┌───────────────┐        │
    │ WaitForHealth │        │
    │  (10 seconds) │        │
    └───────┬───────┘        │
            │                │
            ▼                │
    ┌───────────────┐        │
    │  HealthCheck  │────────┘
    └───────┬───────┘    (unhealthy)
            │
            │ (healthy)
            ▼
    ┌───────────────────┐
    │DeploymentComplete │
    │        ✅         │
    └───────────────────┘
```

## Lambda Functions Required

| Function | Purpose |
|----------|---------|
| `jarble-update-bot-status` | Updates bot status + logs in RDS |
| `jarble-create-openrouter-key` | Creates per-bot OpenRouter API key |
| `jarble-setup-efs` | Creates bot directory, writes SOUL.md |
| `jarble-deploy-container` | Calls Deploy API to start container |
| `jarble-health-check` | Calls Deploy API to check container health |

## Lambda: Update Bot Status

```javascript
// jarble-update-bot-status/index.js
const mysql = require('mysql2/promise');

exports.handler = async (event) => {
  const { botId, status, step, message, containerId, efsPath } = event;
  
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Get current logs
  const [rows] = await connection.execute(
    'SELECT deploymentLogs FROM bots WHERE id = ?', 
    [botId]
  );
  
  const logs = JSON.parse(rows[0]?.deploymentLogs || '[]');
  logs.push({
    timestamp: new Date().toISOString(),
    step,
    message,
    status: status === 'error' ? 'error' : 'success'
  });
  
  // Update bot
  await connection.execute(`
    UPDATE bots SET 
      status = ?,
      deploymentStep = ?,
      deploymentLogs = ?,
      containerId = COALESCE(?, containerId),
      efsPath = COALESCE(?, efsPath),
      updatedAt = NOW()
    WHERE id = ?
  `, [status, step, JSON.stringify(logs), containerId, efsPath, botId]);
  
  await connection.end();
  
  return { success: true };
};
```

## Lambda: Deploy Container

```javascript
// jarble-deploy-container/index.js
exports.handler = async (event) => {
  const { botId, imageTag, efsPath } = event;
  
  const response = await fetch(`${process.env.DEPLOY_API_URL}/deploy/${botId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.DEPLOY_API_KEY
    },
    body: JSON.stringify({ imageTag, efsPath })
  });
  
  if (!response.ok) {
    throw new Error(`Deploy failed: ${await response.text()}`);
  }
  
  return await response.json();
};
```

## Lambda: Health Check

```javascript
// jarble-health-check/index.js
exports.handler = async (event) => {
  const { botId } = event;
  
  const response = await fetch(`${process.env.DEPLOY_API_URL}/status/${botId}`, {
    headers: { 'X-API-Key': process.env.DEPLOY_API_KEY }
  });
  
  if (!response.ok) {
    throw new Error(`Health check failed: ${await response.text()}`);
  }
  
  const result = await response.json();
  
  if (result.status !== 'running') {
    throw new Error(`Container not running: ${result.status}`);
  }
  
  return result;
};
```

## Triggering from Jarble API

```typescript
// server/stepfunctions.ts
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({ region: 'us-east-1' });

export async function startBotDeployment(bot: Bot) {
  const command = new StartExecutionCommand({
    stateMachineArn: 'arn:aws:states:us-east-1:590944885577:stateMachine:jarble-bot-deploy',
    name: `deploy-${bot.id}-${Date.now()}`,
    input: JSON.stringify({
      botId: bot.id.toString(),
      botName: bot.name,
      personality: bot.personality,
      model: bot.model
    })
  });
  
  const result = await sfn.send(command);
  return result.executionArn;
}
```

## IAM Role for Step Functions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:us-east-1:590944885577:function:jarble-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "codebuild:StartBuild",
        "codebuild:StopBuild",
        "codebuild:BatchGetBuilds"
      ],
      "Resource": "arn:aws:codebuild:us-east-1:590944885577:project/jarble-bot-builder"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogDelivery",
        "logs:GetLogDelivery",
        "logs:UpdateLogDelivery",
        "logs:DeleteLogDelivery",
        "logs:ListLogDeliveries",
        "logs:PutResourcePolicy",
        "logs:DescribeResourcePolicies",
        "logs:DescribeLogGroups"
      ],
      "Resource": "*"
    }
  ]
}
```

## AWS CLI: Create State Machine

```bash
aws stepfunctions create-state-machine \
  --name jarble-bot-deploy \
  --definition file://state-machine.json \
  --role-arn arn:aws:iam::590944885577:role/JarbleStepFunctionsRole \
  --type STANDARD \
  --logging-configuration '{
    "level": "ALL",
    "includeExecutionData": true,
    "destinations": [{
      "cloudWatchLogsLogGroup": {
        "logGroupArn": "arn:aws:logs:us-east-1:590944885577:log-group:/aws/stepfunctions/jarble-bot-deploy"
      }
    }]
  }'
```

## Monitoring

View executions in AWS Console:
```
https://console.aws.amazon.com/states/home?region=us-east-1#/statemachines/view/arn:aws:states:us-east-1:590944885577:stateMachine:jarble-bot-deploy
```

Each execution shows:
- Visual flow with current state highlighted
- Input/output for each step
- Timing for each step
- Error details if failed

## Cost

- Step Functions: $0.025 per 1,000 state transitions
- ~10 states per deployment = $0.00025 per bot deployment
- 1,000 bot deployments = $0.25

Essentially free.
