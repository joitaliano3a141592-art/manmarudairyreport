type DataErrorStateProps = {
  title?: string;
  error: unknown;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "データの取得に失敗しました。時間をおいて再度お試しください。";
}

export function DataErrorState({
  title = "データの取得に失敗しました",
  error,
}: DataErrorStateProps) {
  return (
    <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
      <div className="max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-5 text-center">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{getErrorMessage(error)}</p>
      </div>
    </div>
  );
}