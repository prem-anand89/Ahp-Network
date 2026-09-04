// The (auth) route group's layout — login/signup pages. Separate from
// (public) (must stay static/ISR) and /app/* or /admin/* (authenticated). This group is
// neither: it's dynamic (reads the request's user-agent for §4's
// mobile-first OTP default) but isn't gated behind a session.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">{children}</div>
  );
}
