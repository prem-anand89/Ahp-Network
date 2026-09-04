// §8G4 (Phase 7) — the service worker's only job is receiving a push
// event and showing a notification. No caching, no offline strategy —
// out of scope, this exists purely so PushManager.subscribe() has a
// registration to attach to.

self.addEventListener("push", (event) => {
  let payload = { title: "AHP Network", body: "You have a new update." };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Non-JSON push data is ignored rather than shown mangled.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const referralId = event.notification.data?.referral_id;
  const url = referralId ? `/app/referrals/${referralId}` : "/app/referrals";
  event.waitUntil(self.clients.openWindow(url));
});
