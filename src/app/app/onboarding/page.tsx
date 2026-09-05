// §10C — onboarding steps 2, 2.5, and 3. Steps 0/1 are the public
// profile/directory and Supabase Auth sign-in themselves, already live;
// step 4 (credential upload) is the verification page's job
// (src/app/app/verification/page.tsx).

import { getAreaZones } from "@/lib/areas";
import { OnboardingFlow } from "./onboarding-flow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const zones = await getAreaZones();

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Three things — see exactly how your profile will look as you go.
      </p>
      <div className="mt-6">
        <OnboardingFlow zones={zones} />
      </div>
    </main>
  );
}
