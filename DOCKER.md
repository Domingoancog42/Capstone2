# Running the HRIS in Docker

This replaces XAMPP's Apache, PHP and MariaDB with containers. It does **not**
change how the application is addressed: the bundle is still at
`http://localhost/Capstone2/frontend/build/` and the API is still at
`http://localhost/Capstone2/frontend/backend/api/*.php`, because the project is
mounted one level below the container's document root exactly as it sits below
`htdocs`. Nothing in `.env`, `package.json` or any `.htaccess` needed
a Docker-specific value.

## Prerequisites

Docker Desktop for Windows. It is not installed on this machine yet:

```powershell
winget install --id Docker.DockerDesktop -e
```

That needs an administrator prompt, WSL2, and a reboot before `docker` works.

## Start it

**Stop XAMPP's Apache first** — both want port 80. (XAMPP's MySQL can keep
running; the container publishes 3307.)

```powershell
docker compose up -d --build
```

First run takes a few minutes: it builds the PHP image and imports
`frontend/backend/database/hris.sql` into a fresh MariaDB. The `app` container
waits for the database to report healthy, so the first request cannot land on a
half-imported schema.

| | URL | Notes |
|---|---|---|
| App | http://localhost/Capstone2/frontend/build/ | Run `npm run build` in `frontend/` if this 404s |
| API | http://localhost/Capstone2/frontend/backend/api/ | Same paths as XAMPP |
| phpMyAdmin | http://localhost:8080 | Server `db`, user `root`, password `hris` |
| MariaDB | `127.0.0.1:3307` | For HeidiSQL/Workbench; bound to this machine only |

```powershell
docker compose logs -f app     # Apache access log and PHP errors, together
docker compose down            # stop; the database survives
```

## Editing code

The whole project is bind-mounted live. Save a `.php` file and the next request
runs it — opcache is configured to re-stat on every request for that reason. No
rebuild, no restart. Uploads and backups written by the container land in the
real `frontend/backend/uploads/` and `frontend/backend/backups/` folders, so
they are still there if you go back to XAMPP.

Rebuild the image only after changing something under `docker/php/`:

```powershell
docker compose up -d --build app
```

### The React dev server

Simplest option: keep running `npm start` on Windows as before. With the
container on port 80, the `proxy` field in `package.json` points at it already
and nothing needs changing.

If you would rather not have Node installed locally:

```powershell
docker compose --profile dev up -d
```

That starts a `web` container on http://localhost:3000. It shares the `app`
container's network namespace, which is what lets CRA's
`"proxy": "http://localhost"` reach Apache without editing `package.json`. Hot
reload works but has to poll the Windows bind mount, so it is noticeably slower
and hungrier than running it natively.

## The database

The dump is imported **once**, when the `db-data` volume is first created.
Changing `hris.sql` afterwards does nothing on its own. To reload it from
scratch — this deletes all data in the container's database:

```powershell
docker compose down -v
docker compose up -d
```

To export the current state instead:

```powershell
docker compose exec db mariadb-dump -uroot -phris hris > frontend/backend/database/hris.sql
```

## Settings

Everything is overridable from a `.env` file next to `docker-compose.yml`;
Compose reads it automatically. The defaults:

| Name | Default | |
|---|---|---|
| `HRIS_HTTP_PORT` | `80` | Change if you want XAMPP's Apache running at the same time — then the app lives at `http://localhost:<port>/Capstone2/...` |
| `HRIS_DB_PASSWORD` | `hris` | Root password inside the container. Reaches PHP as `HRIS_DB_PASSWORD`, which `connection-pdo.php` reads |
| `HRIS_DB_PORT` | `3307` | Host-side port for the database |
| `HRIS_PMA_PORT` | `8080` | phpMyAdmin |
| `HRIS_DEV_PORT` | `3000` | Dev server, `--profile dev` only |
| `HRIS_DB_NAME` / `HRIS_DB_USER` | `hris` / `root` | |

`.env` files in this directory are denied over HTTP by the root `.htaccess`, as
is `docker-compose.yml` itself and everything under `docker/`.

## Known differences from XAMPP

PHP sessions live in the container's `/tmp`, so `docker compose down` (or a
rebuild of `app`) signs everyone out. Uploads, backups and database rows are
unaffected — those are on the bind mount and the `db-data` volume.

Mail still goes out over SMTP from `backend/api/smtp-credentials.local.php`,
unchanged; the container has outbound network access.

## What changed in the application

One file: `frontend/backend/api/connection-pdo.php` now reads `HRIS_DB_HOST`,
`HRIS_DB_USER`, `HRIS_DB_PASSWORD` and `HRIS_DB_NAME` from the environment,
falling back to the XAMPP literals (`127.0.0.1`, `root`, no password, `hris`)
when they are unset. Outside a container nothing sets them, so XAMPP behaves
exactly as it did.

## Notes on the image

`docker/php/Dockerfile` is `php:8.2-apache` — the same PHP version and the same
mod_php arrangement XAMPP uses, which matters because every `.htaccess` in this
project was written for it. On top of the base image it adds `pdo_mysql`, `zip`
(for the payslip and report ZIP exports) and opcache, and enables `mod_rewrite`.
GD is deliberately not installed: the upload paths move files, they never
re-encode an image. `AllowOverride All` in `docker/php/vhost.conf` is
load-bearing — Debian's default of `None` would silently ignore the deny lists
in `backend/api/.htaccess` and `backend/uploads/.htaccess`.
