-- 04 — Billing and double-entry accounting
\set fd      '00000000-0000-4000-8000-000000001002'
\set fd2     '00000000-0000-4000-8000-000000001009'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set dr      '00000000-0000-4000-8000-000000002004'
\set b1      '00000000-0000-4000-8000-000000000101'
\set org     '00000000-0000-4000-8000-000000000001'
\set cons    '00000000-0000-4000-8000-000000004001'
\set laser   '00000000-0000-4000-8000-000000004002'

set role authenticated;
select test.login(:'fd');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'هدى', 'فؤاد', '01055555555') returning id as pid \gset

-- Draft invoice: consultation 500 + laser 3000 with 300 discount → gross 3500, net 3200
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pid') returning id as inv \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price)
  values (:'inv', :'cons', :'dr', public.service_price(:'cons', :'b1'));
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price, discount)
  values (:'inv', :'laser', :'dr', public.service_price(:'laser', :'b1'), 300);
select test.assert((select subtotal = 3500 and discount_total = 300 and total = 3200 from public.invoices where id = :'inv'), 'totals recomputed from lines');

-- Discount cannot exceed the line
select test.expect_error(format($q$insert into public.invoice_lines (invoice_id, service_id, unit_price, discount) values (%L, %L, 100, 150)$q$, :'inv', :'cons'), 'discount_within_line');
-- Status cannot be forced by a direct update
select test.expect_error(format($q$update public.invoices set status = 'paid' where id = %L$q$, :'inv'), 'issue_invoice');

-- Issue → number assigned + balanced journal: Dr A/R 3200, Dr Discounts 300, Cr Revenue 500 (4100) + 3000 (4110)
select invoice_no, journal_entry_id as je from public.issue_invoice(:'inv') \gset
select test.assert(:'invoice_no' like 'INV-____-______', 'invoice number assigned at issue');

reset role;
select test.assert((select sum(debit) = sum(credit) and sum(debit) = 3500 from public.journal_lines where entry_id = :'je'), 'issue entry balanced at 3500');
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'je' and a.code = '1200') = 3200, 'A/R debited net');
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'je' and a.code = '4900') = 300, 'discount debited');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'je' and a.code = '4110') = 3000, 'laser revenue to its own account');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'je' and a.code = '4100') = 500, 'consultation to default revenue');
select test.assert((select count(*) from public.journal_lines where entry_id = :'je' and doctor_id = :'dr') = 2, 'revenue lines carry doctor for settlements');

-- Issued invoices are locked
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$insert into public.invoice_lines (invoice_id, service_id, unit_price) values (%L, %L, 1)$q$, :'inv', :'cons'), 'only change while the invoice is a draft');
update public.invoices set total = 1 where id = :'inv';   -- RLS: issued invoices are not updatable (0 rows)
select test.assert((select total from public.invoices where id = :'inv') = 3200, 'issued invoice total unchanged');

-- Cash needs an open cashier session
select test.expect_error(format($q$select public.record_payment(%L, 1000, 'cash', 'k-1')$q$, :'inv'), 'open a cashier session');
select id as sess from public.open_cashier_session(:'b1', 200) \gset
select test.expect_error(format($q$select public.open_cashier_session(%L, 0)$q$, :'b1'), 'already have an open cashier session');

-- Partial cash payment
select id as pay1, journal_entry_id as pje from public.record_payment(:'inv', 1000, 'cash', 'k-1') \gset
select test.assert((select status = 'partially_paid' and amount_paid = 1000 and balance = 2200 from public.invoices where id = :'inv'), 'partially paid');

-- Safe retry with the same idempotency key → same payment, no double posting
select test.assert((select id from public.record_payment(:'inv', 1000, 'cash', 'k-1')) = :'pay1', 'idempotent retry returns same payment');
select test.assert((select amount_paid from public.invoices where id = :'inv') = 1000, 'retry did not double count');
select test.expect_error(format($q$select public.record_payment(%L, 900, 'cash', 'k-1')$q$, :'inv'), 'idempotency key reused');

-- Card needs a reference; overpayment rejected
select test.expect_error(format($q$select public.record_payment(%L, 500, 'card', 'k-2')$q$, :'inv'), 'requires a reference');
select test.expect_error(format($q$select public.record_payment(%L, 5000, 'instapay', 'k-3', 'IP-1')$q$, :'inv'), 'exceeds outstanding');
select public.record_payment(:'inv', 2200, 'instapay', 'k-4', 'IP-778899');
select test.assert((select status = 'paid' and balance = 0 from public.invoices where id = :'inv'), 'fully paid');
select test.expect_error(format($q$select public.record_payment(%L, 1, 'cash', 'k-5')$q$, :'inv'), 'cannot receive payments');

