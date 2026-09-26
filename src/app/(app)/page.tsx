import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { homeFor } from "@/lib/nav";

export default async function Home({ searchParams }: { searchParams: { denied?: string } }) {
  const ctx = await getContext();
  const home = homeFor(ctx.perms);
  if (home && !searchParams.denied) redirect(home);
  // denied=1: a page guard refused access; show why, then offer the user's own workspace.
  return (
    <div className="card mx-auto mt-16 max-w-lg p-8 text-center">
      <p className="text-lg font-semibold text-navy-700">{ctx.t("app.name")}</p>
      <p className="mt-3 text-sm text-ink-500">{home ? ctx.t("auth.denied") : ctx.t("auth.noRoles")}</p>
      {home && <a href={home} className="btn-primary mt-6">{ctx.t("nav.home")}</a>}
    </div>
  );
}
