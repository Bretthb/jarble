# Toadbot AI Bot Onboarding - Project TODO

## Core Features

### Authentication & User Management
- [x] User profile management (email, phone, first/last name)
- [x] Profile update functionality
- [x] User session persistence

### Wizard Onboarding Flow
- [x] Multi-step wizard component with progress indicator
- [x] Step 1: Account Information (email, phone, name)
- [x] Step 2: Tier Selection (Bronze, Silver, Gold, Platinum)
- [x] Step 3: Model Provider Selection (OpenAI, Anthropic, Google, etc.)
- [x] Step 4: API Key Configuration
- [x] Step 5: Platform Integration Selection (Discord, Slack, Telegram, Web)
- [x] Step 6: Skill Selection from ClawdHub
- [x] Step 7: Configuration Summary & Review
- [x] Step 8: Deployment & Confirmation
- [x] Step navigation (next, previous, skip where applicable)
- [x] Progress persistence

### Tiered Ranking System
- [x] Tier database schema (Bronze, Silver, Gold, Platinum)
- [x] Visual tier badges and indicators
- [x] Tier progression tracking
- [x] Resource allocation per tier
- [x] Tier selection UI in wizard

### Model Provider Integration
- [x] Model provider selection interface
- [x] API key configuration forms
- [x] Provider validation (secure server-side validation)
- [x] Multiple provider support
- [x] Provider status checking (validates and returns available models)

### Platform Integration
- [x] Platform selection UI (Discord, Slack, Telegram, Web)
- [x] Connection setup forms
- [x] Platform-specific configuration (Discord, Slack, Telegram, WhatsApp, Web Chat, Teams, Messenger)
- [x] Connection status indicators
- [x] Multiple platform support

### Skill Selection
- [x] ClawdHub API integration (mock data + server endpoints)
- [x] Skill category browsing
- [x] Skill search functionality
- [x] Top-ranked skills display
- [x] Skill selection and management
- [x] Selected skills display

### Bot Dashboard
- [x] Dashboard layout
- [x] Bot status display (running, stopped, error)
- [x] Active connections list (with status indicators)
- [x] Usage statistics (messages, requests, uptime, response time)
- [x] Real-time health indicators
- [x] Bot control actions (start, stop, restart)
- [x] Configuration view

### UI/UX & Design
- [x] Wizard theme integration (wizard character)
- [x] Loading animations from provided videos (WizardLoader component with video, progress bar, cycling messages)
- [x] Smooth transitions between wizard steps
- [x] Responsive design for all screen sizes
- [x] Professional and non-technical user-friendly interface
- [x] Color scheme and typography
- [x] Error handling and validation messages

### Testing
- [x] Unit tests for wizard logic
- [ ] Integration tests for onboarding flow
- [ ] API integration tests
- [x] Dashboard functionality tests

## Completed Items
(None yet)


## Rebranding Tasks (Toadbot → Jarble)

- [x] Rename project directory and all references
- [x] Update application title and branding
- [x] Integrate wizard character reference image
- [x] Add loading animations from video assets
- [x] Update color scheme if needed
- [x] Update all UI text and copy
- [x] Test all pages with new branding


## Bug Fixes

- [x] Fix 404 error when clicking "Start Creating" after logout


## UI Enhancements

- [x] Replace pricing tiers with scrolling integrations marquee
- [x] Fetch OpenClaw integrations data
- [x] Create clickable integration links

- [x] Implement search bar above integrations marquee
