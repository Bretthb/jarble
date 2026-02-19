"use client";

import { useEffect, useRef } from "react";
import { useQrStream } from "@/hooks/useQrStream";
import { parseAsciiQr, renderQrToCanvas } from "@/lib/asciiQrToCanvas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, RefreshCw, Smartphone, AlertCircle } from "lucide-react";

interface WhatsAppQrModalProps {
  deploymentId: string;
  isOpen: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export function WhatsAppQrModal({
  deploymentId,
  isOpen,
  onClose,
  onConnected,
}: WhatsAppQrModalProps) {
  const { qrData, connected, timedOut, isConnecting, error, start, reset } =
    useQrStream({ deploymentId, enabled: isOpen });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Render QR code to canvas whenever qrData changes
  useEffect(() => {
    if (qrData && canvasRef.current) {
      const matrix = parseAsciiQr(qrData);
      if (matrix.length > 0) {
        renderQrToCanvas(matrix, canvasRef.current, 5, 4);
      }
    }
  }, [qrData]);

  // Start streaming when modal opens
  useEffect(() => {
    if (isOpen) {
      start();
    } else {
      reset();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when connected
  useEffect(() => {
    if (connected) {
      onConnected();
      // Auto-close after brief delay to show success state
      const timer = setTimeout(onClose, 1500);
      return () => clearTimeout(timer);
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Connect WhatsApp
          </DialogTitle>
          <DialogDescription>
            Link your WhatsApp account to this deployment
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center py-4">
          {/* Loading state */}
          {isConnecting && !qrData && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Generating QR code...
              </p>
            </div>
          )}

          {/* QR Code display - canvas rendered */}
          {qrData && !connected && (
            <div className="flex flex-col items-center gap-5">
              <canvas
                ref={canvasRef}
                className="rounded-lg shadow-lg"
                style={{ imageRendering: "pixelated", maxWidth: "100%", height: "auto" }}
              />
              <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Open <strong>WhatsApp</strong> on your phone</li>
                <li>
                  Tap <strong>Menu</strong> (or <strong>Settings</strong>) →{" "}
                  <strong>Linked Devices</strong>
                </li>
                <li>
                  Tap <strong>Link a Device</strong>
                </li>
                <li>Point your phone camera at this QR code</li>
              </ol>
            </div>
          )}

          {/* Connected success */}
          {connected && (
            <div className="flex flex-col items-center gap-2 py-8">
              <CheckCircle2 className="w-14 h-14 text-primary" />
              <p className="text-lg font-semibold text-primary">
                WhatsApp Connected!
              </p>
              <p className="text-sm text-muted-foreground">
                Your bot is now linked to WhatsApp
              </p>
            </div>
          )}

          {/* Timeout */}
          {timedOut && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertCircle className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                QR code expired. Please try again.
              </p>
              <Button onClick={() => start()} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Generate New QR
              </Button>
            </div>
          )}

          {/* Error */}
          {error && !timedOut && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertCircle className="w-10 h-10 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button onClick={() => start()} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
