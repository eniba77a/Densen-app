import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AuthProvider } from "./state/auth";
import App from "./App";
import "./index.css";

/**
 * Public browser URL for the Convex deployment — a *public* value by design
 * (the SPA must connect). Auth secrets (RESEND_API_KEY) live only in Convex
 * action env, never in the client bundle.
 *
 * Without VITE_CONVEX_URL the Convex layer is not mounted at all: the existing
 * prototype runs exactly as before, and the auth page detects the missing URL
 * and offers an honest in-browser registration preview instead of a broken call.
 */
const VITE_CONVEX_URL = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CONVEX_URL;
const convex = VITE_CONVEX_URL ? new ConvexReactClient(VITE_CONVEX_URL) : null;

const app = (
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  convex ? <ConvexProvider client={convex}>{app}</ConvexProvider> : app
);
