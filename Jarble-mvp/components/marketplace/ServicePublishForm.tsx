"use client";

import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import {
  Package,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";

export function PackagePublishForm() {
  const { isAuthenticated, loginWithRedirect, isLoading: authLoading } = useAuth0();

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [hostingModel, setHostingModel] = useState<"self_hosted" | "remote" | "hybrid">("self_hosted");
  const [instructionSnippet, setInstructionSnippet] = useState("");
  const [remoteApiEndpoint, setRemoteApiEndpoint] = useState("");
  const [pricingModel, setPricingModel] = useState<"free" | "paid" | "freemium">("free");
  const [priceUsdCents, setPriceUsdCents] = useState(0);

  // Component and skill IDs (manually entered for now)
  const [componentIdInput, setComponentIdInput] = useState("");
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [skillIdInput, setSkillIdInput] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);

  const [submitted, setSubmitted] = useState(false);

  const publishMutation = trpc.packages.publish.useMutation();

  const addComponentId = () => {
    const id = componentIdInput.trim();
    if (id && !componentIds.includes(id)) {
      setComponentIds([...componentIds, id]);
      setComponentIdInput("");
    }
  };

  const removeComponentId = (id: string) => {
    setComponentIds(componentIds.filter((c) => c !== id));
  };

  const addSkillId = () => {
    const id = skillIdInput.trim();
    if (id && !skillIds.includes(id)) {
      setSkillIds([...skillIds, id]);
      setSkillIdInput("");
    }
  };

  const removeSkillId = (id: string) => {
    setSkillIds(skillIds.filter((s) => s !== id));
  };

  const handleSubmit = async () => {
    try {
      await publishMutation.mutateAsync({
        name,
        displayName,
        description: description || undefined,
        hostingModel,
        instructionSnippet: instructionSnippet || undefined,
        remoteApiEndpoint: remoteApiEndpoint || undefined,
        pricingModel,
        priceUsdCents,
        componentIds,
        skillIds,
      });
      setSubmitted(true);
    } catch {
      // Error shown via mutation state
    }
  };

  const canSubmit =
    name.length > 0 &&
    displayName.length > 0 &&
    (componentIds.length > 0 || skillIds.length > 0) &&
    !publishMutation.isPending;

  if (!isAuthenticated && !authLoading) {
    return (
      <Card className="max-w-2xl mx-auto border border-border">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <Package className="size-12 text-muted-foreground" />
          <p className="text-muted-foreground text-center">
            Sign in to publish packages to the marketplace.
          </p>
          <Button onClick={() => loginWithRedirect()}>
            <LogIn className="size-4 mr-2" />
            Sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (submitted) {
    return (
      <Card className="max-w-2xl mx-auto border border-border">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <CheckCircle2 className="size-12 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xl font-semibold">Package Submitted</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Your package has been submitted for review. It will appear in the
            marketplace once approved by the moderation team.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSubmitted(false);
              setName("");
              setDisplayName("");
              setDescription("");
              setInstructionSnippet("");
              setRemoteApiEndpoint("");
              setComponentIds([]);
              setSkillIds([]);
              setPricingModel("free");
              setPriceUsdCents(0);
              setHostingModel("self_hosted");
            }}
          >
            Publish another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto border border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-5" />
          Publish a Package
        </CardTitle>
        <CardDescription>
          Bundle components and skills together for one-click installation.
          Packages are submitted for review before appearing in the marketplace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Name (slug) */}
        <div className="space-y-2">
          <Label htmlFor="pkg-name">Package Name (slug)</Label>
          <Input
            id="pkg-name"
            placeholder="my-analytics-package"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            maxLength={100}
          />
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only.
          </p>
        </div>

        {/* Display Name */}
        <div className="space-y-2">
          <Label htmlFor="pkg-display-name">Display Name</Label>
          <Input
            id="pkg-display-name"
            placeholder="My Analytics Package"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={255}
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="pkg-description">Description</Label>
          <Textarea
            id="pkg-description"
            placeholder="A bundle of analytics components and skills for tracking business metrics..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </div>

        <Separator />

        {/* Hosting Model */}
        <div className="space-y-2">
          <Label>Hosting Model</Label>
          <Select
            value={hostingModel}
            onValueChange={(v) => setHostingModel(v as "self_hosted" | "remote" | "hybrid")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self_hosted">Self-hosted (runs on buyer&apos;s pod)</SelectItem>
              <SelectItem value="remote">Hosted (runs on your server)</SelectItem>
              <SelectItem value="hybrid">Hybrid (both options)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Remote API Endpoint (shown for remote/hybrid) */}
        {(hostingModel === "remote" || hostingModel === "hybrid") && (
          <div className="space-y-2">
            <Label htmlFor="pkg-endpoint">Remote API Endpoint</Label>
            <Input
              id="pkg-endpoint"
              placeholder="https://api.example.com/v1/package"
              type="url"
              value={remoteApiEndpoint}
              onChange={(e) => setRemoteApiEndpoint(e.target.value)}
              maxLength={500}
            />
          </div>
        )}

        <Separator />

        {/* Instruction Snippet */}
        <div className="space-y-2">
          <Label htmlFor="pkg-snippet">Bot Instruction Snippet (optional)</Label>
          <Textarea
            id="pkg-snippet"
            placeholder="When asked about analytics, use the analytics_dashboard component to display KPIs..."
            value={instructionSnippet}
            onChange={(e) => setInstructionSnippet(e.target.value)}
            maxLength={5000}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            This text is appended to the bot&apos;s system prompt when installed.
            Use it to teach the bot how to use your package&apos;s components/skills.
          </p>
        </div>

        <Separator />

        {/* Components */}
        <div className="space-y-2">
          <Label>Components</Label>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Component ID"
              value={componentIdInput}
              onChange={(e) => setComponentIdInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addComponentId())}
            />
            <Button type="button" variant="outline" size="icon" onClick={addComponentId}>
              <Plus className="size-4" />
            </Button>
          </div>
          {componentIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {componentIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 pr-1">
                  <span className="font-mono text-xs truncate max-w-[140px]">{id}</span>
                  <button
                    onClick={() => removeComponentId(id)}
                    className="ml-1 hover:text-destructive transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Skills */}
        <div className="space-y-2">
          <Label>Skills</Label>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Skill ID"
              value={skillIdInput}
              onChange={(e) => setSkillIdInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkillId())}
            />
            <Button type="button" variant="outline" size="icon" onClick={addSkillId}>
              <Plus className="size-4" />
            </Button>
          </div>
          {skillIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {skillIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 pr-1">
                  <span className="font-mono text-xs truncate max-w-[140px]">{id}</span>
                  <button
                    onClick={() => removeSkillId(id)}
                    className="ml-1 hover:text-destructive transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Pricing */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Pricing Model</Label>
            <Select
              value={pricingModel}
              onValueChange={(v) => setPricingModel(v as "free" | "paid" | "freemium")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="freemium">Freemium</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {pricingModel !== "free" && (
            <div className="space-y-2">
              <Label htmlFor="pkg-price">Price (USD cents)</Label>
              <Input
                id="pkg-price"
                type="number"
                min={0}
                value={priceUsdCents}
                onChange={(e) => setPriceUsdCents(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        {/* Error message */}
        {publishMutation.error && (
          <p className="text-sm text-destructive">
            {publishMutation.error.message}
          </p>
        )}

        {/* Submit */}
        <Button
          className="w-full"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {publishMutation.isPending ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Package className="size-4 mr-2" />
              Submit for Review
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
