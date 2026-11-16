import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Makes the site installable as an app (PWA).
    // The service worker only saves the app's own files (HTML, JS, CSS, icons).
    // It never saves backend data (detections, photos, logs): those come from a
    // different address (the Render backend), so they always load live.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "RatAvert",
        short_name: "RatAvert",
        description: "IoT-powered smart rat deterrence and prevention system",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#050F0A",
        theme_color: "#050F0A",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        // Push notification handlers (public/push-sw.js).
        importScripts: ["push-sw.js"],
      },
    }),
  ],
  server: { port: 5173 },
});
