# Jarble Features

This directory contains specifications for specific features that span multiple agents/components.

## Features Index

| Feature | Status | Owner(s) | Description |
|---------|--------|----------|-------------|
| [Dynamic Personality Sync](./PERSONALITY_SYNC.md) | Planned | Backend, Frontend | Bots learn and mirror user communication style |

## Adding New Features

When adding a feature spec:

1. Create `FEATURE_NAME.md` in this directory
2. Add entry to this README
3. Update relevant agent specs with implementation details
4. Add to High Level Kanban in Notion
5. Create work items in Work Tracker

## Feature Template

```markdown
# Feature Name

## Overview
One paragraph explaining what this feature does and why.

## How It Works
Technical explanation with diagrams if helpful.

## Implementation
### Backend
- Schema changes
- API endpoints

### Frontend  
- New components
- UI flows

### Infrastructure
- Any AWS/deployment changes

## Privacy & Security
Data handling, user controls.

## Success Metrics
How we know it's working.
```
