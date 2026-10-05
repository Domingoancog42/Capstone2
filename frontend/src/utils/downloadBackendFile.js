import { resolveBackendAssetUrl } from "./backendAssetUrl";

/**
 * Fetches a file stored under backend/uploads/ and hands back its bytes.
 *
 * Why anything fetches these at all instead of pointing an `<a href download>`, an `<iframe>` or a
 * new tab straight at the URL: under `npm start` the page is served by the CRA dev server while
 * uploads/ is served by Apache, and the dev server's proxy deliberately skips any request whose
 * `Accept` header asks for HTML so that client-side routes can fall back to index.html. A download,
 * a frame load and a tab navigation all send that navigation Accept header, so the dev server
 * answered every one of them with index.html and a 200 -- the Download button saved a copy of the
 * app's own HTML page under the document's file name, and the PDF preview framed the app inside
 * itself.
 *
 * `fetch()` defaults to `Accept: * / *`, which the proxy forwards to Apache, so what comes back is
 * the real file. Rendering and saving from the resulting blob then behaves the same way in
 * development and in production, and also survives the API being configured on another origin,
 * where the `download` attribute is ignored outright.
 */
export async function fetchBackendFileBlob(path, fileName = "") {
  const fileUrl = resolveBackendAssetUrl(path);

  if (!fileUrl) {
    throw new Error("This file is unavailable.");
  }

  const response = await fetch(fileUrl, { credentials: "include" });

  if (!response.ok) {
    throw new Error("The file could not be retrieved from the server.");
  }

  const blob = await response.blob();

  /*
   * A misconfigured path still answers 200 with the app shell rather than a 404, and an HTML blob
   * saved as "Birth-Certificate.pdf" looks like a corrupt download. Fail loudly instead, unless HTML
   * is genuinely what was asked for.
   */
  if (blob.type.startsWith("text/html") && !/\.html?$/i.test(fileName || fileUrl)) {
    throw new Error("The file could not be retrieved from the server.");
  }

  return blob;
}

/** Saves a stored file to the user's machine under its original name. */
export async function downloadBackendFile(path, fileName = "") {
  const blob = await fetchBackendFileBlob(path, fileName);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = fileName || decodeURIComponent(String(path).split("/").pop() || "") || "download";
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoked a tick later: Safari cancels the save if the object URL is released during the click.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
