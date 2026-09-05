import Link from "next/link";

export function AdminSubNav() {
  return (
    <nav className="border-b bg-background px-4 py-2">
      <div className="mx-auto flex max-w-5xl items-center gap-4 text-sm">
        <Link href="/admin" className="font-medium hover:underline">
          ← Admin home
        </Link>
      </div>
    </nav>
  );
}
