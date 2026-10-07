-- 17 — E-invoice queue: off by default, blocked until codes and tax setup exist, connector primitives, returns and cancellations
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set b1      '00000000-0000-4000-8000-000000000101'
\set cons    '00000000-0000-4000-8000-000000004001'

insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'فاتورة', 'إلكترونية', '01088880041') returning id as pat \gset

-- Off: nothing is queued
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as inv0 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv0', :'cons', 500);
select public.issue_invoice(:'inv0') is not null as x \gset
reset role;
select test.assert((select count(*) = 0 from public.einvoice_documents), 'nothing queued while switched off');

-- On, but service codes and tax treatment missing → blocked with the reasons
set role authenticated;
select test.login(:'fd');
select test.expect_error($q$select public.save_einvoice_settings('{"enabled": true}')$q$, 'permission denied');
select test.login(:'chief');
select public.save_einvoice_settings('{"enabled": true, "taxpayer_rin": "123456789", "taxpayer_name": "Golden Care", "activity_code": "8620", "branch_code": "0", "pos_serial": "POS-1"}') is not null as x \gset
select test.expect_error($q$select public.save_einvoice_settings('{"taxpayer_rin": "12"}')$q$, 'check');
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as inv1 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price, discount) values (:'inv1', :'cons', 500, 50);
select invoice_no from public.issue_invoice(:'inv1') \gset
reset role;
select test.assert((select status = 'blocked' and block_reason like '%ETA code of DERM-CONS%' and block_reason like '%tax setup of DERM-CONS%' and kind = 'receipt'
                    from public.einvoice_documents where source_id = :'inv1'), 'blocked until the service has its ETA code and tax setup');

-- Accountant sets the codes (values here are test placeholders) and sends it again
set role authenticated;
select test.login(:'chief');
select public.set_service_tax(:'cons', '{"eta_item_type": "EGS", "eta_item_code": "EG-123456789-CONS", "tax_type": "T1", "tax_subtype": "V009", "tax_rate": 0}') is null as x \gset
select id as doc, status from public.einvoice_retry((select id from public.einvoice_documents where source_id = :'inv1')) \gset
select test.assert(:'status' = 'pending', 'ready to send');
select test.assert((select (payload->>'net_amount')::numeric = 450 and (payload->'lines'->0->>'item_code') = 'EG-123456789-CONS' and payload->>'doc_no' = :'invoice_no'
                    from public.einvoice_documents where id = :'doc'), 'payload from the issued invoice');
select test.expect_error($q$select public.svc_einvoice_claim(5)$q$, 'permission denied');
reset role;

-- Connector primitives: claim once, record the result, retry with backoff on errors
select test.assert((select count(*) = 1 from public.svc_einvoice_claim(5) where id = :'doc'), 'claimed for sending');
select test.assert((select count(*) = 0 from public.svc_einvoice_claim(5) where id = :'doc'), 'not claimed twice');
select public.svc_einvoice_result(:'doc', 'error', 'dev', null, null, null, 'timeout') is null as x \gset
select test.assert((select status = 'pending' and next_attempt_at > now() from public.einvoice_documents where id = :'doc'), 'error → retried later');
update public.einvoice_documents set next_attempt_at = now() where id = :'doc';
select test.assert((select count(*) = 1 from public.svc_einvoice_claim(5) where id = :'doc'), 'claimed again');
select public.svc_einvoice_result(:'doc', 'accepted', 'dev', 'SUB-1', 'UUID-1', 'LONG-1', null) is null as x \gset
select test.assert((select status = 'accepted' and document_uuid = 'UUID-1' from public.einvoice_documents where id = :'doc'), 'accepted with its ETA ids');

-- A refund paid on that invoice becomes a return document; voiding a reported invoice queues a cancellation
set role authenticated;
select test.login(:'cashier');
select public.record_payment(:'inv1', 450, 'card', 'ei-pay-1', 'POS-EI') is not null as x \gset
select test.login(:'fd');
select id as rf from public.request_refund(:'inv1', 100, 'card', 'خطأ في الخدمة') \gset
select test.login(:'chief');
select public.decide_refund(:'rf', true) is not null as x \gset
select test.login(:'cashier');
select public.pay_refund(:'rf', 'POS-RF-EI') is not null as x \gset
reset role;
select test.assert((select kind = 'return' and (payload->>'refund_amount')::numeric = 100 and (payload->>'total')::numeric = 100 and (payload->'lines'->0->>'net')::numeric = 100 and doc_no like '%-R' from public.einvoice_documents where source_id = :'rf'), 'refund reported as a return for the amount paid back');
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as inv2 \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv2', :'cons', 500);
select public.issue_invoice(:'inv2') is not null as x \gset
select test.login(:'chief');
select public.void_invoice(:'inv2', 'خطأ في الإصدار') is not null as x \gset
reset role;
select test.assert((select kind = 'cancellation' from public.einvoice_documents where source_type = 'invoice_void' and source_id = :'inv2'), 'void reported as a cancellation');
set role authenticated;
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.einvoice_documents), 'front desk does not see the tax queue');
select test.login(:'chief');
select public.save_einvoice_settings('{"enabled": false}') is not null as x \gset
reset role;

-- Receipt printing: the cashier reads the e-receipt id of an invoice without access to the tax queue
set role authenticated;
select test.login(:'cashier');
select test.assert((select document_uuid = 'UUID-1' from public.invoice_ereceipt(:'inv1')), 'cashier sees the e-receipt id on the receipt');
select test.assert((select count(*) = 0 from public.einvoice_documents), 'but not the tax queue');
reset role;
