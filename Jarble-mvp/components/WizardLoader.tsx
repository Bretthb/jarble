import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
  "Summoning the wizard...",
  "Brewing some magic...",
  "Consulting the crystal ball...",
  "Waving the wand...",
  "Mixing potions...",
  "Reading ancient scrolls...",
  "Casting spells...",
  "Almost there...",
];

const DEPLOYMENT_MESSAGES = [
  "Initializing your bot...",
  "Configuring AI models...",
  "Setting up connections...",
  "Preparing the magic...",
  "Deploying to the cloud...",
  "Running final checks...",
  "Almost ready...",
  "Polishing the crystal ball...",
];

const SIZE_CONFIG = {
  sm: { video: "w-16 h-16", text: "text-sm", container: "gap-3" },
  md: { video: "w-24 h-24", text: "text-base", container: "gap-4" },
  lg: { video: "w-32 h-32", text: "text-lg", container: "gap-5" },
  xl: { video: "w-48 h-48", text: "text-xl", container: "gap-6" },
};

export default function WizardLoader({
  message,
  messages = DEFAULT_MESSAGES,
  messageInterval = 2500,
  size = "lg",
  showVideo = true,
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

  const config = SIZE_CONFIG[size];

  const content = (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`flex flex-col items-center ${config.container}`}
    >
      {/* Wizard Animation */}
      <div className="relative">
        {/* Glow effect */}
        <motion.div
          className="absolute inset-0 rounded-full bg-primary/20 blur-xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        
        {showVideo ? (
          <div className={`${config.video} rounded-full overflow-hidden relative z-10 border-2 border-primary/30`}>
            <video
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="w-full h-full object-cover scale-150"
            >
              <source src="/wizard-animation.mp4" type="video/mp4" />
            </video>
          </div>
        ) : (
          <motion.div
            className={`${config.video} rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center relative z-10 border-2 border-primary/30`}
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span className="text-4xl">🧙‍♂️</span>
          </motion.div>
        )}

        {/* Sparkles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 bg-primary rounded-full"
            style={{
              left: `${20 + (i % 3) * 30}%`,
              top: `${10 + Math.floor(i / 3) * 60}%`,
            }}
            animate={{
              scale: [0, 1, 0],
              opacity: [0, 1, 0],
              y: [-5, -15, -25],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: i * 0.3,
            }}
          />
        ))}
      </div>

      {/* Message */}
      <div className="text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={displayMessage}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className={`font-semibold text-foreground ${config.text}`}
          >
            {displayMessage}
          </motion.p>
        </AnimatePresence>
        
        {subMessage && (
          <p className="text-muted-foreground text-sm mt-1">{subMessage}</p>
        )}
      </div>

      {/* Progress Bar */}
      {showProgress && (
        <div className="w-48 max-w-full">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">{Math.round(progress)}%</p>
        </div>
      )}

      {/* Animated dots */}
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-primary"
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.3, 1, 0.3],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
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
      size="xl"
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
      showVideo={false}
    />
  );
}
