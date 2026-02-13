/**
 * GuidedTour — placeholder stub.
 * The full implementation will be added in a future PR.
 */
export default function GuidedTour({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md mx-4 shadow-2xl text-center space-y-4">
        <h2 className="text-xl font-bold text-foreground">Guided Tour</h2>
        <p className="text-muted-foreground text-sm">
          The interactive guided tour is coming soon.
        </p>
        <button
          onClick={onClose}
          className="px-6 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
