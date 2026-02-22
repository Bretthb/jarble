"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  ExternalLink,
  Send,
  MessageCircle,
  Hash,
} from "lucide-react";
import { toast } from "sonner";
import { vanillaClient } from "@/lib/trpc-vanilla";

interface PlatformSetupProps {
  deploymentId: string;
  platform: "telegram" | "discord" | "slack" | "whatsapp";
  isConnected: boolean;
  maskedCredentials?: Record<string, string>;
}

const PLATFORM_CONFIG = {
  telegram: {
    icon: Send,
    name: "Telegram",
    fields: [{ key: "botToken", label: "Bot Token", placeholder: "123456789:ABCdefGhI..." }],
    helpUrl: "https://t.me/BotFather",
    helpText: "Create a bot with @BotFather and paste the token here.",
  },
  discord: {
    icon: MessageCircle,
    name: "Discord",
    fields: [{ key: "botToken", label: "Bot Token", placeholder: "MTA5..." }],
    helpUrl: "https://discord.com/developers/applications",
    helpText: "Create an app in the Discord Developer Portal and copy the bot token.",
  },
  slack: {
    icon: Hash,
    name: "Slack",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-..." },
      { key: "appToken", label: "App Token", placeholder: "xapp-..." },
    ],
    helpUrl: "https://api.slack.com/apps",
    helpText: "Create a Slack app with Socket Mode enabled.",
  },
  whatsapp: {
    icon: MessageCircle,
    name: "WhatsApp",
    fields: [],
    helpUrl: "",
    helpText: "WhatsApp uses QR pairing. Start the bot and scan the QR code.",
  },
};

export default function PlatformSetup({
  deploymentId,
  platform,
  isConnected,
  maskedCredentials,
}: PlatformSetupProps) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
        Unknown platform: {platform}
      </div>
    );
  }
  const Icon = config.icon;

  const [fields, setFields] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [saved, setSaved] = useState(false);

  const allFieldsFilled = config.fields.every(
    (f) => (fields[f.key] || "").trim().length > 0
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await vanillaClient.platformCredentials.save.mutate({
        deploymentId,
        platformId: platform,
        credentials: fields,
      });
      toast.success(`${config.name} connected!`);
      setSaved(true);
    } catch {
      toast.error(`Failed to connect ${config.name}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await vanillaClient.platformCredentials.delete.mutate({
        deploymentId,
        platformId: platform,
      });
      toast.success(`${config.name} disconnected`);
      setSaved(false);
      setFields({});
    } catch {
      toast.error(`Failed to disconnect ${config.name}`);
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isConnected || saved) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold">{config.name}</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              <span className="text-xs text-green-500 font-medium">Connected</span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="h-7 text-xs border-border"
          >
            {isDisconnecting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              "Disconnect"
            )}
          </Button>
        </div>
        {maskedCredentials &&
          Object.entries(maskedCredentials).map(([key, val]) => (
            <p key={key} className="text-xs text-muted-foreground">
              {key}: {val}
            </p>
          ))}
      </div>
    );
  }

  if (platform === "whatsapp") {
    return (
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">WhatsApp</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              WhatsApp uses QR pairing. Start or restart the bot first, then scan the QR code from the logs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h4 className="text-sm font-semibold">Connect {config.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {config.helpText}
          </p>
        </div>
      </div>

      {config.fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{f.label}</Label>
          <Input
            type="password"
            value={fields[f.key] || ""}
            onChange={(e) =>
              setFields((prev) => ({ ...prev, [f.key]: e.target.value }))
            }
            placeholder={f.placeholder}
            className="bg-secondary/50 border-border"
          />
        </div>
      ))}

      <div className="flex items-center justify-between">
        {config.helpUrl && (
          <a
            href={config.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Get credentials
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!allFieldsFilled || isSaving}
          className="h-8"
        >
          {isSaving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Connect
        </Button>
      </div>
    </div>
  );
}
