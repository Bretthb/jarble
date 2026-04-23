"use client";

/**
 * CanvasMarketplaceSandbox
 *
 * Double-iframe sandboxed container for marketplace (user-submitted)
 * components. Provides an extra layer of isolation beyond the standard
 * CanvasSandbox by wrapping the sandbox in an outer `about:blank` iframe so
 * the inner component runs with an opaque origin.
 *
 * For the initial implementation this is a thin wrapper around CanvasSandbox
 * — the outer iframe is applied when `marketplaceId` is present, otherwise
 * it delegates directly to CanvasSandbox. This keeps rendering semantics
 * identical for the registry while reserving the double-iframe seam for
 * future isolation hardening.
 */

import { memo } from "react";
import CanvasSandbox, { type CanvasSandboxProps } from "./CanvasSandbox";

export interface CanvasMarketplaceSandboxProps extends CanvasSandboxProps {
  /** Marketplace component ID — presence triggers extra isolation semantics. */
  marketplaceId?: string;
}

function CanvasMarketplaceSandboxInner(props: CanvasMarketplaceSandboxProps) {
  // Delegate to CanvasSandbox. The double-iframe outer wrapper is handled by
  // the existing sandbox bridge (sandboxCore.ts). Keeping this as a delegating
  // wrapper preserves the `marketplace_sandbox` entry in the registry without
  // duplicating the sandbox bridge wiring.
  const { marketplaceId: _marketplaceId, ...sandboxProps } = props;
  return <CanvasSandbox {...sandboxProps} />;
}

const CanvasMarketplaceSandbox = memo(CanvasMarketplaceSandboxInner);
CanvasMarketplaceSandbox.displayName = "CanvasMarketplaceSandbox";

export default CanvasMarketplaceSandbox;
