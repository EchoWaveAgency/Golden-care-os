-- 20 — Card / gateway settlements with fees; loyalty points (earn, redeem, refund, expiry); referrals
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set b1      '00000000-0000-4000-8000-000000000101'
\set cons    '00000000-0000-4000-8000-000000004001'

insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'نقاط', 'أولى', '01088880061') returning id as pa \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'نقاط', 'ثانية', '01088880062') returning id as pb \gset

-- ---------- Card settlement: bank receives gross − fees; fees to bank charges; never more than the uncleared balance
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.record_clearing_settlement(%L, 'card_clearing', current_date, 10, 0, 'X')$q$, :'b1'), 'permission denied');
select test.login(:'chief');
select balance as card_bal from public.clearing_balances(:'b1') where clearing_key = 'card_clearing' \gset
select test.assert(:'card_bal'::numeric > 100, 'card payments from earlier suites are waiting to be cleared');
select test.expect_error(format($q$select public.record_clearing_settlement(%L, 'card_clearing', current_date, %s, 0, 'BIG')$q$, :'b1', :'card_bal'::numeric + 1), 'more than the uncleared balance');
select test.expect_error(format($q$select public.record_clearing_settlement(%L, 'card_clearing', current_date, 100, 100, 'FEE')$q$, :'b1'), 'fees below it');
select journal_entry_id as cje, net from public.record_clearing_settlement(:'b1', 'card_clearing', current_date, 100, 2.5, 'POS-BATCH-1') \gset
select test.assert(:'net'::numeric = 97.5, 'net 97.50 deposited');
select test.expect_error(format($q$select public.record_clearing_settlement(%L, 'card_clearing', current_date, 10, 0, 'POS-BATCH-1')$q$, :'b1'), 'already recorded');
reset role;
select test.assert((select sum(debit) filter (where a.code = '1110') = 97.5 and sum(debit) filter (where a.code = '5400') = 2.5 and sum(credit) filter (where a.code = '1120') = 100
                    from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = :'cje'), 'Dr bank 97.50 + bank charges 2.50 / Cr card clearing 100');

-- ---------- Loyalty off by default: no points
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pa') returning id as i0 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'i0', :'cons', 100);
select public.issue_invoice(:'i0') is not null as x \gset
select test.login(:'cashier');
select public.record_payment(:'i0', 100, 'card', 'loy-0', 'POS-L0') is not null as x \gset
reset role;
select test.assert(app.loyalty_balance(:'pa') = 0, 'programme off: no points');

-- ---------- Switch on (values are test placeholders): 1 point per 10 EGP, a point = 0.50 EGP, min 20, up to 50% of an invoice, referral 100
set role authenticated;
select test.login(:'fd');
select test.expect_error($q$select public.save_loyalty_settings('{"enabled": true}')$q$, 'permission denied');
select test.login(:'chief');
select test.expect_error($q$select public.save_loyalty_settings('{"enabled": true}')$q$, 'before switching the programme on');
select public.save_loyalty_settings('{"enabled": true, "points_per_egp": 0.1, "egp_per_point": 0.5, "min_redeem_points": 20, "max_redeem_percent": 50, "expiry_months": 12, "referral_bonus_points": 100}') is not null as x \gset

-- Earn on payment
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pa') returning id as i1 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'i1', :'cons', 1000);
select public.issue_invoice(:'i1') is not null as x \gset
select test.login(:'cashier');
select public.record_payment(:'i1', 1000, 'card', 'loy-1', 'POS-L1') is not null as x \gset
reset role;
select test.assert(app.loyalty_balance(:'pa') = 100, '1,000 EGP paid → 100 points');

