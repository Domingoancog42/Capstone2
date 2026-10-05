#!/bin/sh
set -eu

port="${PORT:-8080}"
case "$port" in
  ''|*[!0-9]*)
    echo "PORT must be a number" >&2
    exit 1
    ;;
esac

mkdir -p /data/uploads /data/backups
chown -R www-data:www-data /data/uploads /data/backups

# Some Railway image restores have re-enabled a competing MPM after the build layer completed.
# Keep the runtime guard as well as the Dockerfile check: mod_php must run with prefork only.
for module_file in /etc/apache2/mods-enabled/mpm_event.* /etc/apache2/mods-enabled/mpm_worker.*; do
  [ ! -e "$module_file" ] || rm -f "$module_file"
done

sed "s/__PORT__/${port}/g" \
  /etc/apache2/sites-available/000-default.conf.template \
  > /etc/apache2/sites-available/000-default.conf
printf 'Listen %s\n' "$port" > /etc/apache2/ports.conf

exec "$@"
