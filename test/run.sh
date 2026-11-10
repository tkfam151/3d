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
