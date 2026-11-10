#!/usr/bin/env bash
# Runs supabase/setup.sql + test/flow.sql against a throwaway local Postgres.
# Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres test/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="pd_test_$$"
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database $DB"
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
$P -d "$DB" -f test/supabase-stub.sql
$P -d "$DB" -f supabase/setup.sql 2>/dev/null
$P -d "$DB" -f supabase/setup.sql 2>/dev/null   # must be safe to run twice
$P -d "$DB" -f test/flow.sql

# Accounts created before setup.sql ran → the earliest one becomes owner.
DB2="${DB}_b"
trap '$P -d postgres -c "drop database if exists $DB" -c "drop database if exists $DB2" >/dev/null' EXIT
$P -d postgres -c "create database $DB2"
$P -d "$DB2" -f test/supabase-stub.sql
$P -d "$DB2" -c "insert into auth.users (email) values ('Tonkla@school.org'); insert into auth.users (email) values ('later@school.org');"
$P -d "$DB2" -f supabase/setup.sql 2>/dev/null
$P -d "$DB2" -f test/bootstrap.sql
