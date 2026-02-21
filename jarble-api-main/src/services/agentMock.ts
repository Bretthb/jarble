/**
 * Mock agent for dev mode (MOCK_K8S=true).
 *
 * Simulates an OpenClaw bot conversation so the chat endpoint
 * can be tested without a real K8s pod.
 */

export interface MockAgentOptions {
  userMessage: string;
  deploymentName: string;
  deploymentId?: string;
  onChunk: (delta: string) => void;
  onToolCall: (id: string, name: string, args: string) => void;
  onDone: () => void;
}

interface MockResponse {
  pattern: RegExp;
  response: (name: string) => string;
}

const RESPONSES: MockResponse[] = [
  {
    pattern: /^(hi|hello|hey|sup|yo)\b/i,
    response: (name) => `Hey there! I'm ${name}. How can I help you today?`,
  },
  {
    pattern: /how are you|what's up/i,
    response: (name) => `I'm doing great, thanks for asking! I'm ${name}, ready to chat whenever you are.`,
  },
  {
    pattern: /what can you do|help|what are you/i,
    response: (name) => `I'm ${name}, an AI assistant. I can answer questions, have conversations, and help you with all sorts of things. Just ask!`,
  },
  {
    pattern: /thank|thanks/i,
    response: () => `You're welcome! Let me know if there's anything else I can help with.`,
  },
  {
    pattern: /bye|goodbye|see you/i,
    response: () => `Goodbye! Feel free to come back anytime.`,
  },
];

const DEFAULT_RESPONSES = [
  (name: string, msg: string) => `That's an interesting question! As ${name}, I'd say it depends on the context. Can you tell me more about what you're looking for?`,
  (name: string, msg: string) => `Great question! I'm thinking about that... Here's my take: the key thing to consider is the broader context. What do you think?`,
  (name: string, msg: string) => `I hear you! Let me share my thoughts on that. There are a few angles to consider here.`,
  (name: string, msg: string) => `Interesting! I'd be happy to dive deeper into that topic. What aspect are you most curious about?`,
];

/**
 * Stream a mock bot conversation response with simulated typing delay.
 * Simulates the OpenClaw bot chatting (not management).
 */
export async function streamMockAgent(opts: MockAgentOptions): Promise<void> {
  const { userMessage, deploymentName, onChunk, onDone } = opts;

  // Find matching response
  let response: string | null = null;
  for (const entry of RESPONSES) {
    if (entry.pattern.test(userMessage)) {
      response = entry.response(deploymentName);
      break;
    }
  }

  // Fallback: pick a varied default response
  if (!response) {
    const idx = Math.abs(userMessage.length) % DEFAULT_RESPONSES.length;
    response = DEFAULT_RESPONSES[idx](deploymentName, userMessage);
  }

  // Simulate streaming the text
  const words = response.split(" ");
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? "" : " ") + words[i];
    onChunk(chunk);
    await new Promise((r) => setTimeout(r, 20));
  }

  onDone();
}