-- Referral: B registered with A's code; B's first payment earns B points and A the bonus (once)
set role authenticated;
select test.login(:'fd');
select public.patient_referral_code(:'pa') as code \gset
select test.expect_error(format($q$select public.set_referrer(%L, %L)$q$, :'pa', :'code'), 'cannot refer themselves');
select test.expect_error(format($q$select public.set_referrer(%L, 'GCNOPE1')$q$, :'pb'), 'referral code not found');
select public.set_referrer(:'pb', lower(:'code')) is not null as x \gset
select test.expect_error(format($q$select public.set_referrer(%L, %L)$q$, :'pb', :'code'), 'already recorded');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pb') returning id as i2 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'i2', :'cons', 400);
select public.issue_invoice(:'i2') is not null as x \gset
select test.login(:'cashier');
select public.record_payment(:'i2', 200, 'card', 'loy-2', 'POS-L2') is not null as x \gset
select public.record_payment(:'i2', 200, 'card', 'loy-3', 'POS-L3') is not null as x \gset
reset role;
select test.assert(app.loyalty_balance(:'pb') = 40 and app.loyalty_balance(:'pa') = 200, 'B earns 40; A gets the 100 referral bonus once');

-- Redeem at the desk: rules, then Dr loyalty redemptions / Cr receivable
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pa') returning id as i3 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'i3', :'cons', 100);
select public.issue_invoice(:'i3') is not null as x \gset
select test.login(:'cashier');
select test.expect_error(format($q$select public.record_payment(%L, 10, 'loyalty', 'x', null)$q$, :'i3'), 'their own button');
select test.expect_error(format($q$select public.redeem_loyalty(%L, 10, 'r0')$q$, :'i3'), 'at least 20 points');
select test.expect_error(format($q$select public.redeem_loyalty(%L, 500, 'r0')$q$, :'i3'), 'only 200 points');
select test.expect_error(format($q$select public.redeem_loyalty(%L, 120, 'r0')$q$, :'i3'), 'at most 50');
select id as lp, amount as lamt, journal_entry_id as lje from public.redeem_loyalty(:'i3', 100, 'r1') \gset
select test.assert(:'lamt'::numeric = 50, '100 points pay 50 EGP');
select test.assert((select id = :'lp' from public.redeem_loyalty(:'i3', 100, 'r1')), 'retry returns the same payment');
reset role;
select test.assert(app.loyalty_balance(:'pa') = 100, 'balance 200 − 100 = 100 (points payments earn nothing)');
select test.assert((select debit = 50 from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = :'lje' and a.code = '4920'), 'Dr loyalty redemptions 50');

-- A refund takes back the points it earned
set role authenticated;
select test.login(:'fd');
select id as rf from public.request_refund(:'i1', 300, 'card', 'استرداد جزئي') \gset
select test.login(:'chief');
select public.decide_refund(:'rf', true) is not null as x \gset
select test.login(:'cashier');
select public.pay_refund(:'rf', 'POS-RF-L') is not null as x \gset
reset role;
select test.assert(app.loyalty_balance(:'pa') = 70, 'refund of 300 takes back 30 points');

-- Staff and portal views; front desk without billing sees the balance through the function only
set role authenticated;
select test.login(:'cashier');
select test.assert(((public.patient_loyalty(:'pa'))->>'points')::int = 70 and ((public.patient_loyalty(:'pa'))->>'referrals')::int = 1, 'staff view: points and referrals');

-- Expiry after the inactivity period (run by the dispatcher job)
reset role;
insert into public.loyalty_entries (patient_id, kind, points, created_at) values (:'pb', 'adjust', 5, now() - interval '13 months');
select test.assert(app.loyalty_expire() = 0, 'recent activity: nothing expires');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'نقاط', 'قديمة', '01088880063') returning id as pc \gset
insert into public.loyalty_entries (patient_id, kind, points, created_at) values (:'pc', 'adjust', 30, now() - interval '13 months');
select test.assert(app.loyalty_expire() = 1, 'one inactive balance expired');
select test.assert(app.loyalty_balance(:'pc') = 0, 'inactive balance is now zero');
select test.expect_error($q$update public.loyalty_entries set points = 1$q$, 'cannot be deleted');
set role authenticated;
select test.login(:'chief');
select public.save_loyalty_settings('{"enabled": false}') is not null as x \gset
reset role;
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
