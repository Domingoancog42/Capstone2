# XAMPP on this project runs PHP 8.2, and frontend/vendor/composer/platform_check.php
# refuses to autoload below 8.1, so the tag is pinned rather than left to float.
# The -apache variant is mod_php behind Apache, which is the same arrangement the
# .htaccess files in this tree were written for -- php-fpm would need every one of
# them rewritten.
FROM php:8.2-apache

# What the app actually needs on top of the base image:
#
#   pdo_mysql  every endpoint; connection-pdo.php is PDO-only, there is no mysqli
#              anywhere in backend/api
#   zip        ZipArchive, for the bulk payslip export (payslip.php) and the
#              report bundles (reports.php); both check class_exists() first and
#              degrade to an error message without it
#   opcache    not required, but the API is a few thousand lines of PHP recompiled
#              on every request otherwise
#   gd         captcha-utils.php draws the login captcha's digits into a PNG. This
#              is the one place in the project that writes an image rather than
#              merely moving one; the upload paths still only move files and read
#              getimagesize. libpng-dev is what gives the built extension its PNG
#              encoder -- no freetype, because the digits are drawn with GD's own
#              bitmap font rather than a TTF.
#
#              Leaving it out does not break the login screen: login_captcha_issue()
#              falls back to sending the digits as text, and every guarantee that
#              makes the captcha worth having -- server-held answer, single use,
#              expiry, attempt cap -- is unaffected. It is only the picture that is
#              lost, and with it the OCR an automated solver would otherwise need.
#
# mbstring, curl, openssl and fileinfo (mime_content_type in ipcr.php) are already
# compiled into the official image.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libzip-dev libpng-dev; \
    docker-php-ext-install -j"$(nproc)" pdo_mysql zip gd; \
    docker-php-ext-enable opcache; \
    apt-get purge -y --auto-remove; \
    rm -rf /var/lib/apt/lists/*

# The access-control story of this project lives entirely in .htaccess files -- the
# deny lists in backend/api/ and backend/uploads/, the RewriteRule in the root file
# that hides frontend/src and frontend/node_modules. None of it applies unless
# mod_rewrite is loaded and AllowOverride is All; see vhost.conf for the second
# half. Without both, the container would happily serve smtp-credentials.local.php.
RUN a2enmod rewrite headers

COPY php.ini /usr/local/etc/php/conf.d/zz-hris.ini
COPY vhost.conf /etc/apache2/sites-available/000-default.conf
