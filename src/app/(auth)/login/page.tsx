import { headers } from "next/headers";
import { isMobileUserAgent } from "@/lib/is-mobile-user-agent";
import { LoginForm } from "./login-form";

function safeNextPath(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (next.startsWith("/app/") || next.startsWith("/admin")) return next;
  return undefined;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_callback_failed: "Sign-in could not be completed. Please try again.",
  oauth_init_failed: "Could not start Google sign-in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const headerList = await headers();
  const mobileFirst = isMobileUserAgent(headerList.get("user-agent"));

  return (
    <LoginForm
      mobileFirst={mobileFirst}
      nextPath={safeNextPath(params.next)}
      authError={params.error ? AUTH_ERROR_MESSAGES[params.error] ?? "Sign-in failed. Please try again." : null}
    />
  );
}
