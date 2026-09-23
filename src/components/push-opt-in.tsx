"use client";

// Round 2 — wraps EnablePushButton with the iOS install prompt the
// notifications plan calls for. On iOS Safari, web push only works
// inside an installed (Add to Home Screen) PWA — there's no permission-
// denied event to recover from if you skip this, push simply never
// arrives, silently. Detecting "iOS but not installed" and showing
// install instructions instead of a button that would appear to work
// but doesn't is the whole point of this component; EnablePushButton
// itself is unchanged and still used everywhere else (post-verification)
// where iOS isn't a special case worth a second component.

import { useEffect, useState } from "react";
import { EnablePushButton } from "@/components/enable-push-button";

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as "Macintosh" but is touch-capable, unlike a real Mac.
  const isIOSLike = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return isIOSLike;
}

function isStandalone(): boolean {
  // navigator.standalone is Safari-specific; display-mode is the general
  // PWA signal other engines use. Check both since either can be true
  // depending on how the app was installed.
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function PushOptIn() {
  const [needsInstall, setNeedsInstall] = useState(false);

  // One-time read of browser-only APIs (navigator, matchMedia) on mount —
  // not SSR-safe to compute inline, same legitimate exception as
  // onboarding-flow.tsx's sessionStorage hydration. eslint-disable-next-line
  // doesn't reach the violation (it's reported inside the effect body, not
  // on the useEffect( line itself), hence the block form.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time read of an
     external system (navigator/matchMedia) on mount, not a re-derivation
     of state React already owns. */
  useEffect(() => {
    setNeedsInstall(isIOSSafari() && !isStandalone());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (needsInstall) {
    return (
      <p className="text-sm text-muted-foreground">
        To get notified when a referral is offered to you on iPhone, add AHP Network to your Home
        Screen first — tap the Share icon, then &quot;Add to Home Screen&quot;. Offers will still
        reach you by email either way.
      </p>
    );
  }

  return <EnablePushButton />;
}
