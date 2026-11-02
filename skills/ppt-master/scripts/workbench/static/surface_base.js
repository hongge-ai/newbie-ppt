/*
 * Prefix same-origin surface API calls with the mount path, and hand the page
 * the workbench links it needs to continue after a decision.
 *
 * A per-project surface is served under /p/<slug>/<kind>/ and its own code
 * still calls "/api/...". This script runs before that code and rewrites the
 * leading-slash calls so they land on the surface's own app instead of the
 * workbench root. Standalone use is untouched: without a mount path it does
 * nothing.
 */
(function () {
  'use strict';

  var match = location.pathname.match(/^\/p\/([^/]+)\/(confirm|preview|spec)(?:\/|$)/);
  if (!match) return;

  var slug = match[1];
  var kind = match[2];
  var base = '/p/' + slug + '/' + kind;
  window.__PPT_SURFACE_BASE__ = base;
  window.__PPT_SURFACE_LINKS__ = {
    slug: slug,
    kind: kind,
    preview_url: '/p/' + slug + '/preview/'
  };

  function withBase(url) {
    if (typeof url !== 'string' || url.charAt(0) !== '/') return url;
    if (url === base || url.indexOf(base + '/') === 0) return url;
    if (url.indexOf('/__wb/') === 0) return url;
    return base + url;
  }

  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    window.fetch = function (input) {
      if (typeof input === 'string') {
        input = withBase(input);
      } else if (input && typeof input.url === 'string') {
        var parsed = new URL(input.url, location.href);
        if (parsed.origin === location.origin && withBase(parsed.pathname) !== parsed.pathname) {
          input = new Request(parsed.origin + withBase(parsed.pathname) + parsed.search, input);
        }
      }
      return nativeFetch.apply(window, arguments.length > 1
        ? [input, arguments[1]]
        : [input]);
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var nativeOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      var rest = Array.prototype.slice.call(arguments, 2);
      return nativeOpen.apply(this, [method, withBase(url)].concat(rest));
    };
  }

  // Ask the workbench which task this project belongs to, so a surface page
  // can link onward instead of dead-ending after its decision.
  fetch('/__wb/project-links/' + encodeURIComponent(slug))
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (!data) return;
      window.__PPT_SURFACE_LINKS__ = data;
      document.dispatchEvent(new CustomEvent('ppt-surface-links', { detail: data }));
    })
    .catch(function () { /* standalone or old workbench: keep the defaults */ });
})();
