# Jarble Platform Diagrams (Mermaid)

> These diagrams render natively in Notion code blocks with `mermaid` language.
> **FINAL Architecture:** ECS Fargate + EFS + Single Base Image

---

## Architecture Overview

```
Frontend (Vercel) → API Gateway → ECS Fargate → Base Image + EFS
```

---

## 1. High-Level Architecture

```mermaid
flowchart TB
    subgraph Frontend["🌐 Vercel"]
        UI[Next.js Dashboard]
    end

    subgraph Auth["🔐 Auth0"]
        Login[OAuth]
    end

    subgraph AWS["☁️ AWS"]
        APIGW[API Gateway<br/>api.jarble.ai]
        ECR[(ECR<br/>jarble-bot:base)]
        
        subgraph Fargate["🚀 ECS Fargate"]
            Bot1[🤖 Bot 1]
            Bot2[🤖 Bot 2]
            Bot3[🤖 Bot N]
        end
        
        EFS[(📁 EFS<br/>/bots/)]
        RDS[(MySQL RDS)]
    end

    subgraph External["External"]
        OR[OpenRouter]
        WA[WhatsApp]
    end

    UI --> Login --> APIGW
    APIGW --> Fargate
    ECR --> Bot1 & Bot2 & Bot3
    EFS <--> Bot1 & Bot2 & Bot3
    Bot1 & Bot2 & Bot3 --> OR
    WA <--> Bot1 & Bot2 & Bot3
```

---

## 2. Request Flow

```mermaid
flowchart LR
    A[Frontend] -->|HTTPS| B[API Gateway]
    B -->|routes| C[ECS Fargate]
    C -->|pulls| D[Base Image]
    C -->|mounts| E[EFS]
    
    style C fill:#326ce5
    style E fill:#7aa116
```

Simple: Frontend → API Gateway → Fargate (base image + EFS mount)

---

## 3. Bot Deployment Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant F as Frontend
    participant API as API Gateway
    participant EFS as EFS
    participant ECS as Fargate

    U->>F: Create bot
    F->>API: POST /bots
    API->>EFS: Create /bots/{id}/
    API->>EFS: Write .env, SOUL.md
    API->>ECS: RunTask(base-image, EFS mount)
    ECS-->>API: Task running
    API-->>F: Bot deployed!
    F-->>U: Your bot is live!
```

---

## 4. EFS Directory Structure

```mermaid
flowchart TB
    subgraph EFS["📁 EFS /bots/"]
        subgraph B1["bot-abc123/"]
            env1[".env"]
            soul1["SOUL.md"]
            mem1["MEMORY.md"]
            skills1["skills/"]
        end
        subgraph B2["bot-xyz789/"]
            env2[".env"]
            soul2["SOUL.md"]
            skills2["skills/"]
        end
    end

    subgraph Fargate["🚀 Fargate Tasks"]
        T1["bot-abc123<br/>jarble-bot:base"]
        T2["bot-xyz789<br/>jarble-bot:base"]
    end

    B1 <-->|mount| T1
    B2 <-->|mount| T2
    
    style EFS fill:#e1f5fe
```

---

## 5. Skills Installation

```mermaid
sequenceDiagram
    participant U as User
    participant API as API Gateway
    participant EFS as EFS
    participant Bot as Bot Task

    U->>API: Install skill
    API->>EFS: Write to /bots/{id}/skills/{skill}/
    EFS-->>Bot: Files appear in mount
    Bot->>Bot: Hot reload
    API-->>U: Skill ready!
    
    Note over EFS,Bot: No restart needed!
```

Skills = files on EFS. Bot hot-reloads automatically.

---

## 6. Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant F as Frontend
    participant A0 as Auth0
    participant API as API Gateway
    participant DB as MySQL

    U->>F: Click Login
    F->>A0: Redirect
    U->>A0: Login (Google/GitHub)
    A0->>F: Return with token
    F->>API: Request + Bearer token
    API->>API: Validate JWT
    API->>DB: Get/create user
    API-->>F: Response
    F-->>U: Dashboard
```

---

## 7. Fargate Task Definition

```mermaid
flowchart TB
    subgraph ECR["📦 ECR"]
        BASE["jarble-bot:base"]
    end
    
    subgraph Fargate["🚀 Fargate Task"]
        Container["OpenClaw Runtime"]
        Workspace["/app/workspace"]
    end
    
    subgraph EFS["📁 EFS"]
        BotDir["/bots/{id}/"]
    end
    
    subgraph Config["Task Config"]
        CPU["0.25 vCPU"]
        MEM["512 MB"]
        ENV["BOT_ID, secrets"]
    end

    BASE --> Container
    BotDir <-->|mount| Workspace
    Config --> Fargate
```

---

## 8. Billing Flow

```mermaid
flowchart LR
    subgraph Fargate
        Bot[🤖 Bot]
    end

    subgraph OpenRouter
        LLM[LLM API]
        Usage[Usage Metrics]
    end

    subgraph Jarble
        Billing[Billing Lambda]
        DB[(Usage DB)]
    end

    subgraph Stripe
        Sub[Subscription]
    end

    Bot -->|calls| LLM
    LLM --> Usage
    Billing -->|query| Usage
    Billing -->|35% markup| DB
    Billing -->|report| Sub
```

---

## 9. Scaling Path

```mermaid
flowchart LR
    subgraph MVP["MVP"]
        F1["Fargate<br/>10-20 bots<br/>~$40/mo"]
        E1[(EFS)]
    end

    subgraph Growth["Growth"]
        F2["Fargate<br/>auto-scales"]
        E2[(EFS grows)]
    end

    subgraph Enterprise["V2"]
        ORG["AWS Orgs"]
        ISO["Per-tenant"]
    end

    MVP -->|more bots| Growth
    Growth -->|enterprise| Enterprise
```

Fargate auto-scales. EFS grows automatically. No infrastructure changes.

---

## 10. Why Fargate (20x Simpler)

```mermaid
flowchart TB
    subgraph NoMore["❌ Don't Need"]
        EC2["EC2 management"]
        Scale["Scaling config"]
        Patch["OS patching"]
        Cap["Capacity planning"]
    end

    subgraph Fargate["✅ Fargate Handles"]
        Auto["Auto-scaling"]
        Health["Health checks"]
        LB["Load balancing"]
        Recovery["Task recovery"]
    end

    NoMore -->|replaced by| Fargate
    
    style NoMore fill:#ffcdd2
    style Fargate fill:#c8e6c9
```

---

## Key Points

- **Single base image** (`jarble-bot:base`) for ALL bots
- **EFS** stores bot identity (.env, SOUL.md, skills, memory)
- **Fargate** runs containers serverlessly
- **No CodeBuild** for bot creation
- **No per-bot images**
- **Flow:** Frontend → API Gateway → Fargate (base + EFS)

---

## Usage in Notion

1. Create a **Code Block**
2. Set language to **Mermaid**
3. Paste diagram code
4. Notion renders it automatically
