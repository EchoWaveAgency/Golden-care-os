-- 08 — Refunds (maker-checker), online payment confirmation, user administration
\set fd      '00000000-0000-4000-8000-000000001002'
\set fd2     '00000000-0000-4000-8000-000000001009'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set admin   '00000000-0000-4000-8000-000000001001'
\set nobody  '00000000-0000-4000-8000-000000001008'
\set b1      '00000000-0000-4000-8000-000000000101'
\set cons    '00000000-0000-4000-8000-000000004001'
\set pu1     '00000000-0000-4000-8000-000000009001'
\set pu2     '00000000-0000-4000-8000-000000009002'
\set p1      '00000000-0000-4000-8000-000000008001'

grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;

-- A paid invoice (500) for patient p1 (who has a portal account from suite 07)
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'p1') returning id as inv \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv', :'cons', 500);
select public.issue_invoice(:'inv') is not null as issued \gset
select public.record_payment(:'inv', 500, 'instapay', 'k-08-1', 'IP-1') is not null as paid \gset
select test.assert((select status = 'paid' from public.invoices where id = :'inv'), 'invoice paid');

-- ---------- Refunds
select test.expect_error(format($q$select public.request_refund(%L, 100, 'cash', '')$q$, :'inv'), 'reason is required');
select test.expect_error(format($q$select public.request_refund(%L, 600, 'cash', 'خطأ في الخدمة')$q$, :'inv'), 'exceeds the refundable amount');
select id as rf from public.request_refund(:'inv', 200, 'cash', 'الجلسة لم تتم بالكامل') \gset
select test.expect_error(format($q$select public.request_refund(%L, 301, 'cash', 'طلب ثان')$q$, :'inv'), 'exceeds the refundable amount');   -- 200 already pending
-- The requester cannot approve; nobody without the permission can either
select test.expect_error(format($q$select public.decide_refund(%L, true)$q$, :'rf'), 'permission denied');
select test.login(:'cashier');
select test.expect_error(format($q$select public.pay_refund(%L)$q$, :'rf'), 'must be approved');
select test.login(:'chief');
select test.expect_error(format($q$select public.decide_refund(%L, false, '')$q$, :'rf'), 'note is required');
select public.decide_refund(:'rf', true, 'موافق') is not null as ok \gset
select test.expect_error(format($q$select public.decide_refund(%L, true)$q$, :'rf'), 'already approved');
-- Chief requests their own refund → cannot approve it themselves
reset role;
insert into public.user_roles (user_id, role_code, branch_id) values (:'chief', 'front_desk', :'b1');
set role authenticated;
select test.login(:'chief');
select id as rf_self from public.request_refund(:'inv', 50, 'instapay', 'تعويض انتظار') \gset
select test.expect_error(format($q$select public.decide_refund(%L, true)$q$, :'rf_self'), 'separation of duties');

-- Cash payout needs an open session; posts Dr 4910 / Cr 1100 and lowers expected cash
select test.login(:'cashier');
select test.expect_error(format($q$select public.pay_refund(%L)$q$, :'rf'), 'open a cashier session');
select id as sess from public.open_cashier_session(:'b1', 1000) \gset
select journal_entry_id as rje from public.pay_refund(:'rf') \gset
select test.assert((select status = 'paid' from public.refunds where id = :'rf'), 'refund paid');
select public.pay_refund(:'rf') is not null as retry \gset
reset role;
select test.assert((select count(*) = 1 from public.journal_entries where source_type = 'refund' and source_id = :'rf'), 'retry does not post twice');
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'rje' and a.code = '4910') = 200, 'Dr refunds 200');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'rje' and a.code = '1100') = 200, 'Cr cash 200');
select test.assert((select refunded_total = 200 from public.invoices where id = :'inv'), 'invoice refunded total');
set role authenticated;
select test.login(:'cashier');
select test.expect_error(format($q$select public.close_cashier_session(%L, 1000)$q$, :'sess'), 'expected (800');
select (public.close_cashier_session(:'sess', 800)).difference = 0 as balanced \gset
select test.assert(:'balanced', 'cash closing subtracts the refund');
-- Direct writes are impossible
select test.expect_error(format($q$update public.refunds set status = 'paid' where id = %L$q$, :'rf_self'), 'permission denied');
select test.expect_error($q$insert into public.refunds (invoice_id, branch_id, patient_id, amount, method, reason) select id, branch_id, patient_id, 1, 'cash', 'xxx' from public.invoices limit 1$q$, 'permission denied');

