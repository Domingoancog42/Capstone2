const { createProxyMiddleware } = require("http-proxy-middleware");

/*
 * What the dev server is allowed to forward to Apache.
 *
 * `"proxy": "http://localhost"` in package.json used to do this job, and it did it for *every* path
 * the dev server did not recognise. That is a catch-all reverse proxy into the whole XAMPP install,
 * and it is the single reason the penetration test of 2026-08-24 got as far as it did: with a tunnel
 * published on port 3000, `/phpmyadmin/`, `/server-status`, `/server-info`, `/xampp/` and `/icons/`
 * were all reachable from the open internet through it.
 *
 * The important part is *why* they were reachable, because none of them is misconfigured. Apache
 * guards all of them with `Require local`, which was doing its job perfectly -- but the requests
 * arrived from the dev server, running on this machine, so Apache saw 127.0.0.1 and allowed them.
 * The proxy was laundering remote requests into local ones, and every host-based rule in the stack
 * was defeated by that one line of package.json. Rewriting those Apache rules would not have helped;
 * they were never consulted for a remote address in the first place.
 *
 * So the forwarding is now an allowlist. Two prefixes, which is everything the front end actually
 * asks Apache for:
 *
 *   backend/api      the endpoints
 *   backend/uploads  profile images, signatures and uploaded documents
 *
 * Anything else stops at the dev server and is answered with the app shell. phpMyAdmin is once again
 * reachable only from a browser on this machine -- which is what `Require local` always intended.
 *
 * This file replaces the `proxy` field rather than supplementing it. react-scripts installs BOTH if
 * both exist (config/webpackDevServer.config.js registers this file in `onBeforeSetupMiddleware` and
 * still passes `proxy` through to webpack-dev-server), so leaving the field in package.json would
 * have left the catch-all in place behind this and fixed nothing.
 */

// Derived from the same value the app builds its request URLs from, so the two cannot drift apart.
// An absolute REACT_APP_API_BASE_URL means the API is on another origin and is not this server's to
// proxy at all, in which case nothing is forwarded.
const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "/Capstone2/frontend/backend/api";

module.exports = function setupProxy(app) {
  if (/^https?:\/\//i.test(apiBaseUrl)) {
    return;
  }

  const backendRoot = apiBaseUrl.replace(/\/+$/, "").replace(/\/api$/i, "");
  const allowedPrefixes = [`${backendRoot}/api`, `${backendRoot}/uploads`];

  const shouldForward = (pathname) =>
    allowedPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );

  app.use(
    createProxyMiddleware(shouldForward, {
      target: "http://localhost",

      /*
       * Apache is asked for these as `localhost`, which is the name the rest of the XAMPP config is
       * written against. It also means HTTP_HOST reaches PHP reading "localhost" on a request that
       * came from anywhere at all -- see is_local_password_reset_environment(), which refuses to call
       * a request local when the forwarding headers below are present precisely because of this.
       */
      changeOrigin: true,

      /*
       * Adds X-Forwarded-For / X-Forwarded-Host, and this is load-bearing rather than tidiness.
       *
       * Without them every proxied request reaches PHP as 127.0.0.1, so the per-IP rate limits on
       * sign-in, reset codes and two-factor codes -- the guards that stand between a six-digit code
       * and an attacker -- all counted the entire internet into one shared bucket, and the audit trail
       * recorded loopback as the origin of every action. With them, client_ip_address() can see who
       * the caller actually is. See that function for why it only believes these headers when the
       * request genuinely arrived from this machine.
       */
      xfwd: true,

      // The API speaks HTTP; nothing under these prefixes upgrades to a socket.
      ws: false,
      logLevel: "warn",
    })
  );
};
