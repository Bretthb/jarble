import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "jarble-api";

// Create tRPC React hooks with real types from the API
export const trpc = createTRPCReact<AppRouter>();

// API URL - external jarble-api service
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
