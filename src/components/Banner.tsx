export function Banner({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div role={error ? "alert" : "status"}
      className={`mb-5 rounded-lg px-4 py-3 text-sm ${error ? "bg-danger-50 text-danger" : "bg-ok-50 text-ok"}`}>
      {error ?? success}
    </div>
  );
}
