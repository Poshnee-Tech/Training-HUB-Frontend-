/**
 * Pre-hydration cleanup for attributes injected by browser extensions.
 *
 * Bitdefender's browser extension scans pages for form fields to "skin" and
 * stamps `bis_skin_checked="1"` onto the wrapping elements. When it wins the
 * race against React, the server HTML and the client tree disagree on every
 * stamped node and React reports a hydration mismatch, then recovers by
 * throwing away the SSR markup and re-rendering the whole subtree on the
 * client. Functionally harmless, but it costs a full client render and buries
 * genuine hydration bugs under noise.
 *
 * `suppressHydrationWarning` cannot fix this: it covers one element's own
 * attributes and never its descendants, and the stamped nodes are arbitrary
 * divs deep in the tree.
 *
 * What makes this tractable is that React only inspects the DOM *during*
 * hydration. Strip the attribute until hydration settles and React never looks
 * again — so we do exactly that, then disconnect and leave the extension alone.
 *
 * Runs as a blocking inline script at the end of <body>: after the markup the
 * extension stamps exists, before Next's deferred bundle hydrates. The
 * MutationObserver covers the other ordering, where the extension's content
 * script runs at document_idle and stamps after us.
 *
 * Permitted by the app CSP via `script-src 'unsafe-inline'` (see next.config.js).
 * Add other vendors' markers to ATTRS as they turn up; the observer is filtered
 * to just these names, so the cost is negligible.
 */
export const stripExtensionAttrs = `(function(){
  var ATTRS = ['bis_skin_checked', 'bis_register'];
  var sel = ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
  var clean = function (el) {
    for (var i = 0; i < ATTRS.length; i++) el.removeAttribute(ATTRS[i]);
  };
  try {
    var stamped = document.querySelectorAll(sel);
    for (var i = 0; i < stamped.length; i++) clean(stamped[i]);
    var obs = new MutationObserver(function (records) {
      for (var j = 0; j < records.length; j++) {
        var t = records[j].target;
        if (t.nodeType === 1) clean(t);
      }
    });
    obs.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    // Hydration is done well before load + 2s. After this the extension is
    // free to stamp whatever it likes; React will never diff the DOM again.
    var stop = function () { setTimeout(function () { obs.disconnect(); }, 2000); };
    if (document.readyState === 'complete') stop();
    else window.addEventListener('load', stop);
  } catch (e) {}
})();`;
