-- Meals had no filed-vs-silent record: an unmarked breakfast and a breakfast
-- where everyone showed up were both zero checkpoint_absences rows. Rolls
-- already had checkpoint_confirmations, but its count columns are NOT NULL and
-- a meal has no headcount to reconcile.
--
-- Rather than dropping NOT NULL outright (which would let a ROLL be written
-- without its reconciliation, silently defeating the gate), a `kind`
-- discriminator carries the difference and a CHECK keeps rolls strict.
alter table checkpoint_confirmations
  add column if not exists kind text not null default 'roll';

alter table checkpoint_confirmations
  alter column expected_count    drop not null,
  alter column exception_count   drop not null,
  alter column confirmed_present drop not null,
  alter column reconciled        drop not null;

alter table checkpoint_confirmations
  add constraint checkpoint_confirmations_kind_check
  check (kind in ('roll', 'meal'));

-- A roll must still carry its full reconciliation; a meal carries none.
alter table checkpoint_confirmations
  add constraint checkpoint_confirmations_roll_counts_check
  check (
    kind <> 'roll' or (
      expected_count    is not null and
      exception_count   is not null and
      confirmed_present is not null and
      reconciled        is not null
    )
  );

comment on column checkpoint_confirmations.kind is
  'roll = headcount reconciliation (counts required); meal = filed-vs-silent record only (counts NULL)';