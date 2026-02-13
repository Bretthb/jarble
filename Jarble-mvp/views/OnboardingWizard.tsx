"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  Bot,
  FileCode,
  MessageCircle,
  Rocket,
  PartyPopper,
  HelpCircle,
  LogOut,
  Smartphone,
  RefreshCw
} from "lucide-react";
import { DeploymentLoader } from "@/components/WizardLoader";

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { id: 1, title: "Name Your Bot", icon: <Bot className="w-5 h-5" /> },
  { id: 2, title: "Choose Template", icon: <FileCode className="w-5 h-5" /> },
  { id: 3, title: "Deploy", icon: <Rocket className="w-5 h-5" /> },
  { id: 4, title: "Connect WhatsApp", icon: <MessageCircle className="w-5 h-5" /> },
];

export default function OnboardingWizard() {
  const { botId } = useParams() as { botId: string };
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth0();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(0);

  const [botName, setBotName] = useState("");
  const [whatsappConnected, setWhatsappConnected] = useState(false);

  const deployMutation = trpc.bot.deploy.useMutation({
    onSuccess: () => {
      toast.success("Bot deployed! Now connect WhatsApp.");
      setIsDeploying(false);
      setCurrentStep(4);
    },
    onError: (error) => {
      toast.error(error.message || "Deployment failed");
      setIsDeploying(false);
    },
  });

  const createMutation = trpc.bot.create.useMutation({
    onSuccess: (data) => {
      if (data?.id) {
        deployMutation.mutate(data.id);
      }
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create bot");
      setIsDeploying(false);
    },
  });

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 1:
        return botName.trim().length >= 2;
      case 2:
        return true;
      case 3:
        return true;
      case 4:
        return whatsappConnected;
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (currentStep === 3 && !isDeploying) {
      setIsDeploying(true);
      if (botId !== "new") {
        // Deploy existing bot by string ID
        deployMutation.mutate(botId);
      } else {
        // Create new bot then deploy
        createMutation.mutate({
          name: botName,
          template: "jarble-default",
          platform: "whatsapp",
        });
      }
    } else if (currentStep === 4) {
      toast.success("Setup complete! Your bot is ready.");
      router.push("/dashboard");
    } else if (currentStep < 4) {
      setCurrentStep((currentStep + 1) as Step);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 bg-card border-border">
          <p className="text-foreground mb-4">Please log in to continue</p>
          <Button onClick={() => router.push("/login")}>Sign In</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-12 flex items-center gap-4">
          <img src="https://azeubylyzvcqot5l.public.blob.vercel-storage.com/logos/jarblelogo.png" alt="Jarble Logo" className="w-16 h-16 object-contain rounded-lg" />
          <div className="flex-1">
            <h1 className="text-4xl font-bold mb-2">Create Your AI Bot</h1>
            <p className="text-muted-foreground">Step {currentStep} of {STEPS.length}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            className="border-border hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Log Out
          </Button>
        </div>

        {/* Progress Bar */}
        <div className="mb-12">
          <div className="flex justify-between mb-4">
            {STEPS.map((step) => (
              <button
                key={step.id}
                onClick={() => step.id <= currentStep && setCurrentStep(step.id as Step)}
                disabled={step.id > currentStep}
                className={`flex flex-col items-center gap-2 ${
                  step.id <= currentStep ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                    step.id < currentStep
                      ? "bg-green-500/20 border border-green-500 text-green-400 hover:bg-green-500/30"
                      : step.id === currentStep
                      ? "bg-primary border border-primary text-primary-foreground"
                      : "bg-secondary/80 border border-border text-muted-foreground"
                  }`}
                >
                  {step.id < currentStep ? "✓" : step.icon}
                </div>
                <span className={`text-xs text-center hidden sm:block ${
                  step.id === currentStep ? "text-primary" : "text-muted-foreground"
                }`}>
                  {step.title}
                </span>
              </button>
            ))}
          </div>
          <div className="w-full bg-secondary/80 rounded-full h-1">
            <div
              className="bg-primary h-1 rounded-full transition-all duration-300"
              style={{ width: `${(currentStep / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Step Content */}
        <Card className="bg-card border-border p-8 mb-8">
          {currentStep === 1 && <StepNameBot botName={botName} setBotName={setBotName} />}
          {currentStep === 2 && <StepChooseTemplate />}
          {currentStep === 3 && <StepDeploy isDeploying={isDeploying} deployProgress={deployProgress} botName={botName} />}
          {currentStep === 4 && <StepConnectWhatsApp connected={whatsappConnected} setConnected={setWhatsappConnected} />}
        </Card>

        {/* Navigation */}
        <div className="flex justify-between gap-4">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1 || isDeploying}
            className="border-border hover:bg-secondary/80"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          <Button
            onClick={handleNext}
            disabled={!canProceed() || isDeploying}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            {currentStep === 3 ? (
              isDeploying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  Deploy Bot
                  <Rocket className="w-4 h-4 ml-2" />
                </>
              )
            ) : currentStep === 4 ? (
              <>
                Finish Setup
                <PartyPopper className="w-4 h-4 ml-2" />
              </>
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepNameBot({ botName, setBotName }: { botName: string; setBotName: (name: string) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Name Your Bot</h2>
        <p className="text-muted-foreground">Give your AI assistant a name</p>
      </div>
      <div>
        <Label htmlFor="botName" className="mb-2 block">Bot Name</Label>
        <Input
          id="botName"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          className="bg-secondary/80 border-border text-foreground text-lg py-6"
          placeholder="My Awesome Bot"
          autoFocus
        />
        <p className="text-xs text-muted-foreground mt-2">
          This is how your bot will introduce itself. You can change it later.
        </p>
      </div>
      {botName.trim().length >= 2 && (
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Great name!
        </div>
      )}
    </div>
  );
}

function StepChooseTemplate() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Template</h2>
        <p className="text-muted-foreground">Select a template for your bot</p>
      </div>
      <div className="p-6 rounded-lg border-2 border-primary bg-primary/10 cursor-default">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-lg">Jarble Default</h3>
              <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">Selected</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              A versatile AI assistant with conversation skills, ready to help with any task
            </p>
          </div>
          <CheckCircle2 className="w-6 h-6 text-primary" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-xs px-2 py-1 rounded-full bg-secondary/80 text-muted-foreground">Conversational</span>
          <span className="text-xs px-2 py-1 rounded-full bg-secondary/80 text-muted-foreground">Helpful</span>
          <span className="text-xs px-2 py-1 rounded-full bg-secondary/80 text-muted-foreground">Multi-purpose</span>
        </div>
      </div>
      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
        <HelpCircle className="w-5 h-5 text-blue-400 mt-0.5" />
        <p className="text-sm text-blue-300">
          More templates coming soon! After launch, you'll be able to choose from community templates or create your own.
        </p>
      </div>
    </div>
  );
}

function StepConnectWhatsApp({ connected, setConnected }: { connected: boolean; setConnected: (connected: boolean) => void }) {
  const [qrExpired, setQrExpired] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Connect WhatsApp</h2>
        <p className="text-muted-foreground">Link your WhatsApp to chat with your bot</p>
      </div>
      {connected ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-400" />
          </div>
          <h3 className="text-xl font-semibold text-green-400 mb-2">WhatsApp Connected!</h3>
          <p className="text-muted-foreground text-sm">Your WhatsApp account is linked and ready to go</p>
        </div>
      ) : (
        <>
          <div className="bg-secondary/50 rounded-lg p-6">
            <div className="flex flex-col md:flex-row gap-6 items-center">
              <div className="relative">
                <div className={`w-48 h-48 bg-white rounded-lg flex items-center justify-center ${qrExpired ? 'opacity-50' : ''}`}>
                  <div className="p-4">
                    <div className="grid grid-cols-8 gap-0.5">
                      {Array.from({ length: 64 }).map((_, i) => (
                        <div key={i} className={`w-4 h-4 ${Math.random() > 0.5 ? 'bg-black' : 'bg-white'}`} />
                      ))}
                    </div>
                  </div>
                </div>
                {qrExpired && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                    <Button variant="outline" size="sm" onClick={() => { setQrExpired(false); setConnected(false); }} className="bg-white text-black hover:bg-gray-100">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh QR
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-green-400" />
                  Scan with WhatsApp
                </h3>
                <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside">
                  <li>Open WhatsApp on your phone</li>
                  <li>Tap <strong>Menu</strong> or <strong>Settings</strong> and select <strong>Linked Devices</strong></li>
                  <li>Tap <strong>Link a Device</strong></li>
                  <li>Point your phone at this QR code to scan</li>
                </ol>
              </div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <HelpCircle className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-blue-300 font-medium">Why WhatsApp?</p>
                <p className="text-xs text-blue-400/80 mt-1">WhatsApp lets you chat with your bot from your phone instantly. No app downloads needed!</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <svg className="w-5 h-5 text-green-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <div>
                <p className="text-sm text-green-300 font-medium">Your privacy is protected</p>
                <p className="text-xs text-green-400/80 mt-1">Messages are end-to-end encrypted. We never store your personal chats.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StepDeploy({ isDeploying, deployProgress, botName }: { isDeploying: boolean; deployProgress: number; botName: string }) {
  return (
    <div className="space-y-6 text-center">
      {isDeploying ? (
        <div className="py-8">
          <DeploymentLoader progress={deployProgress} />
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-2xl font-bold mb-2">Deploy Your Bot</h2>
            <p className="text-muted-foreground">Your bot is configured and ready to launch!</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-12">
            <div className="flex flex-col items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/50">
                <Rocket className="w-10 h-10 text-primary" />
              </div>
              <div>
                <p className="text-lg font-semibold">Ready for Takeoff!</p>
                <p className="text-muted-foreground text-sm mt-1">
                  <span className="text-primary font-medium">{botName}</span> is configured and waiting to be deployed
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-4">
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Bot named
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Template selected
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Rocket className="w-4 h-4 text-primary" />
            <p className="text-sm">Click "Deploy Bot" to launch, then connect WhatsApp!</p>
          </div>
        </>
      )}
    </div>
  );
}
