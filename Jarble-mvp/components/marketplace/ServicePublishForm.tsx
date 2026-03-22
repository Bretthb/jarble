"use client";

import { useState, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import Link from "next/link";
import {
  Package,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  LogIn,
  Save,
  Send,
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
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import DeploymentPicker from "@/components/marketplace/DeploymentPicker";
import DeploymentComponentBrowser from "@/components/marketplace/DeploymentComponentBrowser";
import DeploymentSkillBrowser from "@/components/marketplace/DeploymentSkillBrowser";

interface ServicePublishFormProps {
  mode?: "create" | "edit";
  serviceId?: string;
  onSaved?: (serviceId: string) => void;
}

type SuccessState = "none" | "draft_saved" | "submitted_for_review";

export function ServicePublishForm({
  mode = "create",
  serviceId,
  onSaved,
}: ServicePublishFormProps) {
  const { isAuthenticated, loginWithRedirect, isLoading: authLoading } = useAuth0();

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [hostingModel, setHostingModel] = useState<"self_hosted" | "remote" | "hybrid">("self_hosted");
  const [instructionSnippet, setInstructionSnippet] = useState("");
  const [remoteApiEndpoint, setRemoteApiEndpoint] = useState("");
  const [pricingModel, setPricingModel] = useState<"free" | "paid" | "freemium">("free");
  const [priceUsdCents, setPriceUsdCents] = useState(0);

  // Source deployment for browsing installed components/skills
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);

  // Creator deployment for hosted services (self_hosted / hybrid)
  const [creatorDeploymentId, setCreatorDeploymentId] = useState<string | null>(null);

  // Component and skill IDs
  const [componentIdInput, setComponentIdInput] = useState("");
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [skillIdInput, setSkillIdInput] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);

  const [successState, setSuccessState] = useState<SuccessState>("none");
  const [savedServiceId, setSavedServiceId] = useState<string | null>(null);

  // ── Fetch existing service for edit mode ──────────────────────────────
  const serviceQuery = trpc.services.get.useQuery(
    { serviceId: serviceId! },
    { enabled: mode === "edit" && !!serviceId }
  );

  // Pre-populate form fields when editing
  useEffect(() => {
    if (mode !== "edit" || !serviceQuery.data) return;
    const svc = serviceQuery.data;
    setName(svc.name ?? "");
    setDisplayName(svc.displayName ?? "");
    setDescription(svc.description ?? "");
    setHostingModel((svc.hostingModel ?? "self_hosted") as typeof hostingModel);
    setInstructionSnippet(svc.instructionSnippet ?? "");
    setRemoteApiEndpoint(svc.remoteApiEndpoint ?? "");
    setPricingModel((svc.pricingModel ?? "free") as typeof pricingModel);
    setPriceUsdCents(svc.priceUsdCents ?? 0);
    setComponentIds(
      (svc.components ?? []).map((c: { id: string }) => c.id)
    );
    setSkillIds(
      (svc.skills ?? []).map((s: { id: string }) => s.id)
    );
    if (svc.creatorDeploymentId) {
      setCreatorDeploymentId(svc.creatorDeploymentId);
    }
  }, [mode, serviceQuery.data]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const publishMutation = trpc.services.publish.useMutation();
  const createDraftMutation = trpc.services.createDraft.useMutation();
  const updateDraftMutation = trpc.services.updateDraft.useMutation();
  const submitForReviewMutation = trpc.services.submitForReview.useMutation();

  // ── Helpers ───────────────────────────────────────────────────────────
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

  const handleDeploymentChange = (deploymentId: string) => {
    setSelectedDeploymentId(deploymentId);
    setComponentIds([]);
    setSkillIds([]);
  };

  const buildPayload = () => ({
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
    creatorDeploymentId: creatorDeploymentId || undefined,
  });

  // ── Save as Draft ─────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    try {
      let resolvedId: string;
      if (mode === "edit" && serviceId) {
        await updateDraftMutation.mutateAsync({
          serviceId,
          ...buildPayload(),
        });
        resolvedId = serviceId;
      } else {
        const result = await createDraftMutation.mutateAsync(buildPayload());
        resolvedId = result.serviceId;
      }
      setSavedServiceId(resolvedId);
      setSuccessState("draft_saved");
      onSaved?.(resolvedId);
    } catch {
      // Error shown via mutation state
    }
  };

  // ── Submit for Review ─────────────────────────────────────────────────
  const handleSubmitForReview = async () => {
    try {
      let resolvedId = serviceId;

      // Save draft first to persist any unsaved changes
      if (mode === "edit" && serviceId) {
        await updateDraftMutation.mutateAsync({
          serviceId,
          ...buildPayload(),
        });
        resolvedId = serviceId;
      } else {
        const result = await createDraftMutation.mutateAsync(buildPayload());
        resolvedId = result.serviceId;
      }

      // Now submit for review
      await submitForReviewMutation.mutateAsync({ serviceId: resolvedId! });

      setSavedServiceId(resolvedId!);
      setSuccessState("submitted_for_review");
      onSaved?.(resolvedId!);
    } catch {
      // Error shown via mutation state
    }
  };

  // ── Validation ────────────────────────────────────────────────────────
  const isMutating =
    createDraftMutation.isPending ||
    updateDraftMutation.isPending ||
    submitForReviewMutation.isPending ||
    publishMutation.isPending;

  const canSaveDraft =
    name.length > 0 &&
    displayName.length > 0 &&
    !isMutating;

  const canSubmitForReview =
    name.length > 0 &&
    displayName.length > 0 &&
    (componentIds.length > 0 || skillIds.length > 0) &&
    !isMutating;

  // ── Mutation error ────────────────────────────────────────────────────
  const mutationError =
    createDraftMutation.error ??
    updateDraftMutation.error ??
    submitForReviewMutation.error ??
    publishMutation.error;

  // ── Reset form ────────────────────────────────────────────────────────
  const resetForm = () => {
    setSuccessState("none");
    setSavedServiceId(null);
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
    setSelectedDeploymentId(null);
    setCreatorDeploymentId(null);
  };

  // ── Auth gate ─────────────────────────────────────────────────────────
  if (!isAuthenticated && !authLoading) {
    return (
      <Card className="max-w-2xl mx-auto border border-border">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <Package className="size-12 text-muted-foreground" />
          <p className="text-muted-foreground text-center">
            Sign in to publish services to the marketplace.
          </p>
          <Button onClick={() => loginWithRedirect()}>
            <LogIn className="size-4 mr-2" />
            Sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Loading skeleton (edit mode) ──────────────────────────────────────
  if (mode === "edit" && serviceQuery.isLoading) {
    return (
      <Card className="max-w-2xl mx-auto border border-border">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
          <div className="flex gap-3">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Success: Draft Saved ──────────────────────────────────────────────
  if (successState === "draft_saved") {
    return (
      <Card className="max-w-2xl mx-auto border border-border">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <CheckCircle2 className="size-12 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xl font-semibold">Draft Saved</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Your service draft has been saved. You can test it on a deployment
            or continue editing later.
          </p>
          <div className="flex gap-3">
            {savedServiceId && (
              <Button asChild variant="default">
                <Link href={`/marketplace/services/${savedServiceId}/draft`}>
                  Test on Deployment
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={resetForm}>
              Create Another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Success: Submitted for Review ─────────────────────────────────────
  if (successState === "submitted_for_review") {
    return (
      <Card className="max-w-2xl mx-auto border border-border">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <CheckCircle2 className="size-12 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xl font-semibold">Service Submitted</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Your service has been submitted for review. It will appear in the
            marketplace once approved by the moderation team.
          </p>
          <Button variant="outline" onClick={resetForm}>
            Publish another
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────
  return (
    <Card className="max-w-2xl mx-auto border border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-5" />
          {mode === "edit" ? "Edit Service Draft" : "Create a Service"}
        </CardTitle>
        <CardDescription>
          {mode === "edit"
            ? "Update your service draft. Save changes or submit for review when ready."
            : "Bundle components and skills together for one-click installation. Save as a draft to test, or submit directly for review."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Name (slug) */}
        <div className="space-y-2">
          <Label htmlFor="pkg-name">Service Name (slug)</Label>
          <Input
            id="pkg-name"
            placeholder="my-analytics-service"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            maxLength={100}
            disabled={mode === "edit"}
          />
          <p className="text-xs text-muted-foreground">
            {mode === "edit"
              ? "The service name cannot be changed after creation."
              : "Lowercase letters, numbers, and hyphens only."}
          </p>
        </div>

        {/* Display Name */}
        <div className="space-y-2">
          <Label htmlFor="pkg-display-name">Display Name</Label>
          <Input
            id="pkg-display-name"
            placeholder="My Analytics Service"
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
              <SelectItem value="remote">Cloud (runs on your server)</SelectItem>
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
              placeholder="https://api.example.com/v1/service"
              type="url"
              value={remoteApiEndpoint}
              onChange={(e) => setRemoteApiEndpoint(e.target.value)}
              maxLength={500}
            />
          </div>
        )}

        {/* Creator Deployment (shown for self_hosted/hybrid) */}
        {(hostingModel === "self_hosted" || hostingModel === "hybrid") && (
          <div className="space-y-2">
            <Label>Host Deployment</Label>
            <DeploymentPicker
              selectedId={creatorDeploymentId}
              onSelect={setCreatorDeploymentId}
            />
            <p className="text-xs text-muted-foreground">
              Select the deployment that will host this service. Other deployments
              will route requests to this pod.
            </p>
          </div>
        )}

        <Separator />

        {/* Source Deployment */}
        <div className="space-y-2">
          <Label>Source Deployment</Label>
          <DeploymentPicker
            selectedId={selectedDeploymentId}
            onSelect={handleDeploymentChange}
          />
          <p className="text-xs text-muted-foreground">
            Select a running deployment to browse its installed components and skills.
          </p>
        </div>

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
            Use it to teach the bot how to use your service&apos;s components/skills.
          </p>
        </div>

        <Separator />

        {/* Components */}
        <div className="space-y-2">
          <Label>Components</Label>
          {selectedDeploymentId ? (
            <DeploymentComponentBrowser
              deploymentId={selectedDeploymentId}
              selectedIds={componentIds}
              onSelectionChange={setComponentIds}
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                Select a deployment above to browse components, or add IDs manually.
              </p>
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
            </>
          )}
        </div>

        {/* Skills */}
        <div className="space-y-2">
          <Label>Skills</Label>
          {selectedDeploymentId ? (
            <DeploymentSkillBrowser
              deploymentId={selectedDeploymentId}
              selectedIds={skillIds}
              onSelectionChange={setSkillIds}
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                Select a deployment above to browse skills, or add IDs manually.
              </p>
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
            </>
          )}
          {hostingModel === "remote" && (
            <p className="text-xs text-muted-foreground">
              For cloud-hosted services, component selection is optional &mdash; your remote API provides the functionality.
            </p>
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
        {mutationError && (
          <p className="text-sm text-destructive">
            {mutationError.message}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            className="flex-1"
            variant="outline"
            disabled={!canSaveDraft}
            onClick={handleSaveDraft}
          >
            {(createDraftMutation.isPending || updateDraftMutation.isPending) ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="size-4 mr-2" />
                Save as Draft
              </>
            )}
          </Button>
          <Button
            className="flex-1"
            disabled={!canSubmitForReview}
            onClick={handleSubmitForReview}
          >
            {submitForReviewMutation.isPending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="size-4 mr-2" />
                Submit for Review
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
