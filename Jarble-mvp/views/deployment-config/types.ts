// Tab type - now dynamic based on runtime (see wizardStepConfig.ts → getConfigTabs)
export type Tab = string;

export interface PlatformConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  docsUrl: string;
  connected: boolean;
  credentials?: Record<string, string>;
  fields: {
    key: string;
    label: string;
    type: "text" | "password" | "textarea";
    placeholder: string;
    helpText?: string;
    required?: boolean;
  }[];
}

export const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    id: "discord",
    name: "Discord",
    icon: "🎮",
    description: "Connect your deployment to Discord servers",
    docsUrl: "https://discord.com/developers/docs/intro",
    connected: false,
    fields: [
      { key: "botToken", label: "Bot Token", type: "password", placeholder: "Enter your Discord bot token", helpText: "Get this from Discord Developer Portal > Bot > Token", required: true },
      { key: "applicationId", label: "Application ID", type: "text", placeholder: "Your application ID", helpText: "Found in Discord Developer Portal > General Information" },
      { key: "guildIds", label: "Server IDs (optional)", type: "text", placeholder: "Comma-separated server IDs", helpText: "Leave empty to allow all servers" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    icon: "📎",
    description: "Deploy to Slack workspaces",
    docsUrl: "https://api.slack.com/start",
    connected: false,
    fields: [
      { key: "botToken", label: "Bot User OAuth Token", type: "password", placeholder: "xoxb-...", helpText: "Found in OAuth & Permissions after installing to workspace", required: true },
      { key: "signingSecret", label: "Signing Secret", type: "password", placeholder: "Your app's signing secret", helpText: "Found in Basic Information > App Credentials", required: true },
      { key: "appToken", label: "App-Level Token (Socket Mode)", type: "password", placeholder: "xapp-...", helpText: "Required for Socket Mode - generate in Basic Information" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: "✈️",
    description: "Connect via Telegram Bot API",
    docsUrl: "https://core.telegram.org/bots",
    connected: false,
    fields: [
      { key: "botToken", label: "Bot Token", type: "password", placeholder: "123456789:ABCdef...", helpText: "Get this from @BotFather on Telegram", required: true },
      { key: "webhookSecret", label: "Webhook Secret (optional)", type: "password", placeholder: "A secret string for webhook verification", helpText: "Optional security measure for webhook requests" },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: "💬",
    description: "Connect via QR code scan",
    docsUrl: "https://faq.whatsapp.com/1317564962315842",
    connected: false,
    fields: [],
  },
  {
    id: "web",
    name: "Web Chat",
    icon: "🌐",
    description: "Embed chat widget on your website",
    docsUrl: "#",
    connected: false,
    fields: [
      { key: "allowedDomains", label: "Allowed Domains", type: "textarea", placeholder: "example.com\napp.example.com", helpText: "One domain per line. Leave empty to allow all domains." },
      { key: "primaryColor", label: "Primary Color", type: "text", placeholder: "#F59E0B", helpText: "Hex color for the chat widget" },
      { key: "welcomeMessage", label: "Welcome Message", type: "textarea", placeholder: "Hi! How can I help you today?", helpText: "Initial message shown when chat opens" },
    ],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    icon: "👥",
    description: "Deploy to Microsoft Teams",
    docsUrl: "https://docs.microsoft.com/en-us/microsoftteams/platform/",
    connected: false,
    fields: [
      { key: "appId", label: "App ID", type: "text", placeholder: "Your Teams app ID", helpText: "From Azure Bot Service registration", required: true },
      { key: "appPassword", label: "App Password", type: "password", placeholder: "Your app password/secret", helpText: "Client secret from Azure AD app registration", required: true },
      { key: "tenantId", label: "Tenant ID (optional)", type: "text", placeholder: "Your Azure AD tenant ID", helpText: "Leave empty for multi-tenant apps" },
    ],
  },
  {
    id: "messenger",
    name: "Facebook Messenger",
    icon: "💬",
    description: "Connect to Facebook Messenger",
    docsUrl: "https://developers.facebook.com/docs/messenger-platform",
    connected: false,
    fields: [
      { key: "pageAccessToken", label: "Page Access Token", type: "password", placeholder: "Your page access token", helpText: "Generate in Meta for Developers > Messenger > Access Tokens", required: true },
      { key: "verifyToken", label: "Verify Token", type: "text", placeholder: "A token for webhook verification", helpText: "You create this - used during webhook setup", required: true },
      { key: "appSecret", label: "App Secret", type: "password", placeholder: "Your Facebook app secret", helpText: "Found in App Dashboard > Settings > Basic" },
    ],
  },
];

export interface DeploymentFormData {
  name: string;
  description: string;
  modelProvider: string;
  modelName: string;
  apiKey: string;
  systemPrompt: string;
  platforms: string[];
  skills: string[];
}

export interface TabProps {
  formData: DeploymentFormData;
  updateFormData: (key: string, value: string | number | string[]) => void;
}

export interface ModelTabProps extends TabProps {
  deployment?: any;
  deploymentId: string;
}

export interface PlatformsTabProps extends TabProps {
  deploymentId: string;
}
