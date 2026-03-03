import React, { useRef, useEffect, useState as useReactState } from "react";
import Image from "next/image";
import { useIsMobile } from "@/hooks/useMobile";

export interface Integration {
  name: string;
  icon: string;
  description: string;
  url: string;
  category?: string;
  /** Domain for Clearbit logo (e.g. "openai.com"). Omit for emoji-only. */
  logoDomain?: string;
}

const INTEGRATIONS: Integration[] = [
  { name: "WhatsApp", icon: "💬", description: "QR pairing via Baileys", url: "https://www.whatsapp.com", category: "chat", logoDomain: "whatsapp.com" },
  { name: "Telegram", icon: "✈️", description: "Bot API via grammY", url: "https://telegram.org", category: "chat", logoDomain: "telegram.org" },
  { name: "Discord", icon: "🎮", description: "Servers, channels & DMs", url: "https://discord.com", category: "chat", logoDomain: "discord.com" },
  { name: "Slack", icon: "📎", description: "Workspace apps via Bolt", url: "https://slack.com", category: "chat", logoDomain: "slack.com" },
  { name: "Signal", icon: "🔒", description: "Privacy-focused", url: "https://signal.org", category: "chat", logoDomain: "signal.org" },
  { name: "Microsoft Teams", icon: "👥", description: "Enterprise support", url: "https://teams.microsoft.com", category: "chat", logoDomain: "microsoft.com" },
  { name: "Nextcloud Talk", icon: "☁️", description: "Self-hosted chat", url: "https://nextcloud.com", category: "chat", logoDomain: "nextcloud.com" },
  { name: "Matrix", icon: "🔲", description: "Matrix protocol", url: "https://matrix.org", category: "chat", logoDomain: "matrix.org" },
  { name: "Nostr", icon: "⚡", description: "Decentralized DMs", url: "https://nostr.com", category: "chat", logoDomain: "nostr.com" },
  { name: "Zalo", icon: "💭", description: "Zalo Bot API", url: "https://zalo.me", category: "chat", logoDomain: "zalo.me" },
  { name: "WebChat", icon: "🌐", description: "Browser-based UI", url: "#", category: "chat" },
  { name: "Anthropic", icon: "🧠", description: "Claude Pro/Max", url: "https://anthropic.com", category: "ai", logoDomain: "anthropic.com" },
  { name: "OpenAI", icon: "🤖", description: "GPT-4, GPT-5, o1", url: "https://openai.com", category: "ai", logoDomain: "openai.com" },
  { name: "Google Gemini", icon: "✨", description: "Gemini 2.5 Pro/Flash", url: "https://gemini.google.com", category: "ai", logoDomain: "google.com" },
  { name: "xAI", icon: "⚙️", description: "Grok 3 & 4", url: "https://x.ai", category: "ai", logoDomain: "x.ai" },
  { name: "OpenRouter", icon: "🔀", description: "Unified API gateway", url: "https://openrouter.ai", category: "ai", logoDomain: "openrouter.ai" },
  { name: "Mistral", icon: "🌪️", description: "Mistral Large", url: "https://mistral.ai", category: "ai", logoDomain: "mistral.ai" },
  { name: "DeepSeek", icon: "🔍", description: "DeepSeek V3 & R1", url: "https://deepseek.com", category: "ai", logoDomain: "deepseek.com" },
  { name: "Perplexity", icon: "🔎", description: "Search-augmented AI", url: "https://perplexity.ai", category: "ai", logoDomain: "perplexity.ai" },
  { name: "Hugging Face", icon: "🤗", description: "Open-source models", url: "https://huggingface.co", category: "ai", logoDomain: "huggingface.co" },
];

interface IntegrationsMarqueeProps {
  searchQuery?: string;
  transparentBg?: boolean;
}