-- Cash closing: expected = float 200 + cash 1000 = 1200. A difference needs a note.
select test.expect_error(format($q$select public.close_cashier_session(%L, 1150)$q$, :'sess'), 'note is required');
select test.assert((select difference from public.close_cashier_session(:'sess', 1150, 'short 50, investigating')) = -50, 'cash difference recorded');

-- Accountant: trial balance balances; A/R for this patient is zero
select test.login(:'chief');
select test.assert((select sum(debit) = sum(credit) from public.trial_balance(:'org', '2026-01-01', '2026-12-31')), 'trial balance debits = credits');
select test.assert((select coalesce(sum(debit - credit), 0) from public.journal_lines l join public.accounts a on a.id = l.account_id
                    where a.code = '1200' and l.patient_id = :'pid') = 0, 'patient receivable cleared');
select test.assert((select count(*) from public.patients) = 0, 'accountant still cannot read patient records');
-- Operational entries are reversed through the document, not manually
select test.expect_error(format($q$select public.reverse_journal_entry(%L, 'oops')$q$, :'je'), 'through their source document');

-- Void: issued unpaid invoice; the issuer cannot void their own invoice
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pid') returning id as inv2 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv2', :'cons', 500);
select journal_entry_id as je2 from public.issue_invoice(:'inv2') \gset
select test.expect_error(format($q$select public.void_invoice(%L, 'wrong patient')$q$, :'inv2'), 'permission denied');
select test.login(:'chief');
select test.expect_error(format($q$select public.void_invoice(%L, '')$q$, :'inv2'), 'reason is required');
select test.assert((select status from public.void_invoice(:'inv2', 'registered under wrong service')) = 'void', 'invoice voided');
reset role;
select test.assert((select status = 'reversed' and reversed_by is not null from public.journal_entries where id = :'je2'), 'issue entry reversed');
select test.assert((select sum(l.debit) - sum(l.credit) from public.journal_lines l join public.accounts a on a.id = l.account_id
                    join public.journal_entries e on e.id = l.entry_id where a.code = '1200' and e.source_id = :'inv2') = 0, 'void nets A/R to zero');

-- Separation of duties: an accountant who issued an invoice cannot void it
insert into public.user_roles (user_id, role_code, branch_id) values (:'chief', 'front_desk', :'b1');
set role authenticated;
select test.login(:'chief');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pid') returning id as inv3 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv3', :'cons', 500);
select public.issue_invoice(:'inv3');
select test.expect_error(format($q$select public.void_invoice(%L, 'test')$q$, :'inv3'), 'separation of duties');
reset role;
delete from public.user_roles where user_id = :'chief' and role_code = 'front_desk';

-- Ledger integrity (even for the database owner)
select test.expect_error(format('update public.journal_lines set debit = debit + 1 where entry_id = %L', :'je'), 'immutable');
select test.expect_error(format('delete from public.journal_lines where entry_id = %L', :'je'), 'immutable');
select test.expect_error(format('delete from public.journal_entries where id = %L', :'je'), 'cannot be deleted');
select test.expect_error(format($q$update public.journal_entries set description = 'x' where id = %L$q$, :'je'), 'immutable');

-- Unbalanced entries fail at commit
select test.expect_error(format($q$
  select app.post_journal(%L, null, current_date, 'bad', 'manual', null,
    jsonb_build_array(jsonb_build_object('account_id', (select id from public.accounts where code = '1100'), 'debit', 100),
                      jsonb_build_object('account_id', (select id from public.accounts where code = '3100'), 'credit', 90)));
  set constraints all immediate;$q$, :'org'), 'not balanced');

-- Header accounts cannot be posted to
select test.expect_error(format($q$
  select app.post_journal(%L, null, current_date, 'bad', 'manual', null,
    jsonb_build_array(jsonb_build_object('account_id', (select id from public.accounts where code = '1000'), 'debit', 100),
                      jsonb_build_object('account_id', (select id from public.accounts where code = '3100'), 'credit', 100)));$q$, :'org'), 'not postable');

-- Locked periods reject postings
update public.fiscal_periods set status = 'locked' where period @> date '2026-02-15';
select test.expect_error(format($q$
  select app.post_journal(%L, null, date '2026-02-15', 'late', 'manual', null,
    jsonb_build_array(jsonb_build_object('account_id', (select id from public.accounts where code = '1100'), 'debit', 100),
                      jsonb_build_object('account_id', (select id from public.accounts where code = '3100'), 'credit', 100)));$q$, :'org'), 'no open fiscal period');

-- Finance-facing roles cannot write ledger tables directly
set role authenticated;
select test.login(:'chief');
select test.expect_error(format($q$insert into public.journal_entries (organization_id, entry_date, description, source_type) values (%L, current_date, 'x', 'manual')$q$, :'org'), 'permission denied');
select test.expect_error($q$select app.post_journal(null, null, current_date, 'x', 'manual', null, '[]')$q$, 'permission denied');
reset role;
