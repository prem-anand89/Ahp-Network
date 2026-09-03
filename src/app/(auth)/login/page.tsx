import { headers } from "next/headers";
import { isMobileUserAgent } from "@/lib/is-mobile-user-agent";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const headerList = await headers();
  const mobileFirst = isMobileUserAgent(headerList.get("user-agent"));

  return <LoginForm mobileFirst={mobileFirst} />;
}
