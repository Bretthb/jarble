"use client";

import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

const AREAS = [
  "AI and agent infrastructure",
  "Machine learning",
  "Operational excellence with AI",
  "Systems for AI",
];

export default function Research() {
  return (
    <div className="min-h-screen bg-background text-foreground relative flex flex-col">
      <MarketingNav />

      <section className="flex-1 pt-32 pb-20 relative z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 animate-fade-in-up">
          <h1 className="text-4xl lg:text-5xl font-serif font-medium mb-6">
            Research
          </h1>
          <p className="text-lg text-muted-foreground mb-12">
            We are setting up our research practice. Nothing is published yet.
            These are the areas we intend to work on.
          </p>

          <ul className="divide-y divide-border border-y border-border">
            {AREAS.map((area) => (
              <li key={area} className="py-4 text-base font-medium">
                {area}
              </li>
            ))}
          </ul>

          <p className="text-sm text-muted-foreground mt-12">
            Want to collaborate? Reach us at hello@jarble.ai.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
