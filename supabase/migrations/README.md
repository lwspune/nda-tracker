# Schema migrations

The DDL history of the Supabase project, one file per migration, replayed in
filename order. Exported from the live project's `supabase_migrations.schema_migrations`
on 2026-09-13 — before that, the only copy of this database's shape was inside
the one Supabase project, which made a second deployment impossible to stand up.

**Append-only.** A new change is a new file, never an edit to an old one — the
old files describe what already ran, not what the schema should be.

## Naming

`<version>_<name>.sql`, where `version` is the `YYYYMMDDHHMMSS` stamp Supabase's
migration history uses. Files sort into apply order, so a new file must carry a
timestamp later than every existing one.

## Standing up a new project from these

```bash
supabase link --project-ref <new-project-ref>
supabase db push          # replays every file in order
```

This reproduces **schema only** — tables, columns, indexes, constraints, RLS
policies. It does NOT carry:

- **data** (seed via the app: branches → batches → teachers in Settings, then the
  student-import XLS),
- **auth users** (create the first admin in Supabase Auth; a superadmin needs
  `app_metadata.role = 'superadmin'`, never the self-editable `user_metadata`),
- **env vars** (see `CLAUDE.md` → Deployment; WhatsApp endpoints fail closed
  until their template IDs are set).

## Re-checking for drift

These files are only trustworthy while they still describe the live database. A
column added by hand through the dashboard or a raw `execute_sql` never enters
migration history — that is exactly how `quizzes.exam` / `.chapter` / `.theme`
came to be missing here, despite being written on every quiz save
(`20260913000000_quizzes_add_classification_columns.sql` is the repair).

To re-check, compare the live column set against these files:

```sql
select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name)
from information_schema.columns where table_schema = 'public';
```

Then diff that list against the columns these files create. Do the same for
`pg_policies` — a missing policy is a silent security hole in the new project
rather than an error.
