/**
 * Opens the print dialog for a Print button's hidden frame (`?print=<size>`) as soon as
 * the sheet is on the page — before React has started (owner's report, 2026-11-06:
 * "Print thermal" was slow to respond).
 *
 * WHY: measured in a hidden frame, the receipt was fully drawn at ~0.3s and its fonts
 * were ready, yet the dialog opened at ~2.2–2.6s — the whole wait was the page's code
 * downloading and React hydrating, only so an effect could call `print()`. Nothing in
 * the printout needs React; it is server-rendered HTML at the requested size
 * (`InvoicePrintFrame`'s `serverPrintPaper`).
 *
 * The sheet arrives in a streamed Suspense chunk that React reveals on an animation
 * frame — throttled to ~1.5s in an invisible frame — so once it has arrived this runs
 * React's own reveal for it. It then waits for the sheet to be IN PLACE, drawn at the asked-for paper, with its images decoded and fonts loaded —
 * printing earlier would print a skeleton or the wrong size. Then it does exactly what
 * `printInFrame` does and sets the flag that makes `printInFrame` stand down, so there
 * is one dialog, never two. If it cannot (no sheet after 20s), it does nothing and the
 * React path prints as before.
 *
 * A server component: an inline script must carry the request's CSP nonce (ADR-026).
 */
export const EARLY_PRINT_FLAG = "__flexicaPrintStarted";

const SCRIPT = `(function(){
if (window.self === window.top) return;
var want = new URLSearchParams(location.search).get("print");
if (!want) return;
var started = Date.now();
function tell(stage){ parent.postMessage({ type: "flexica-print", stage: stage }, location.origin); }
function ready(){
  var s = document.querySelector(".invoice-sheet[data-paper]");
  if (!s || s.closest("[hidden]") || s.getAttribute("data-paper") !== want) return false;
  var imgs = s.querySelectorAll("img");
  for (var i = 0; i < imgs.length; i++) if (!imgs[i].complete) return false;
  return true;
}
function go(){
  if (window.${EARLY_PRINT_FLAG}) return;
  window.${EARLY_PRINT_FLAG} = true;
  addEventListener("afterprint", function(){ tell("done"); }, { once: true });
  tell("opened");
  print();
}
// React reveals streamed content from requestAnimationFrame until the page has
// painted, and Chrome throttles that to ~1.5s in an invisible frame. Once the sheet has
// fully ARRIVED (in its hidden chunk), run React's own reveal of the queued batch.
// Best-effort: if React's names change, this is skipped and the reveal comes as before.
function reveal(){
  var s = document.querySelector(".invoice-sheet[data-paper]");
  if (!s || !s.closest("[hidden]")) return;
  try { if (typeof window.$RV === "function" && window.$RB && window.$RB.length) window.$RV(window.$RB); } catch (e) {}
}
(function poll(){
  if (window.${EARLY_PRINT_FLAG} || Date.now() - started > 20000) return;
  if (!ready()) { reveal(); setTimeout(poll, 25); return; }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(function(){ setTimeout(go, 50); });
})();
})();`;

export function EarlyPrint({ nonce }: { nonce: string | null | undefined }) {
  return (
    <script
      nonce={nonce ?? undefined}
      // Browsers hide a nonce from the DOM once applied, so hydration sees "" here.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}
