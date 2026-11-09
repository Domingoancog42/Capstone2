/*
 * Builds a ready-to-upload copy of the HRIS for InfinityFree (or any shared PHP host).
 *
 *   npm run build:infinityfree                 -> C:\xampp\infinityfree-upload (beside htdocs)
 *   npm run build:infinityfree -- --out <dir>  -> somewhere else
 *   npm run build:infinityfree -- --with-uploads   also copy the files in backend/uploads
 *
 * The output's htdocs/ folder is what goes into the host's htdocs/:
 *   htdocs/                the React build, served from the site root
 *   htdocs/backend/api     the PHP API             (/backend/api/*.php)
 *   htdocs/backend/...     vendor, templates, uploads, backups
 *
 * Nothing here changes the normal XAMPP setup: .env, build/ and the source are only read. The
 * hosting-specific values are passed to react-scripts as environment variables, which win over .env
 * for this one build:
 *   PUBLIC_URL=/                          the app lives at the site root, so assets must be absolute
 *                                         or a refresh on /admin/dashboard would load a blank page
 *   REACT_APP_API_BASE_URL=/backend/api
 *   REACT_APP_LIVE_UPDATES_POLL_SECONDS   plain polling instead of a request parked for 25s
 *   REACT_APP_POLL_INTERVAL_SCALE         background timers at half the rate, for the daily hit cap
 *
 * The output is written outside htdocs on purpose: a copy of the API inside the web root is
 * executable over HTTP by anyone who guesses its URL.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const FRONTEND = path.resolve(__dirname, "..");
const MARKER = ".hris-infinityfree-upload";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // InfinityFree's per-file upload limit

function defaultOutDir() {
  // Beside the web root when there is one (C:\xampp\htdocs\... -> C:\xampp\infinityfree-upload).
  let dir = FRONTEND;
  while (path.dirname(dir) !== dir) {
    if (path.basename(dir).toLowerCase() === "htdocs") {
      return path.join(path.dirname(dir), "infinityfree-upload");
    }
    dir = path.dirname(dir);
  }
  return path.resolve(FRONTEND, "..", "..", "infinityfree-upload");
}

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const OUT = path.resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : defaultOutDir());
const WITH_UPLOADS = args.includes("--with-uploads");
const HTDOCS = path.join(OUT, "htdocs");
const REACT_BUILD = path.join(OUT, "_react-build");
const CONFIG_PATH = path.join(HTDOCS, "backend", "api", "server-config.local.php");

function fail(message) {
  console.error(`\n[build-infinityfree] ${message}`);
  process.exit(1);
}

// This script deletes OUT/htdocs before rebuilding it, so it only ever works in a folder it made.
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length > 0 && !fs.existsSync(path.join(OUT, MARKER))) {
  fail(`${OUT} already exists and was not created by this script. Choose an empty folder with --out.`);
}
if (OUT === FRONTEND || OUT.startsWith(FRONTEND + path.sep) || FRONTEND.startsWith(OUT + path.sep)) {
  fail(`--out must be outside the project (${FRONTEND}).`);
}

// A filled-in server config survives a rebuild; it is the one file the user edits by hand.
const savedConfig = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH) : null;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, MARKER), "Created by frontend/scripts/build-infinityfree.cjs\n");
fs.rmSync(HTDOCS, { recursive: true, force: true });
fs.rmSync(REACT_BUILD, { recursive: true, force: true });

console.log("[build-infinityfree] Building the React app for the site root...");
const build = spawnSync(
  process.execPath,
  [require.resolve("react-scripts/bin/react-scripts.js", { paths: [FRONTEND] }), "build"],
  {
    cwd: FRONTEND,
    stdio: "inherit",
    env: {
      ...process.env,
      BUILD_PATH: REACT_BUILD,
      PUBLIC_URL: "/",
      REACT_APP_API_BASE_URL: "/backend/api",
      REACT_APP_LIVE_UPDATES_POLL_SECONDS: "30",
      REACT_APP_POLL_INTERVAL_SCALE: "2",
      GENERATE_SOURCEMAP: "false",
      CI: "false",
    },
  }
);
if (build.status !== 0) {
  fail("react-scripts build failed; nothing was assembled.");
}
fs.renameSync(REACT_BUILD, HTDOCS);

const backendSrc = path.join(FRONTEND, "backend");
const backendOut = path.join(HTDOCS, "backend");

// The API. server-config.local.php is per-server, so a developer machine's copy never ships.
fs.cpSync(path.join(backendSrc, "api"), path.join(backendOut, "api"), {
  recursive: true,
  filter: (src) => path.basename(src) !== "server-config.local.php",
});

// PHPMailer. No Composer on the host, so the installed tree goes up as-is. On XAMPP the project's
// top-level .htaccess denies it; here that file does not exist, so vendor gets its own.
fs.cpSync(path.join(backendSrc, "vendor"), path.join(backendOut, "vendor"), { recursive: true });
fs.writeFileSync(
  path.join(backendOut, "vendor", ".htaccess"),
  "# PHP loads these files from disk; nothing in here should answer a request.\nRequire all denied\n"
);

fs.cpSync(path.join(backendSrc, "templates"), path.join(backendOut, "templates"), { recursive: true });

// Uploads: the folder layout and its .htaccess always; the files themselves only when asked, since
// they are employees' photos and documents.
fs.cpSync(path.join(backendSrc, "uploads"), path.join(backendOut, "uploads"), {
  recursive: true,
  filter: (src) => {
    if (WITH_UPLOADS || fs.statSync(src).isDirectory()) return true;
    return [".htaccess", ".gitkeep"].includes(path.basename(src));
  },
});

// Backups are written here by the app's backup feature; ship only the guard, never old dumps.
fs.mkdirSync(path.join(backendOut, "backups"), { recursive: true });
fs.copyFileSync(path.join(backendSrc, "backups", ".htaccess"), path.join(backendOut, "backups", ".htaccess"));

// password-reset-utils.php embeds the e-mail logo from ../../public/mgb-email.png relative to the API.
fs.mkdirSync(path.join(HTDOCS, "public"), { recursive: true });
fs.copyFileSync(path.join(FRONTEND, "public", "mgb-email.png"), path.join(HTDOCS, "public", "mgb-email.png"));

// The server config: the user's filled-in copy if there was one, otherwise the template to fill in.
if (savedConfig) {
  fs.writeFileSync(CONFIG_PATH, savedConfig);
} else {
  fs.copyFileSync(path.join(backendSrc, "api", "server-config.example.php"), CONFIG_PATH);
}

// The database dump, outside htdocs, for phpMyAdmin's Import tab.
const databaseDir = path.join(backendSrc, "database");
const dumps = fs.existsSync(databaseDir)
  ? fs.readdirSync(databaseDir)
      .filter((name) => name.toLowerCase().endsWith(".sql"))
      .map((name) => path.join(databaseDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  : [];
const preferredDump = path.join(databaseDir, "hris.sql");
const dump = fs.existsSync(preferredDump) ? preferredDump : dumps[0];
if (dump) {
  fs.mkdirSync(path.join(OUT, "database"), { recursive: true });
  fs.copyFileSync(dump, path.join(OUT, "database", "hris.sql"));
}

// Summary, and the per-file limit check.
let fileCount = 0;
let totalBytes = 0;
const oversized = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const size = fs.statSync(full).size;
    fileCount += 1;
    totalBytes += size;
    if (size > MAX_FILE_BYTES) oversized.push(`${path.relative(HTDOCS, full)} (${(size / 1048576).toFixed(1)} MB)`);
  }
})(HTDOCS);

console.log(`
[build-infinityfree] Done: ${OUT}
  htdocs/            ${fileCount} files, ${(totalBytes / 1048576).toFixed(1)} MB -> upload into InfinityFree's htdocs/
  database/hris.sql  ${dump ? `from ${path.basename(dump)} -> import with phpMyAdmin` : "NOT FOUND - export one from phpMyAdmin"}
  uploads            ${WITH_UPLOADS ? "included" : "folders only (add --with-uploads to include photos/documents)"}

Before uploading, fill in htdocs/backend/api/server-config.local.php with the database details
from InfinityFree's control panel.${savedConfig ? " (Kept your existing copy.)" : ""}`);

if (oversized.length > 0) {
  console.warn(`\nWARNING: over InfinityFree's 10 MB per-file limit:\n  ${oversized.join("\n  ")}`);
}