-- ---------- Online payment
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'p1') returning id as inv2 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv2', :'cons', 500);
select public.issue_invoice(:'inv2') is not null as issued2 \gset
-- staff cannot use the portal function; another patient cannot pay/see it
select test.expect_error(format($q$select public.portal_pay_invoice(%L)$q$, :'inv2'), 'not found');
select test.login(:'pu2');
select test.expect_error(format($q$select public.portal_pay_invoice(%L)$q$, :'inv2'), 'not found');
select test.login(:'pu1');
select (public.portal_pay_invoice(:'inv2'))->>'intent_id' as intent \gset
select test.assert((public.portal_pay_invoice(:'inv2'))->>'intent_id' = :'intent', 'open intent reused');
select test.assert((public.portal_payment_status(:'intent'))->>'status' = 'created', 'patient sees own intent status');
select test.assert((select (x->>'refunded')::numeric = 200 from jsonb_array_elements((public.portal_finance(:'p1'))->'invoices') x where x->>'id' = :'inv'), 'patient sees the refund on the invoice');
-- patients cannot confirm payments themselves
select test.expect_error(format($q$select public.svc_payment_confirm('paymob', 'o1', 't1', 50000, true)$q$), 'permission denied');
reset role;
set role service_role;
select public.svc_payment_intent_attach(:'intent', 'paymob', 'order-08-1');
select test.assert(public.svc_payment_confirm('paymob', 'nope', 't0', 50000, true) = 'unknown', 'unknown order ignored');
select test.assert(public.svc_payment_confirm('paymob', 'order-08-1', 't-fail', 50000, false, 'declined') = 'failed', 'declined recorded');
reset role;
update public.payment_intents set status = 'pending' where id = :'intent';   -- patient retries with the same order
set role service_role;
select test.assert(public.svc_payment_confirm('paymob', 'order-08-1', 't-ok', 50000, true) = 'paid', 'captured payment posted');
select test.assert(public.svc_payment_confirm('paymob', 'order-08-1', 't-ok', 50000, true) = 'paid', 'duplicate callback is harmless');
select test.assert(public.svc_payment_confirm('paymob', 'order-08-1', 't-second', 50000, true) = 'exception', 'second charge on a paid order is flagged');
select test.assert(public.svc_payment_confirm('paymob', 'no-such-order', 't-orphan', 20000, true) = 'unknown', 'orphan capture');
select test.assert(not public.svc_payment_intent_attach(:'intent', 'paymob', 'order-08-x'), 'a started intent cannot be re-attached');
reset role;
select test.assert((select status = 'paid' and amount_paid = 500 from public.invoices where id = :'inv2'), 'invoice paid online');
select test.assert((select count(*) = 1 from public.payments where invoice_id = :'inv2' and method = 'online' and received_by is null), 'one gateway payment');
select test.assert((select count(*) = 2 from public.payment_exceptions where txn_id in ('t-second', 't-orphan')), 'captured-but-unmatched money is recorded for finance');
select test.assert((select sum(l.debit) from public.journal_lines l join public.accounts a on a.id = l.account_id
                    join public.payments p on p.journal_entry_id = l.entry_id where p.invoice_id = :'inv2' and a.code = '1150') = 500, 'Dr gateway clearing');

