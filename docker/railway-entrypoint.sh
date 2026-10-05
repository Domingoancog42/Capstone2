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

sed "s/__PORT__/${port}/g" \
  /etc/apache2/sites-available/000-default.conf.template \
  > /etc/apache2/sites-available/000-default.conf
printf 'Listen %s\n' "$port" > /etc/apache2/ports.conf

exec "$@"
