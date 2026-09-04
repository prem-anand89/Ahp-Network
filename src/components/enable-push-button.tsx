"use client";

// §8G4 (Phase 7) — the contextual permission prompt. Deliberately a
// button the therapist taps, never an automatic prompt on page load
// (browsers throttle/block permission prompts that aren't a direct
// response to a user gesture, and an unprompted browser permission
// dialog on first page load is the single most-hated onboarding pattern
// on the web). BUILD_SEQUENCE.md Phase 7: shown post-first-verification,
// not before — drop this into whatever surface marks that moment (the
// verification-celebration screen), not the app shell.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { subscribeToPush } from "@/app/app/push/actions";

function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function EnablePushButton() {
  const [state, setState] = useState<"idle" | "requesting" | "enabled" | "denied" | "unsupported">("idle");

  async function enable() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    setState("requesting");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState("denied");
      return;
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setState("unsupported");
      return;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    await subscribeToPush({
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh!,
      auth: json.keys!.auth!,
    });
    setState("enabled");
  }

  if (state === "enabled") {
    return <p className="text-sm text-muted-foreground">Push notifications are on.</p>;
  }
  if (state === "denied") {
    return (
      <p className="text-sm text-muted-foreground">
        Notifications are blocked — you can still catch offers by email, or re-enable this in your browser settings.
      </p>
    );
  }
  if (state === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground">
        Push isn&apos;t available in this browser — offers will still reach you by email.
      </p>
    );
  }

  return (
    <Button onClick={enable} disabled={state === "requesting"}>
      {state === "requesting" ? "Requesting…" : "Get notified when a referral is offered to you"}
    </Button>
  );
}
