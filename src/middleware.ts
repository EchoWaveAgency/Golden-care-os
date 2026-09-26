import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Three contexts: public website (/ar, /en), staff system (/os), and later the patient portal.
// Only the staff system requires a staff session here; the database enforces everything else.
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path === "/") {
    const to = request.nextUrl.clone();
    to.pathname = request.headers.get("accept-language")?.toLowerCase().startsWith("en") ? "/en" : "/ar";
    return NextResponse.redirect(to);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new NextResponse("Supabase environment variables are not configured.", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session for the staff system and the patient portal.
  const { data: { user } } = await supabase.auth.getUser();
  if (path.startsWith("/os") && !path.startsWith("/os/login")) {
    if (!user) {
      const to = request.nextUrl.clone();
      to.pathname = "/os/login";
      to.search = "";
      return NextResponse.redirect(to);
    }
  }
  return response;
}

export const config = {
  // Public website pages skip the auth round-trip except for the session refresh on /os.
  matcher: ["/", "/os/:path*", "/ar/portal/:path*", "/en/portal/:path*"],
};
