"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the ROOT layout itself (where the normal
 * `error.tsx` can't render because the layout that provides <html>/<body> failed).
 * It must render its own <html>/<body>, and can't rely on the app shell/theme — so it
 * uses inline styles with the brand colours only.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#ffffff",
          color: "#082957",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#667085", margin: "0 0 1.5rem" }}>
            A critical error occurred while loading the app. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#0fb4bb",
              color: "#082957",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
