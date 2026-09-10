/**
 * Silences ONE specific uncaught error thrown by an injected web-vitals
 * reporter that this application does not load.
 *
 * WHAT IT IS. A minified web-vitals build, evaluated as an anonymous script
 * (Chrome shows it as `VM49:2`), throws on every idle callback:
 *
 *   Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')
 *       at et.reportAllChanges
 *
 * It is not ours, and that was verified rather than assumed: `web-vitals` is
 * not a dependency of this app, neither `useReportWebVitals` nor
 * `reportWebVitals` appears anywhere in `src/`, and Next's own bundled copy is
 * reachable only through that hook and passes no options — so its
 * `reportAllChanges` path cannot run. The injector attaches at browser level,
 * which is why it survives an incognito window.
 *
 * WHY SUPPRESS RATHER THAN FIX. The throwing code is not in this repository
 * and cannot be edited from here. The reporter fails reading its own empty
 * metric entries inside `requestIdleCallback`; nothing it touches is ours.
 *
 * ── HOW THIS AVOIDS BECOMING A BUG-HIDING MACHINE ──────────────────────────
 *
 * A global error handler that swallows errors is a genuinely dangerous thing
 * to add, so this one is deliberately hard to trip:
 *
 *   1. BOTH the message AND the stack must match — the message alone
 *      ("reading 'startTime'") is a shape real code could produce, but it must
 *      ALSO come from a frame named `reportAllChanges`, an identifier that
 *      appears nowhere in this codebase. Either condition alone suppresses
 *      nothing.
 *   2. It never suppresses an error whose stack names a file. Our bundles
 *      resolve to real URLs; this injected script has none. A stack carrying
 *      `.ts`, `.tsx`, `.js` or an http(s) origin is ours and is left alone.
 *   3. Nothing is truly hidden. Every suppression is counted on
 *      `window.__suppressedInjectedVitalsErrors`, and the FIRST one still
 *      writes a console line saying what was suppressed and why — so a
 *      developer who wonders where an error went is told, once, instead of
 *      finding silence.
 *
 * Runs as an inline script so the handler is installed before the injected
 * reporter's first idle callback. Permitted by the app CSP via
 * `script-src 'unsafe-inline'` (see next.config.js), like the sibling
 * extension-attribute cleanup.
 */
export const suppressInjectedVitalsError = `(function(){
  try {
    var COUNTER = '__suppressedInjectedVitalsErrors';
    window[COUNTER] = 0;
    var told = false;
    window.addEventListener('error', function (event) {
      var message = (event && event.message) || '';
      var error = event && event.error;
      var stack = (error && error.stack) || '';
      // Both conditions, or nothing is suppressed. See the note above.
      if (message.indexOf("reading 'startTime'") === -1) return;
      if (stack.indexOf('reportAllChanges') === -1) return;
      // A stack that names a real file is OUR code and must never be hidden.
      if (/\\.(?:tsx?|jsx?|mjs|cjs)\\b/.test(stack) || /https?:\\/\\//.test(stack)) return;
      window[COUNTER] = (window[COUNTER] || 0) + 1;
      if (!told) {
        told = true;
        console.info(
          '[vitals] Suppressed an uncaught error from an INJECTED web-vitals reporter that this app '
          + 'does not load (no web-vitals dependency, no useReportWebVitals anywhere in src/). '
          + 'It fails reading its own empty metric entries and touches nothing in this application. '
          + 'Count so far is on window.' + COUNTER + '; only this exact signature is suppressed.'
        );
      }
      // Marks the error handled, which is what keeps it out of the console.
      event.preventDefault();
    }, true);
  } catch (e) { /* a console tidy-up must never break the page */ }
})();`;
