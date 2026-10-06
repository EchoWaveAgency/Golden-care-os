-- Golden Care OS — base configuration seed (organization, branch, chart of accounts).
-- The chart of accounts below is a STARTER structure for review by Golden Care's accountant.
-- It is not a legal or tax determination.

insert into public.organizations (id, name_ar, name_en, tagline_ar, tagline_en)
values ('00000000-0000-4000-8000-000000000001', 'عيادات جولدن كير', 'Golden Care Clinics',
        'نرعاك لحياة أفضل', 'A place where beauty meets wellness')
on conflict (id) do nothing;

insert into public.branches (id, organization_id, code, name_ar, name_en, address_ar)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001',
        'SHR', 'فرع مدينة الشروق', 'El Shorouk Branch', 'مدينة الشروق، القاهرة')
on conflict (id) do nothing;

with org as (select '00000000-0000-4000-8000-000000000001'::uuid id)
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select org.id, c, ar, en, t::public.account_type, p from org, (values
  ('1000', 'الأصول',                        'Assets',                      'asset',     false),
  ('1100', 'النقدية بالخزينة',               'Cash on hand',                'asset',     true),
  ('1110', 'حساب البنك الرئيسي',             'Main bank account',           'asset',     true),
  ('1120', 'تحصيلات البطاقات تحت التسوية',    'Card settlements clearing',   'asset',     true),
  ('1130', 'تحصيلات إنستاباي تحت التسوية',    'InstaPay clearing',           'asset',     true),
  ('1140', 'تحصيلات المحافظ تحت التسوية',     'Mobile wallet clearing',      'asset',     true),
  ('1150', 'تحصيلات بوابة الدفع الإلكتروني تحت التسوية', 'Online payment gateway clearing', 'asset', true),
  ('1200', 'ذمم المرضى',                     'Patient receivables',         'asset',     true),
  ('1300', 'المخزون الطبي',                  'Medical inventory',           'asset',     true),
  ('2000', 'الالتزامات',                     'Liabilities',                 'liability', false),
  ('2100', 'الموردون',                       'Suppliers payable',           'liability', true),
  ('2200', 'دفعات مقدمة من المرضى',          'Patient advances',            'liability', true),
  ('2210', 'إيرادات باقات مؤجلة',            'Deferred package revenue',    'liability', true),
  ('2300', 'مستحقات الأطباء',                'Doctor fees payable',         'liability', true),
  ('2400', 'رواتب مستحقة',                   'Salaries payable',            'liability', true),
  ('3000', 'حقوق الملكية',                   'Equity',                      'equity',    false),
  ('3100', 'رأس المال',                      'Capital',                     'equity',    true),
  ('3200', 'أرباح مرحلة',                    'Retained earnings',           'equity',    true),
  ('4000', 'الإيرادات',                      'Revenue',                     'revenue',   false),
  ('4100', 'إيرادات الخدمات الطبية',          'Medical services revenue',    'revenue',   true),
  ('4110', 'إيرادات الليزر والتجميل',         'Laser & aesthetics revenue',  'revenue',   true),
  ('4120', 'إيرادات الأسنان',                 'Dental revenue',              'revenue',   true),
  ('4900', 'خصومات مسموح بها',               'Discounts allowed',           'revenue',   true),
  ('4910', 'مردودات ومبالغ مستردة للمرضى',    'Patient refunds (contra revenue)', 'revenue', true),
  ('4130', 'إيرادات باقات منتهية الصلاحية',     'Expired package revenue',     'revenue',   true),
  ('5000', 'المصروفات',                      'Expenses',                    'expense',   false),
  ('5100', 'أتعاب الأطباء',                  'Doctor fees',                 'expense',   true),
  ('5200', 'الرواتب والأجور',                'Salaries & wages',            'expense',   true),
  ('5300', 'مستهلكات طبية',                  'Medical consumables',         'expense',   true),
  ('5400', 'عمولات بنكية',                   'Bank charges',                'expense',   true),
  ('5500', 'تكاليف معامل الأسنان',             'Dental laboratory costs',     'expense',   true),
  ('5600', 'صيانة وإصلاح الأجهزة',              'Device maintenance and repair', 'expense',  true),
  ('5310', 'فروقات وتسويات المخزون',           'Inventory losses & adjustments', 'expense', true),
  ('5900', 'فروقات الخزينة',                 'Cash over/short',             'expense',   true)
) v(c, ar, en, t, p)
on conflict (organization_id, code) do nothing;

insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, k, a.id from public.accounts a join (values
  ('cash_on_hand', '1100'), ('bank_main', '1110'), ('card_clearing', '1120'),
  ('instapay_clearing', '1130'), ('wallet_clearing', '1140'), ('ar_patients', '1200'),
  ('patient_advances', '2200'), ('revenue_services', '4100'), ('discounts_allowed', '4900'),
  ('cash_over_short', '5900'), ('gateway_clearing', '1150'), ('refunds', '4910'),
  ('doctor_fees', '5100'), ('doctor_fees_payable', '2300'),
  ('inventory', '1300'), ('consumables_expense', '5300'), ('suppliers_payable', '2100'), ('inventory_adjustments', '5310'),
  ('package_deferred', '2210'), ('package_breakage', '4130'), ('lab_costs', '5500'), ('maintenance_expense', '5600')
) m(k, code) on m.code = a.code
where a.organization_id = '00000000-0000-4000-8000-000000000001'
on conflict do nothing;

insert into public.fiscal_periods (organization_id, name, period)
select '00000000-0000-4000-8000-000000000001', to_char(d, 'YYYY-MM'), daterange(d::date, (d + interval '1 month')::date)
from generate_series(date_trunc('year', now()), date_trunc('year', now()) + interval '11 months', interval '1 month') d
on conflict do nothing;
