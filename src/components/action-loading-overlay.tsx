type ActionLoadingOverlayProps = {
  open: boolean;
  message?: string;
};

export function ActionLoadingOverlay({ open, message = "処理中..." }: ActionLoadingOverlayProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex min-w-[220px] flex-col items-center gap-3 rounded-xl border bg-card px-6 py-5 shadow-lg">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}