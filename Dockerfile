FROM composer:2 AS composer-dependencies

WORKDIR /app
COPY frontend/backend/composer.json frontend/backend/composer.lock ./
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-progress \
    --no-scripts \
    --prefer-dist \
    --optimize-autoloader

FROM php:8.2-apache

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        libcurl4-openssl-dev \
        libonig-dev \
        libpng-dev \
        libzip-dev; \
    docker-php-ext-install -j"$(nproc)" curl gd mbstring pdo_mysql zip; \
    docker-php-ext-enable opcache; \
    a2enmod headers rewrite; \
    rm -rf /var/lib/apt/lists/*

# mod_php requires prefork. Remove every competing MPM symlink explicitly because a2dismod can
# stop after the first already-disabled module and leave another one enabled on Debian upgrades.
RUN rm -f \
        /etc/apache2/mods-enabled/mpm_event.conf \
        /etc/apache2/mods-enabled/mpm_event.load \
        /etc/apache2/mods-enabled/mpm_worker.conf \
        /etc/apache2/mods-enabled/mpm_worker.load; \
    a2enmod mpm_prefork; \
    test "$(find /etc/apache2/mods-enabled -maxdepth 1 -name 'mpm_*.load' | wc -l)" -eq 1

COPY docker/aiven-project-ca.crt /usr/local/share/ca-certificates/aiven-project-ca.crt
RUN update-ca-certificates

COPY docker/php/php.ini /usr/local/etc/php/conf.d/zz-hris.ini
COPY docker/railway-vhost.conf /etc/apache2/sites-available/000-default.conf.template
COPY frontend/backend/ /var/www/html/
COPY --from=composer-dependencies /app/vendor/ /var/www/html/vendor/
# password-reset-utils.php embeds the e-mail logo from ../../public/, relative to api/.
COPY frontend/public/mgb-email.png /var/www/public/mgb-email.png

RUN set -eux; \
    rm -rf /var/www/html/uploads /var/www/html/backups; \
    ln -s /data/uploads /var/www/html/uploads; \
    ln -s /data/backups /var/www/html/backups; \
    chown -R www-data:www-data /var/www/html

COPY docker/railway-entrypoint.sh /usr/local/bin/railway-entrypoint
RUN chmod 0755 /usr/local/bin/railway-entrypoint

EXPOSE 8080
ENTRYPOINT ["railway-entrypoint"]
CMD ["apache2-foreground"]
