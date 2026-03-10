"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth0 } from "@auth0/auth0-react";

const LAST_UPDATED = "March 10, 2026";

const TOC = [
  { id: "acceptance", label: "1. Acceptance of Terms" },
  { id: "description", label: "2. Description of Service" },
  { id: "accounts", label: "3. Account Registration" },
  { id: "responsibilities", label: "4. User Responsibilities" },
  { id: "api-keys", label: "5. API Keys & Credentials" },
  { id: "ip", label: "6. Intellectual Property" },
  { id: "payment", label: "7. Payment & Billing" },
  { id: "availability", label: "8. Service Availability" },
  { id: "liability", label: "9. Limitation of Liability" },
  { id: "ai-terms", label: "10. AI-Specific Terms" },
  { id: "termination", label: "11. Termination" },
  { id: "governing-law", label: "12. Governing Law" },
  { id: "changes", label: "13. Changes to Terms" },
  { id: "contact", label: "14. Contact" },
];

export default function Terms() {
  const { isAuthenticated } = useAuth0();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <h1 className="font-serif font-bold text-2xl tracking-tight">Jarble</h1>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Home
            </Link>
            <Link href="/about" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              About
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Pricing
            </Link>
            {isAuthenticated ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/dashboard")}
                className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
              >
                Dashboard
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => router.push("/login")}
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-serif font-medium mb-2">Terms of Service</h1>
          <p className="text-muted-foreground mb-8">Last updated: {LAST_UPDATED}</p>

          {/* Table of Contents */}
          <nav className="mb-12 p-4 bg-secondary/30 rounded-xl">
            <p className="font-medium mb-3">Table of Contents</p>
            <ul className="space-y-1.5">
              {TOC.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-10">
            <section id="acceptance" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">1. Acceptance of Terms</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  By accessing or using Jarble (&quot;the Service&quot;), operated by Jarble, Corp. (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service.
                </p>
                <p>
                  You must be at least 18 years old to use Jarble. By using the Service, you represent and warrant that you meet this age requirement.
                </p>
              </div>
            </section>

            <section id="description" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">2. Description of Service</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Jarble is a no-code AI bot deployment platform. The Service allows you to:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>Deploy AI-powered bots to messaging platforms (WhatsApp, Discord, Slack, Telegram, and web chat)</li>
                  <li>Configure bot behavior, system prompts, and guardrails through a guided wizard</li>
                  <li>Use your own LLM API keys (&quot;Bring Your Own Key&quot;) from supported providers</li>
                  <li>Manage deployments on managed infrastructure (Kubernetes clusters hosted by Jarble)</li>
                  <li>Interact with your bots through a web chat interface with rich UI components</li>
                </ul>
                <p>
                  Each deployment runs in its own isolated container with dedicated storage and configuration.
                </p>
              </div>
            </section>

            <section id="accounts" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">3. Account Registration</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  To use Jarble, you must create an account through our authentication provider (Auth0). You agree to:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>Provide accurate and complete registration information</li>
                  <li>Keep your account credentials secure and confidential</li>
                  <li>Notify us immediately of any unauthorized access to your account</li>
                  <li>Accept responsibility for all activity under your account</li>
                </ul>
                <p>
                  We reserve the right to suspend or terminate accounts that violate these terms or engage in fraudulent activity.
                </p>
              </div>
            </section>

            <section id="responsibilities" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">4. User Responsibilities</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>You are responsible for:</p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Bot behavior</strong>: The content your bots generate is governed by the system prompts and guardrails you configure. You are responsible for ensuring your bots do not produce harmful, illegal, or misleading content.</li>
                  <li><strong>Platform compliance</strong>: Ensuring your bot usage complies with the terms of service of each messaging platform (Discord, Telegram, WhatsApp, Slack, etc.).</li>
                  <li><strong>Lawful use</strong>: Using the Service only for lawful purposes. You may not use Jarble for harassment, spam, phishing, distribution of malware, or any illegal activity.</li>
                  <li><strong>LLM API costs</strong>: When using your own API keys, you are responsible for all costs incurred with your chosen LLM provider.</li>
                  <li><strong>Content you create</strong>: All system prompts, bot configurations, and custom components you create on the platform.</li>
                </ul>
              </div>
            </section>

            <section id="api-keys" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">5. API Keys & Credentials</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Jarble operates on a &quot;Bring Your Own Key&quot; (BYOK) model. When you provide API keys or platform credentials:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Encryption</strong>: All credentials are encrypted at rest using AES-256-GCM encryption before storage</li>
                  <li><strong>Purpose limitation</strong>: Your LLM API keys are used solely to proxy requests to your chosen LLM provider on behalf of your deployments</li>
                  <li><strong>Platform tokens</strong>: Messaging platform tokens (e.g., Discord bot tokens, Telegram bot tokens) are used solely to connect your bot to those platforms</li>
                  <li><strong>Revocability</strong>: You can delete your credentials at any time through the dashboard, which immediately removes them from our systems</li>
                  <li><strong>No sharing</strong>: We never share your API keys with third parties or use them for any purpose other than operating your deployments</li>
                </ul>
              </div>
            </section>

            <section id="ip" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">6. Intellectual Property</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  <strong>Jarble&apos;s IP</strong>: The Jarble platform, including its software, design, branding, and documentation, is owned by Jarble, Corp. and protected by applicable intellectual property laws.
                </p>
                <p>
                  <strong>Your IP</strong>: You retain ownership of all content you create on Jarble, including system prompts, bot configurations, custom components, and any other user-generated content. We claim no ownership over your content.
                </p>
                <p>
                  By using the Service, you grant us a limited license to host, process, and display your content solely for the purpose of operating the Service.
                </p>
              </div>
            </section>

            <section id="payment" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">7. Payment & Billing</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Payments are processed through Stripe. By subscribing to a paid plan, you agree to:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Recurring billing</strong>: Subscriptions are billed on a recurring basis (monthly) unless cancelled</li>
                  <li><strong>Free trial</strong>: Free trial terms, if offered, are specified during signup. At the end of a trial, your subscription will begin unless cancelled</li>
                  <li><strong>No refunds</strong>: All sales are final. We do not offer refunds for partial billing periods. You may cancel your subscription at any time, and it will remain active until the end of your current billing period</li>
                  <li><strong>Price changes</strong>: We may update pricing with reasonable notice. Existing subscriptions will be honored until their next renewal date</li>
                </ul>
                <p>
                  When you cancel a subscription, the associated deployment will be stopped at the end of the billing period. Your configuration data will be retained for 30 days after cancellation, after which it may be deleted.
                </p>
              </div>
            </section>

            <section id="availability" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">8. Service Availability</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Jarble is currently in <strong>beta</strong>. While we strive for high availability, we do not guarantee a specific uptime SLA during the beta period.
                </p>
                <p>
                  We reserve the right to modify, suspend, or discontinue the Service (or any part thereof) at any time, with or without notice. We will make reasonable efforts to notify users of significant changes.
                </p>
                <p>
                  Scheduled maintenance and updates may temporarily interrupt the Service. We will provide advance notice when possible.
                </p>
              </div>
            </section>

            <section id="liability" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">9. Limitation of Liability</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
                </p>
                <p>
                  To the maximum extent permitted by law, Jarble, Corp. shall not be liable for:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>The accuracy, quality, or appropriateness of content generated by AI models through the Service</li>
                  <li>Outages or failures of third-party services (LLM providers, messaging platforms, infrastructure providers)</li>
                  <li>Data loss resulting from circumstances beyond our reasonable control</li>
                  <li>Indirect, incidental, special, consequential, or punitive damages</li>
                </ul>
                <p>
                  Our total liability for any claims arising from or relating to the Service shall not exceed the total fees paid by you to Jarble in the twelve (12) months preceding the claim.
                </p>
              </div>
            </section>

            <section id="ai-terms" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">10. AI-Specific Terms</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  <strong>No model training</strong>: Jarble does not train AI models. We are a deployment platform that connects your configuration to your chosen LLM provider.
                </p>
                <p>
                  <strong>Message forwarding</strong>: When users interact with your bot, their messages are forwarded to the LLM provider you selected (e.g., OpenAI, Anthropic, Google, OpenRouter) and are subject to that provider&apos;s terms of service and privacy policy.
                </p>
                <p>
                  <strong>No accuracy guarantees</strong>: AI-generated content may be inaccurate, incomplete, or inappropriate. Jarble makes no guarantees about the accuracy or quality of AI responses.
                </p>
                <p>
                  <strong>Guardrails</strong>: You are responsible for configuring appropriate guardrails and system prompts for your deployments. While Jarble applies platform-level safety defaults, the behavior of your bot is ultimately determined by your configuration and the capabilities of your chosen model.
                </p>
              </div>
            </section>

            <section id="termination" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">11. Termination</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  <strong>By you</strong>: You may terminate your account at any time by contacting us at <a href="mailto:privacy@jarble.ai" className="text-primary hover:underline">privacy@jarble.ai</a>. Active subscriptions will be cancelled according to the billing terms in Section 7.
                </p>
                <p>
                  <strong>By us</strong>: We may suspend or terminate your account if you violate these terms, engage in abusive behavior, or if required by law. We will provide notice when reasonably possible.
                </p>
                <p>
                  <strong>Data deletion</strong>: Upon account termination, you may request deletion of all your data. We will process such requests within 30 days, subject to any legal retention requirements.
                </p>
              </div>
            </section>

            <section id="governing-law" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">12. Governing Law</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law principles.
                </p>
                <p>
                  Any disputes arising from these Terms or the Service shall be resolved in the courts of the State of Delaware.
                </p>
              </div>
            </section>

            <section id="changes" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">13. Changes to Terms</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  We reserve the right to update these Terms at any time. When we make material changes, we will notify you by email and/or by posting a notice on the Service.
                </p>
                <p>
                  Your continued use of Jarble after changes are posted constitutes acceptance of the updated Terms. If you do not agree with the changes, you should discontinue use of the Service.
                </p>
              </div>
            </section>

            <section id="contact" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">14. Contact</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  If you have any questions about these Terms of Service, please contact us at:
                </p>
                <p>
                  <a href="mailto:privacy@jarble.ai" className="text-primary hover:underline">privacy@jarble.ai</a>
                </p>
                <p>
                  Jarble, Corp.<br />
                  State of Delaware, United States
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-border relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <span className="font-serif font-bold text-foreground">Jarble</span>
            </Link>
            <nav className="flex flex-wrap justify-center gap-x-8 gap-y-2">
              <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">Home</Link>
              <Link href="/about" className="text-muted-foreground hover:text-primary transition-colors">About</Link>
              <Link href="/pricing" className="text-muted-foreground hover:text-primary transition-colors">Pricing</Link>
              <Link href="/terms" className="text-primary">Terms of Service</Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-primary transition-colors">Privacy Policy</Link>
            </nav>
          </div>
          <div className="mt-8 pt-8 border-t border-border text-center text-muted-foreground text-sm">
            <p>&copy; 2026 Jarble. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
