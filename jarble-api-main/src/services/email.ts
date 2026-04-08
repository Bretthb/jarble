/**
 * Email Service - Sends transactional emails via Resend.
 * Used for beta invitations and platform notifications.
 */
import { Resend } from "resend";
import { logger } from "../utils/logger.js";
import { env } from "../utils/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const FROM_EMAIL = "Jarble <noreply@invites.jarble.ai>";

export async function sendBetaWelcomeEmail(to: string, name: string): Promise<boolean> {
  if (!resend) {
    logger.warn("RESEND_API_KEY not configured, skipping email");
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: "Welcome to the Jarble Beta!",
      html: betaWelcomeHtml(name),
    });

    if (error) {
      logger.error({ error, to }, "Failed to send beta welcome email");
      return false;
    }

    logger.info({ to }, "Beta welcome email sent");
    return true;
  } catch (err) {
    logger.error({ err, to }, "Email send threw");
    return false;
  }
}

function betaWelcomeHtml(name: string): string {
  const firstName = name.split(" ")[0];
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 40px 32px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 28px; margin: 0; font-weight: 700; }
    .header p { color: #94a3b8; font-size: 14px; margin: 8px 0 0; }
    .body { padding: 32px; color: #334155; line-height: 1.6; font-size: 15px; }
    .body h2 { color: #0f172a; font-size: 20px; margin: 0 0 16px; }
    .cta { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 20px 0; }
    .features { margin: 24px 0; padding: 0; }
    .features li { margin: 8px 0; padding-left: 4px; }
    .footer { padding: 24px 32px; background: #f8fafc; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Jarble</h1>
      <p>Your beta access is ready</p>
    </div>
    <div class="body">
      <h2>Hey ${firstName},</h2>
      <p>You've been accepted into the <strong>Jarble beta</strong>. We're building the easiest way to deploy AI-powered bots to any messaging platform - no coding required.</p>
      <p>Here's what you can do right now:</p>
      <ul class="features">
        <li><strong>Deploy in 2 minutes</strong> - Pick a runtime, connect your LLM key, and launch</li>
        <li><strong>WhatsApp, Telegram, Discord, Slack</strong> - Connect any platform with one click</li>
        <li><strong>Rich UI components</strong> - Your bot can render charts, tables, maps, and more</li>
        <li><strong>Web chat interface</strong> - Every bot gets a shareable chat page</li>
      </ul>
      <a href="https://jarble.ai" class="cta">Get Started &rarr;</a>
      <p>If you have questions or feedback, just reply to this email. We read everything.</p>
      <p>- The Jarble Team</p>
    </div>
    <div class="footer">
      <p>Jarble AI &middot; You received this because you signed up for the beta at jarble.ai</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendOrgInviteEmail(
  to: string,
  inviterName: string,
  orgName: string,
  inviteUrl: string,
): Promise<boolean> {
  if (!resend) {
    logger.warn("RESEND_API_KEY not configured, skipping org invite email");
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `You've been invited to join ${orgName} on Jarble`,
      html: orgInviteHtml(inviterName, orgName, inviteUrl),
    });

    if (error) {
      logger.error({ error, to, orgName }, "Failed to send org invite email");
      return false;
    }

    logger.info({ to, orgName }, "Org invite email sent");
    return true;
  } catch (err) {
    logger.error({ err, to }, "Org invite email send threw");
    return false;
  }
}

function orgInviteHtml(inviterName: string, orgName: string, inviteUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 40px 32px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; margin: 0; font-weight: 700; }
    .header p { color: #94a3b8; font-size: 14px; margin: 8px 0 0; }
    .body { padding: 32px; color: #334155; line-height: 1.6; font-size: 15px; }
    .body h2 { color: #0f172a; font-size: 20px; margin: 0 0 16px; }
    .cta { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 20px 0; }
    .footer { padding: 24px 32px; background: #f8fafc; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>You're invited to ${orgName}</h1>
      <p>Organization invite on Jarble</p>
    </div>
    <div class="body">
      <h2>Hey there,</h2>
      <p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on Jarble.</p>
      <p>As a member, you'll be able to access the organization's AI agents and collaborate with the team.</p>
      <a href="${inviteUrl}" class="cta">Accept Invite &rarr;</a>
      <p style="font-size: 13px; color: #64748b;">This invite expires in 7 days. If you don't have a Jarble account, you'll be able to create one when you accept.</p>
    </div>
    <div class="footer">
      <p>Jarble AI &middot; You received this because ${inviterName} invited you to ${orgName}</p>
    </div>
  </div>
</body>
</html>`;
}

export function isEmailConfigured(): boolean {
  return resend !== null;
}