function IntegrationIcon({ integration }: { integration: Integration }) {
  const [logoError, setLogoError] = React.useState(false);
  const logoUrl = integration.logoDomain
    ? `https://logos-api.apistemic.com/domain:${integration.logoDomain}`
    : null;

  if (logoUrl && !logoError) {
    return (
      <div className="w-8 h-8 md:w-10 md:h-10 mb-2 flex items-center justify-center rounded-lg bg-secondary/80 p-1.5 group-hover:bg-primary/10 group-hover:scale-110 transition-all duration-300">
        <Image
          src={logoUrl}
          alt={integration.name}
          width={40}
          height={40}
          className="w-full h-full object-contain"
          loading="lazy"
          onError={() => setLogoError(true)}
        />
      </div>
    );
  }
  return (
    <div className="text-3xl md:text-4xl mb-2 group-hover:scale-110 transition-transform min-h-[2rem] md:min-h-[2.5rem] flex items-center">{integration.icon}</div>
  );
}

export default function IntegrationsMarquee({ searchQuery = "", transparentBg = false }: IntegrationsMarqueeProps) {
  const isMobile = useIsMobile();
  const tickerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useReactState(true);

  // Pause ticker animation when off-screen for performance
  useEffect(() => {
    if (!tickerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(tickerRef.current);
    return () => observer.disconnect();
  }, []);

  // Filter integrations based on search query
  const filteredIntegrations = INTEGRATIONS.filter((integration) =>
    integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    integration.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Use filtered integrations if search is active, otherwise use all
  const displayIntegrations = searchQuery ? filteredIntegrations : INTEGRATIONS;
  
  // Use ticker only on desktop when not searching
  const isTicker = !isMobile && !searchQuery && displayIntegrations.length > 0;
  
  // Use grid on mobile OR when searching (better for browsing results)
  const useGrid = isMobile || searchQuery;

  // Card styling - theme-aware (clean paper theme)
  const cardClasses = "rounded-xl border border-border bg-card/80 backdrop-blur-md hover:border-primary/30 hover:bg-card transition-all duration-300 cursor-pointer group";

  return (
    <div className={`w-full overflow-hidden py-8 md:py-12 ${transparentBg ? "" : "bg-muted/30"}`}>
        {searchQuery && displayIntegrations.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-muted-foreground text-lg">No integrations found for "{searchQuery}"</p>
            <p className="text-muted-foreground-subtle text-sm mt-2">Try searching for chat, AI, or specific tool names</p>
          </div>
        ) : useGrid ? (
          /* Grid layout for mobile and search results */
          <div className="px-4 max-w-7xl mx-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
              {displayIntegrations.map((integration, index) => (
                <a
                  key={`${integration.name}-${index}`}
                  href={integration.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`p-3 md:p-4 ${cardClasses}`}
                >
                  <IntegrationIcon integration={integration} />
                  <h3 className="font-semibold text-foreground text-sm md:text-base mb-1 group-hover:text-primary transition-colors line-clamp-1">{integration.name}</h3>
                  <p className="text-xs md:text-sm text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">{integration.description}</p>
                </a>
              ))}
            </div>
          </div>
        ) : (
          /* Ticker/marquee for desktop without search */
          <div ref={tickerRef} className="relative overflow-hidden">
            {/* Left fade edge - transparent fades to nothing when transparentBg */}
            {!transparentBg && (
              <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-muted/30 to-transparent z-10 pointer-events-none" />
            )}
            {/* Right fade edge */}
            {!transparentBg && (
              <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-muted/30 to-transparent z-10 pointer-events-none" />
            )}
            
            <div
              className="flex gap-6 w-max px-4"
              style={{
                animation: "ticker 75s linear infinite",
                animationPlayState: isVisible ? "running" : "paused",
                willChange: "transform",
              }}
            >
              {/* Show integrations twice for seamless looping */}
              {[...displayIntegrations, ...displayIntegrations].map((integration, index) => (
                <a
                  key={`${integration.name}-${index}`}
                  href={integration.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex-shrink-0 w-48 p-4 ${cardClasses}`}
                >
                  <IntegrationIcon integration={integration} />
                  <h3 className="font-semibold text-foreground mb-1 group-hover:text-primary transition-colors">{integration.name}</h3>
                  <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{integration.description}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-muted-foreground text-xs mt-6">
          Logos by{" "}
          <a
            href="https://logos.apistemic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            apistemic logos
          </a>
        </p>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
