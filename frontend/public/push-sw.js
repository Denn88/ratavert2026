// Runs inside the service worker. Shows a phone/desktop notification when the
// backend sends a push (for example, when a rat is detected).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "RatAvert";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Rat detected",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "ratavert-detection",
      renotify: true,
      data: { url: data.url || "/" },
    })
  );
});

// Tapping the notification opens (or focuses) the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
