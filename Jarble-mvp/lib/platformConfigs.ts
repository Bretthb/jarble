/**
 * Platform configuration schemas and helpers
 * Defines what fields each platform needs for connection
 */

export interface PlatformConfigField {
  name: string;
  label: string;
  type: "text" | "password" | "url" | "textarea";
  placeholder?: string;
  helpText?: string;
  helpUrl?: string;
  required?: boolean;
}

export interface PlatformConfig {
  platform: string;
  displayName: string;
  fields: PlatformConfigField[];
  setupInstructions: string;
  docsUrl?: string;
}

export const platformConfigs: Record<string, PlatformConfig> = {
  discord: {
    platform: "discord",
    displayName: "Discord",
    fields: [
      {
        name: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "MTIzNDU2Nzg5MDEyMzQ1Njc4OQ...",
        helpText: "Get this from the Discord Developer Portal → Bot → Token",
        helpUrl: "https://discord.com/developers/applications",
        required: true,
      },
      {
        name: "applicationId",
        label: "Application ID",
        type: "text",
        placeholder: "123456789012345678",
        helpText: "Found in General Information tab",
        required: true,
      },
      {
        name: "guildId",
        label: "Server ID (optional)",
        type: "text",
        placeholder: "123456789012345678",
        helpText: "If you want to restrict to a specific server. Right-click server → Copy Server ID",
        required: false,
      },
    ],
    setupInstructions: `
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to "Bot" tab → "Add Bot"
4. Copy the **Token** (click "Reset Token" if needed)
5. Enable **Message Content Intent** under Privileged Gateway Intents
6. Go to OAuth2 → URL Generator, select "bot" scope
7. Invite the bot to your server using the generated URL
    `.trim(),
    docsUrl: "https://discord.com/developers/docs/intro",
  },

  telegram: {
    platform: "telegram",
    displayName: "Telegram",
    fields: [
      {
        name: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
        helpText: "Get this from @BotFather on Telegram",
        helpUrl: "https://t.me/BotFather",
        required: true,
      },
    ],
    setupInstructions: `
1. Open Telegram and search for **@BotFather**
2. Send /newbot and follow the prompts
3. Choose a name and username for your bot
4. Copy the **HTTP API token** BotFather gives you
    `.trim(),
    docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
  },

  slack: {
    platform: "slack",
    displayName: "Slack",
    fields: [
      {
        name: "botToken",
        label: "Bot User OAuth Token",
        type: "password",
        placeholder: "xoxb-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
        helpText: "Found in OAuth & Permissions after installing app",
        required: true,
      },
      {
        name: "appToken",
        label: "App-Level Token",
        type: "password",
        placeholder: "xapp-1-A1234567890-1234567890123-abcdef...",
        helpText: "Generate in Basic Information → App-Level Tokens",
        required: true,
      },
      {
        name: "signingSecret",
        label: "Signing Secret",
        type: "password",
        placeholder: "abc123def456...",
        helpText: "Found in Basic Information → App Credentials",
        required: true,
      },
    ],
    setupInstructions: `
1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and select your workspace
3. Go to **OAuth & Permissions** → Add Bot Token Scopes:
   - \`chat:write\`, \`channels:read\`, \`channels:history\`, \`im:history\`
4. Install the app to your workspace
5. Copy the **Bot User OAuth Token**
6. Go to **Basic Information** → Generate an **App-Level Token** with \`connections:write\` scope
7. Copy the **Signing Secret** from App Credentials
    `.trim(),
    docsUrl: "https://api.slack.com/start/quickstart",
  },

  whatsapp: {
    platform: "whatsapp",
    displayName: "WhatsApp",
    fields: [
      {
        name: "phoneNumberId",
        label: "Phone Number ID",
        type: "text",
        placeholder: "123456789012345",
        helpText: "From Meta Business Suite → WhatsApp → API Setup",
        required: true,
      },
      {
        name: "accessToken",
        label: "Permanent Access Token",
        type: "password",
        placeholder: "EAABcd...",
        helpText: "Generate a permanent token in Meta Business settings",
        required: true,
      },
      {
        name: "webhookVerifyToken",
        label: "Webhook Verify Token",
        type: "text",
        placeholder: "your-custom-verify-token",
        helpText: "Create any string, you'll use it when setting up webhooks",
        required: true,
      },
    ],
    setupInstructions: `
1. Create a [Meta Business Account](https://business.facebook.com/)
2. Go to Meta Business Suite → WhatsApp → API Setup
3. Add a phone number (or use the test number)
4. Copy the **Phone Number ID** and **Access Token**
5. Create a **permanent token** in Business Settings → System Users
6. Set up webhooks pointing to your bot's callback URL
    `.trim(),
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
  },

  web: {
    platform: "web",
    displayName: "Web Chat",
    fields: [
      {
        name: "allowedOrigins",
        label: "Allowed Origins",
        type: "textarea",
        placeholder: "https://yoursite.com\nhttps://app.yoursite.com",
        helpText: "One URL per line. These domains can embed the chat widget.",
        required: false,
      },
      {
        name: "welcomeMessage",
        label: "Welcome Message",
        type: "text",
        placeholder: "Hi! How can I help you today?",
        helpText: "First message shown when chat opens",
        required: false,
      },
    ],
    setupInstructions: `
1. After deployment, you'll receive an embed code
2. Add the script to your website's HTML
3. Configure allowed origins if you want to restrict which sites can use it
    `.trim(),
  },
};

/**
 * Get config schema for a platform
 */
export function getPlatformConfig(platformName: string): PlatformConfig | null {
  return platformConfigs[platformName.toLowerCase()] || null;
}

/**
 * Check if a platform has required configuration
 */
export function platformRequiresConfig(platformName: string): boolean {
  const config = getPlatformConfig(platformName);
  if (!config) return false;
  return config.fields.some(f => f.required);
}

/**
 * Validate platform config values
 */
export function validatePlatformConfig(
  platformName: string,
  values: Record<string, string>
): { valid: boolean; errors: Record<string, string> } {
  const config = getPlatformConfig(platformName);
  if (!config) return { valid: true, errors: {} };

  const errors: Record<string, string> = {};
  
  for (const field of config.fields) {
    if (field.required && !values[field.name]?.trim()) {
      errors[field.name] = `${field.label} is required`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