-- Amount mismatch and paid-at-desk race go to review, never post
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'p1') returning id as inv3 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv3', :'cons', 500);
select public.issue_invoice(:'inv3') is not null as issued3 \gset
select test.login(:'pu1');
select (public.portal_pay_invoice(:'inv3'))->>'intent_id' as intent3 \gset
reset role;
set role service_role;
select public.svc_payment_intent_attach(:'intent3', 'paymob', 'order-08-3');
select test.assert(public.svc_payment_confirm('paymob', 'order-08-3', 't-3', 100, true) = 'review', 'amount mismatch → review');
reset role;
select test.assert((select amount_paid = 0 from public.invoices where id = :'inv3'), 'nothing posted on mismatch');

-- Staff can never record an "online" payment by hand
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.record_payment(%L, 10, 'online', 'k-08-online', 'x')$q$, :'inv3'), 'payment gateway only');
reset role;

-- ---------- User administration
set role authenticated;
select test.login(:'fd');
select test.expect_error($q$select public.admin_users()$q$, 'permission denied');
select test.login(:'admin');
select test.assert(jsonb_array_length(public.admin_users()) >= 9, 'admin lists users');
select test.expect_error(format($q$select public.admin_grant_role(%L, 'owner', null, null, 'x')$q$, :'admin'), 'your own roles');
select test.expect_error(format($q$select public.admin_grant_role(%L, 'cashier', %L, null, '')$q$, :'nobody', :'b1'), 'reason is required');
select public.admin_grant_role(:'nobody', 'cashier', :'b1', now() + interval '7 days', 'تغطية إجازة') as g \gset
select test.expect_error(format($q$select public.admin_grant_role(%L, 'cashier', %L, null, 'مكرر')$q$, :'nobody', :'b1'), 'already active');
select test.login(:'nobody');
select test.assert(app.has_permission('payment.collect', :'b1'), 'temporary delegation active');
select test.login(:'admin');
select public.admin_end_role(:'g', 'انتهت الإجازة');
select test.login(:'nobody');
select test.assert(not app.has_permission('payment.collect', :'b1'), 'ended grant no longer applies');
select test.login(:'admin');
select test.expect_error(format($q$select public.admin_set_active(%L, false, 'x')$q$, :'admin'), 'your own account');
select public.admin_set_active(:'fd2', false, 'ترك العمل');
select test.login(:'fd2');
select test.assert(not app.has_permission('patient.read'), 'deactivated user loses every permission');
select test.login(:'admin');
select public.admin_set_active(:'fd2', true, 'عاد للعمل');
reset role;
select test.assert((select count(*) = 1 from public.user_roles where id = :'g'), 'grants are ended, never deleted');
select test.assert((select count(*) >= 2 from public.audit_events where action in ('USER_DEACTIVATED', 'USER_REACTIVATED')), 'activation changes audited');
set role authenticated;
select test.login(:'admin');
select test.expect_error(format($q$select public.svc_admin_profile(%L, %L, 'x', 'y')$q$, :'admin', :'nobody'), 'permission denied');
select test.expect_error($q$select public.me_password_changed()$q$, 'does not exist');
select test.expect_error(format($q$select public.svc_password_changed(%L)$q$, :'admin'), 'permission denied');
-- A branch-scoped administrator: own branch, non-privileged roles only
reset role;
insert into public.user_roles (user_id, role_code, branch_id) values (:'fd2', 'system_admin', :'b1');
set role authenticated;
select test.login(:'fd2');
select test.expect_error(format($q$select public.admin_grant_role(%L, 'owner', %L, null, 'x')$q$, :'nobody', :'b1'), 'privileged');
select test.expect_error(format($q$select public.admin_grant_role(%L, 'cashier', null, null, 'x')$q$, :'nobody'), 'all-branch');
select test.expect_error(format($q$select public.admin_grant_role(%L, 'cashier', '00000000-0000-4000-8000-000000000102', null, 'x')$q$, :'nobody'), 'permission denied');
select test.expect_error(format($q$select public.admin_set_active(%L, false, 'x')$q$, :'admin'), 'all-branch');
select public.admin_grant_role(:'nobody', 'cashier', :'b1', null, 'تغطية فرع') is not null as branch_grant \gset
reset role;
