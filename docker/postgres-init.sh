#!/bin/sh
set -eu
# Only the isolated development Compose cluster runs this initialization.
psql --username "$POSTGRES_USER" --dbname xelen_dev --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password APP_DATABASE_PASSWORD
CREATE ROLE xelen_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';
REVOKE ALL ON DATABASE xelen_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE xelen_dev TO xelen_app;
CREATE DATABASE xelen_test;
REVOKE ALL ON DATABASE xelen_test FROM PUBLIC;
GRANT CONNECT ON DATABASE xelen_test TO xelen_app;
SQL
