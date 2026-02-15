import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import type { TabProps } from "./types";

const AVAILABLE_SKILLS = [
  { id: "customer-support", name: "Customer Support", description: "Handle common support inquiries" },
  { id: "faq", name: "FAQ Bot", description: "Answer frequently asked questions" },
  { id: "ticket-creation", name: "Ticket Creation", description: "Create support tickets automatically" },
  { id: "appointment-booking", name: "Appointment Booking", description: "Schedule appointments and meetings" },
  { id: "lead-qualification", name: "Lead Qualification", description: "Qualify and route sales leads" },
  { id: "order-tracking", name: "Order Tracking", description: "Help customers track orders" },
  { id: "product-recommendations", name: "Product Recommendations", description: "Suggest relevant products" },
  { id: "sentiment-analysis", name: "Sentiment Analysis", description: "Detect customer sentiment" },
];

export function SkillsTab({ formData, updateFormData }: TabProps) {
  const toggleSkill = (skillId: string) => {
    const current = formData.skills || [];
    if (current.includes(skillId)) {
      updateFormData("skills", current.filter((id: string) => id !== skillId));
    } else {
      updateFormData("skills", [...current, skillId]);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Skills & Capabilities</h2>
        <p className="text-muted-foreground text-sm">Enable pre-built skills for your deployment</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {AVAILABLE_SKILLS.map((skill) => (
          <button
            key={skill.id}
            onClick={() => toggleSkill(skill.id)}
            className={`p-4 rounded-lg border text-left transition-all ${
              formData.skills?.includes(skill.id)
                ? "border-primary bg-primary/10"
                : "border-border bg-secondary/80/50 hover:border-border"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                formData.skills?.includes(skill.id)
                  ? "border-primary bg-primary"
                  : "border-border"
              }`}>
                {formData.skills?.includes(skill.id) && (
                  <svg className="w-3 h-3 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="font-semibold">{skill.name}</h3>
                <p className="text-sm text-muted-foreground">{skill.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="pt-4 border-t border-border">
        <Button variant="outline" className="border-border">
          <Sparkles className="w-4 h-4 mr-2" />
          Browse Skill Marketplace
        </Button>
      </div>
    </div>
  );
}
