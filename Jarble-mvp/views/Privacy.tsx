import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

const LAST_UPDATED = "March 10, 2026";

const TOC = [
  { id: "introduction", label: "1. Introduction" },
  { id: "data-we-collect", label: "2. Data We Collect" },
  { id: "how-we-use", label: "3. How We Use Your Data" },
  { id: "legal-basis", label: "4. Legal Basis (GDPR)" },
  { id: "storage-security", label: "5. Data Storage & Security" },
  { id: "retention", label: "6. Data Retention" },
  { id: "your-rights", label: "7. Your Rights (GDPR)" },
  { id: "eu-ai-act", label: "8. EU AI Act Considerations" },
  { id: "data-minimization", label: "9. Data Minimization" },
  { id: "children", label: "10. Children's Privacy" },
  { id: "international", label: "11. International Data Transfers" },
  { id: "cookies", label: "12. Cookies" },
  { id: "changes", label: "13. Changes to This Policy" },
  { id: "contact", label: "14. Contact" },
];

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <MarketingNav />

      {/* Content */}
      <main className="pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-serif font-medium mb-2">Privacy Policy</h1>
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
            <section id="introduction" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">1. Introduction</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Jarble, Corp. (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the Jarble platform at jarble.ai. This Privacy Policy explains how we collect, use, store, and protect your personal data when you use our Service.
                </p>
                <p>
                  We are committed to protecting your privacy and complying with applicable data protection regulations, including the General Data Protection Regulation (GDPR). We believe in transparency about our data practices and collect only what is necessary to operate the Service.
                </p>
              </div>
            </section>

            <section id="data-we-collect" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">2. Data We Collect</h2>
              <div className="text-muted-foreground leading-relaxed space-y-4">
                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Account Data</h3>
                  <p>When you create an account via Auth0, we store your email address, display name, and Auth0 user ID. If you subscribe to a paid plan, we also store your Stripe customer ID.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Deployment Configuration</h3>
                  <p>For each bot deployment you create, we store: bot name, description, system prompt, selected LLM provider and model, and platform connection settings.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Credentials (Encrypted)</h3>
                  <p>LLM API keys and messaging platform tokens are encrypted using AES-256-GCM before storage. These are used solely to operate your deployments and can be deleted at any time.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Chat Data</h3>
                  <p>We store user messages and bot responses for your web chat sessions, along with session metadata (creation time, session title). UI component blocks are stripped before storage to minimize data retained. Chat data is stored to enable conversation history and session continuity.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Marketplace Data</h3>
                  <p>If you publish or install marketplace components, we store creator profiles, component metadata, reviews, and installation records.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Usage Analytics</h3>
                  <p>We use PostHog for product analytics (page views, feature usage). Analytics are collected in identified-only mode, meaning only authenticated users are tracked. We do not track anonymous visitors.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Error Monitoring</h3>
                  <p>We use Sentry for error tracking and performance monitoring. Sentry captures JavaScript errors and performance traces at a 10% sampling rate to help us identify and fix issues.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Beta Signup Data</h3>
                  <p>If you apply for beta access, we collect your name, email address, experience level, and use case description.</p>
                </div>
              </div>
            </section>

            <section id="how-we-use" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">3. How We Use Your Data</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>We use your data for the following purposes:</p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Operate the Service</strong>: Create and manage your account, process deployments, connect to messaging platforms, and proxy LLM requests</li>
                  <li><strong>Process payments</strong>: Handle subscription billing and payment processing through Stripe</li>
                  <li><strong>Transactional emails</strong>: Send account-related notifications (e.g., password resets, billing confirmations)</li>
                  <li><strong>Reliability monitoring</strong>: Identify and fix bugs, monitor system performance, and ensure service stability</li>
                  <li><strong>Usage analytics</strong>: Understand how users interact with the platform to improve the product</li>
                </ul>
                <p className="font-medium text-foreground">
                  We never sell your data. We never use your chat data to train AI models.
                </p>
              </div>
            </section>

            <section id="legal-basis" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">4. Legal Basis (GDPR Art. 6)</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>We process your personal data under the following legal bases:</p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Contract performance</strong> (Art. 6(1)(b)): Processing necessary to provide the Service you signed up for — account management, deployment operations, payment processing</li>
                  <li><strong>Legitimate interest</strong> (Art. 6(1)(f)): Error monitoring, security, fraud prevention, and product improvement — where our interest does not override your rights</li>
                  <li><strong>Consent</strong> (Art. 6(1)(a)): Analytics tracking, marketing communications — which you may withdraw at any time</li>
                </ul>
              </div>
            </section>

            <section id="storage-security" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">5. Data Storage & Security</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>We take the security of your data seriously. Our measures include:</p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Infrastructure</strong>: Kubernetes cluster hosted on Hetzner Cloud in the EU (Germany), with isolated containers per deployment</li>
                  <li><strong>Encryption at rest</strong>: All sensitive credentials encrypted with AES-256-GCM</li>
                  <li><strong>Container security</strong>: Non-root containers, all Linux capabilities dropped, service account tokens disabled</li>
                  <li><strong>Network security</strong>: Network policies restrict container egress to only necessary endpoints (LLM APIs, messaging platforms, DNS)</li>
                  <li><strong>Authentication</strong>: Stateless JWT tokens verified via JWKS (no persistent session cookies). Tokens are short-lived and validated on every request</li>
                  <li><strong>RBAC</strong>: Users can only access their own deployments. All API endpoints enforce ownership checks</li>
                </ul>
              </div>
            </section>

            <section id="retention" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">6. Data Retention</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Account data</strong>: Retained while your account is active. Deleted upon request after account termination</li>
                  <li><strong>Chat data</strong>: Retained while the associated deployment exists. Deleted when the deployment is deleted</li>
                  <li><strong>Credentials</strong>: Deleted immediately when you remove them from the dashboard or when a deployment is deleted</li>
                  <li><strong>Analytics data</strong>: Retained per PostHog and Sentry default retention policies</li>
                  <li><strong>Billing data</strong>: Retained as required by applicable tax and financial regulations</li>
                  <li><strong>Beta signup data</strong>: Retained until the beta program concludes, then deleted unless you create an account</li>
                </ul>
              </div>
            </section>

            <section id="your-rights" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">7. Your Rights (GDPR)</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>Under the GDPR, you have the following rights:</p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li><strong>Right of access</strong>: Request a copy of the personal data we hold about you</li>
                  <li><strong>Right to rectification</strong>: Request correction of inaccurate or incomplete data</li>
                  <li><strong>Right to erasure</strong>: Request deletion of your personal data (&quot;right to be forgotten&quot;)</li>
                  <li><strong>Right to data portability</strong>: Receive your data in a structured, machine-readable format</li>
                  <li><strong>Right to restrict processing</strong>: Request that we limit how we use your data</li>
                  <li><strong>Right to object</strong>: Object to processing based on legitimate interest</li>
                  <li><strong>Right to withdraw consent</strong>: Withdraw consent for analytics or marketing at any time</li>
                </ul>
                <p>
                  To exercise any of these rights, contact us at <a href="mailto:privacy@jarble.ai" className="text-primary hover:underline">privacy@jarble.ai</a>. We will respond within 30 days.
                </p>
              </div>
            </section>

            <section id="eu-ai-act" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">8. EU AI Act Considerations</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Jarble is a <strong>deployment platform</strong>, not an AI model provider. With respect to the EU AI Act:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>We do not develop or train AI models — users choose their own LLM provider</li>
                  <li>Users configure their own system prompts and guardrails for bot behavior</li>
                  <li>We apply platform-level safety defaults, but users retain responsibility for their deployment configurations</li>
                  <li>No automated decisions with legal or similarly significant effects are made by the platform itself</li>
                  <li>We provide transparency about which AI providers are used and how messages are routed</li>
                </ul>
              </div>
            </section>

            <section id="data-minimization" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">9. Data Minimization</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>We actively minimize the data we collect and retain:</p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>UI component blocks are stripped from chat messages before storage — only the text content is retained</li>
                  <li>Chat session titles are auto-generated from the first user message and truncated</li>
                  <li>Sentry error monitoring uses a 10% sampling rate, capturing only a fraction of events</li>
                  <li>PostHog analytics operates in identified-only mode — no anonymous visitor tracking</li>
                  <li>We collect only the data fields necessary to operate each feature</li>
                </ul>
              </div>
            </section>

            <section id="children" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">10. Children&apos;s Privacy</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Jarble is not directed at individuals under the age of 18. We do not knowingly collect personal data from children. If we become aware that we have collected data from a person under 18, we will take steps to delete that information promptly.
                </p>
              </div>
            </section>

            <section id="international" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">11. International Data Transfers</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Our infrastructure is hosted in the EU (Hetzner Cloud, Germany). However, some of our third-party processors are located in the United States (Auth0, Stripe, Sentry, Neon, Vercel).
                </p>
                <p>
                  Where data is transferred outside the EU/EEA, we rely on appropriate safeguards including Standard Contractual Clauses (SCCs) as adopted by the European Commission, and the processors&apos; compliance with applicable data protection frameworks.
                </p>
              </div>
            </section>

            <section id="cookies" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">12. Cookies</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  Jarble does not use persistent tracking cookies. Authentication is handled via stateless JWT tokens stored in memory.
                </p>
                <p>
                  Third-party services integrated into the platform (Auth0, PostHog, Sentry) may set their own cookies as described in their respective privacy policies. We recommend reviewing those policies for details.
                </p>
              </div>
            </section>

            <section id="changes" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">13. Changes to This Policy</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  We may update this Privacy Policy from time to time. When we make material changes, we will notify you by email and/or by posting a notice on the Service, and update the &quot;Last updated&quot; date at the top of this page.
                </p>
                <p>
                  Your continued use of Jarble after changes are posted constitutes acceptance of the updated policy.
                </p>
              </div>
            </section>

            <section id="contact" className="scroll-mt-24">
              <h2 className="text-2xl font-serif font-medium mb-4">14. Contact</h2>
              <div className="text-muted-foreground leading-relaxed space-y-3">
                <p>
                  If you have any questions about this Privacy Policy or wish to exercise your data rights, please contact us at:
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

      <MarketingFooter />
    </div>
  );
}
