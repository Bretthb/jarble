import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";

interface WizardLoaderProps {
  /** Loading message to display */
  message?: string;
  /** Array of messages to cycle through */
  messages?: string[];
  /** Interval for cycling messages (ms) */
  messageInterval?: number;
  /** Size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Whether to show the video or just the animated wizard */
  showVideo?: boolean;
  /** Whether this is a full-page loader */
  fullPage?: boolean;
  /** Optional sub-message */
  subMessage?: string;
  /** Show progress bar */
  showProgress?: boolean;
  /** Progress percentage (0-100) */
  progress?: number;
}

const DEFAULT_MESSAGES = [
  "Loading...",
  "Almost there...",
];

const DEPLOYMENT_MESSAGES = [
  "Initializing deployment...",
  "Configuring AI models...",
  "Setting up connections...",
  "Deploying to the cloud...",
  "Running final checks...",
  "Almost ready...",
];

export default function WizardLoader({
  message,
  messages = DEFAULT_MESSAGES,
  messageInterval = 2500,
  size = "lg",
  fullPage = false,
  subMessage,
  showProgress = false,
  progress = 0,
}: WizardLoaderProps) {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [displayMessage, setDisplayMessage] = useState(message || messages[0]);

  // Cycle through messages
  useEffect(() => {
    if (message) {
      setDisplayMessage(message);
      return;
    }

    const interval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
    }, messageInterval);

    return () => clearInterval(interval);
  }, [message, messages, messageInterval]);

  // Update display message when index changes
  useEffect(() => {
    if (!message) {
      setDisplayMessage(messages[currentMessageIndex]);
    }
  }, [currentMessageIndex, message, messages]);

  const content = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center gap-4"
    >
      {/* Spinner */}
      <Loader2
        className={`animate-spin text-primary ${
          size === "sm" ? "w-6 h-6" :
          size === "md" ? "w-8 h-8" :
          size === "xl" ? "w-10 h-10" :
          "w-8 h-8"
        }`}
      />

      {/* Message */}
      <div className="text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={displayMessage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`text-muted-foreground ${
              size === "sm" ? "text-xs" :
              size === "md" ? "text-sm" :
              "text-sm"
            }`}
          >
            {displayMessage}
          </motion.p>
        </AnimatePresence>

        {subMessage && (
          <p className="text-muted-foreground/60 text-xs mt-1.5">{subMessage}</p>
        )}
      </div>

      {/* Progress Bar */}
      {showProgress && (
        <div className="w-48 max-w-full">
          <div className="h-1 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/60 text-center mt-1.5">{Math.round(progress)}%</p>
        </div>
      )}
    </motion.div>
  );

  if (fullPage) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        {content}
      </div>
    );
  }

  return content;
}

// Export pre-configured variants
export function DeploymentLoader({ progress }: { progress?: number }) {
  return (
    <WizardLoader
      messages={DEPLOYMENT_MESSAGES}
      messageInterval={3000}
      size="lg"
      showProgress={progress !== undefined}
      progress={progress}
      subMessage="This usually takes about 30 seconds"
    />
  );
}

export function PageLoader({ message }: { message?: string }) {
  return (
    <WizardLoader
      message={message || "Loading..."}
      size="lg"
      fullPage
    />
  );
}

export function InlineLoader({ message }: { message?: string }) {
  return (
    <WizardLoader
      message={message}
      size="md"
    />
  );
}
