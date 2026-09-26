export type FormState = { ok?: boolean; error?: string; message?: string } | undefined;

export function FormMessage({ state }: { state: FormState }) {
  if (!state?.error && !state?.message) return null;
  const isError = Boolean(state.error);
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-sm ${isError ? "bg-danger-50 text-danger" : "bg-ok-50 text-ok"}`}
    >
      {state.error ?? state.message}
    </p>
  );
}
