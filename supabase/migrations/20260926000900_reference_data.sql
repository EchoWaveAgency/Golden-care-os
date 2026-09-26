-- Golden Care OS — 0009 Reference data: specialties, permissions, roles, payment methods
-- Safe defaults. Owners adjust role composition in the app; permission codes are stable.

insert into public.specialties (code, name_ar, name_en, sort_order) values
  ('derm',      'الجلدية والتجميل والليزر',        'Dermatology, Aesthetics & Laser', 10),
  ('dental',    'الأسنان والزراعة والتركيبات',       'Dentistry, Implants & Prosthodontics', 20),
  ('obgyn',     'النساء والتوليد',                  'Obstetrics & Gynecology', 30),
  ('ortho',     'العظام',                            'Orthopedics', 40),
  ('gensurg',   'الجراحة العامة',                    'General Surgery', 50),
  ('plastic',   'جراحة التجميل',                     'Plastic Surgery', 60),
  ('vascular',  'جراحة الأوعية الدموية',             'Vascular Surgery', 70),
  ('neuro',     'جراحة المخ والأعصاب',               'Neurosurgery', 80),
  ('internal',  'الباطنة',                           'Internal Medicine', 90),
  ('nutrition', 'التغذية العلاجية',                  'Clinical Nutrition', 100);

insert into public.permissions (code, module, description) values
  ('dashboard.executive', 'executive',   'Executive command center'),
  ('reports.read',        'reports',     'Operational reports'),
  ('reports.finance',     'reports',     'Financial reports'),
  ('settings.manage',     'admin',       'Manage branches, rooms, services, prices, schedules'),
  ('users.manage',        'admin',       'Manage users, staff and role grants'),
  ('staff.read',          'admin',       'Read staff directory with profile details'),
  ('audit.read',          'governance',  'Read the audit trail'),
  ('patient.read',        'patients',    'Read patient demographics in branch'),
  ('patient.read.assigned','patients',   'Read patients the user is treating'),
  ('patient.write',       'patients',    'Register and update patients'),
  ('patient.directory',   'patients',    'Minimal patient identification for billing'),
  ('appointment.read',    'scheduling',  'Read appointments in branch'),
  ('appointment.write',   'scheduling',  'Book, confirm, check-in, reschedule, cancel'),
  ('clinical.read',       'clinical',    'Read clinical records in branch'),
  ('clinical.write',      'clinical',    'Write clinical alerts/records in branch (nursing)'),
  ('clinical.write.own',  'clinical',    'Doctor: document and sign own encounters'),
  ('billing.read',        'billing',     'Read invoices and payments'),
  ('billing.write',       'billing',     'Create and issue invoices'),
  ('payment.collect',     'billing',     'Receive patient payments'),
  ('invoice.void',        'billing',     'Void issued unpaid invoices'),
  ('cash.session',        'billing',     'Open and close own cashier session'),
  ('cash.supervise',      'billing',     'Review and close any cashier session'),
  ('accounting.read',     'accounting',  'Read ledger, entries, trial balance'),
  ('accounting.post',     'accounting',  'Post and reverse manual journal entries'),
  ('accounting.configure','accounting',  'Chart of accounts, posting settings, periods'),
  ('accounting.close',    'accounting',  'Lock fiscal periods');

insert into public.roles (code, name_ar, name_en, is_privileged) values
  ('system_admin',      'مدير النظام',              'System Administrator', true),
  ('owner',             'الملاك / مجلس الإدارة',     'Owner / Board', true),
  ('center_director',   'مدير المركز',               'Center Director', true),
  ('operations_manager','مدير التشغيل',              'Operations Manager', true),
  ('medical_director',  'المدير الطبي',              'Medical Director', true),
  ('quality_manager',   'مدير الجودة والامتثال',     'Quality & Compliance Manager', true),
  ('doctor',            'طبيب',                      'Doctor', false),
  ('nurse',             'تمريض',                     'Nurse', false),
  ('medical_assistant', 'مساعد طبي',                 'Medical Assistant', false),
  ('front_desk',        'الاستقبال والخزينة',         'Front Desk & Cashier', false),
  ('patient_relations', 'خدمة وعلاقات المرضى',        'Patient Experience & Relations', false),
  ('chief_accountant',  'رئيس الحسابات',             'Chief Accountant', true),
  ('accountant',        'محاسب',                     'Accountant', false),
  ('cashier',           'أمين خزينة',                'Cashier', false),
  ('financial_auditor', 'مراجع مالي',                'Financial Auditor', true),
  ('hr_manager',        'مدير الموارد البشرية',       'HR Manager', true),
  ('inventory_controller','مراقب المخزون',           'Inventory Controller', false),
  ('security_auditor',  'مراجع أمن المعلومات',        'Security Auditor', true);

-- Role → permission defaults (deny by default; only what each job needs).
insert into public.role_permissions (role_code, permission_code)
select r, p from (values
  -- system admin: configuration and users, but NOT clinical content or posting
  ('system_admin', 'settings.manage'), ('system_admin', 'users.manage'), ('system_admin', 'staff.read'),
  ('system_admin', 'audit.read'),
  -- owners: oversight, no clinical notes
  ('owner', 'dashboard.executive'), ('owner', 'reports.read'), ('owner', 'reports.finance'),
  ('owner', 'audit.read'), ('owner', 'accounting.read'), ('owner', 'billing.read'),
  ('owner', 'patient.directory'), ('owner', 'appointment.read'), ('owner', 'staff.read'),
  ('center_director', 'dashboard.executive'), ('center_director', 'reports.read'), ('center_director', 'reports.finance'),
  ('center_director', 'settings.manage'), ('center_director', 'staff.read'), ('center_director', 'audit.read'),
  ('center_director', 'billing.read'), ('center_director', 'accounting.read'), ('center_director', 'appointment.read'),
  ('center_director', 'patient.read'), ('center_director', 'cash.supervise'), ('center_director', 'invoice.void'),
  ('operations_manager', 'dashboard.executive'), ('operations_manager', 'reports.read'), ('operations_manager', 'appointment.read'),
  ('operations_manager', 'appointment.write'), ('operations_manager', 'patient.read'), ('operations_manager', 'staff.read'),
  ('medical_director', 'dashboard.executive'), ('medical_director', 'reports.read'), ('medical_director', 'patient.read'),
  ('medical_director', 'clinical.read'), ('medical_director', 'appointment.read'), ('medical_director', 'staff.read'),
  ('quality_manager', 'reports.read'), ('quality_manager', 'audit.read'), ('quality_manager', 'patient.read'),
  ('quality_manager', 'clinical.read'), ('quality_manager', 'appointment.read'),
  -- medical team
  ('doctor', 'patient.read.assigned'), ('doctor', 'clinical.write.own'),
  ('nurse', 'patient.read'), ('nurse', 'clinical.read'), ('nurse', 'clinical.write'), ('nurse', 'appointment.read'),
  ('medical_assistant', 'patient.read'), ('medical_assistant', 'appointment.read'),
  -- front office
  ('front_desk', 'patient.read'), ('front_desk', 'patient.write'), ('front_desk', 'appointment.read'),
  ('front_desk', 'appointment.write'), ('front_desk', 'billing.read'), ('front_desk', 'billing.write'),
  ('front_desk', 'payment.collect'), ('front_desk', 'cash.session'),
  ('patient_relations', 'patient.read'), ('patient_relations', 'patient.write'),
  ('patient_relations', 'appointment.read'), ('patient_relations', 'appointment.write'),
  -- finance
  ('chief_accountant', 'accounting.read'), ('chief_accountant', 'accounting.post'), ('chief_accountant', 'accounting.configure'),
  ('chief_accountant', 'accounting.close'), ('chief_accountant', 'billing.read'), ('chief_accountant', 'patient.directory'),
  ('chief_accountant', 'invoice.void'), ('chief_accountant', 'cash.supervise'), ('chief_accountant', 'reports.finance'),
  ('accountant', 'accounting.read'), ('accountant', 'billing.read'), ('accountant', 'patient.directory'),
  ('accountant', 'reports.finance'),
  ('cashier', 'billing.read'), ('cashier', 'payment.collect'), ('cashier', 'cash.session'), ('cashier', 'patient.directory'),
  ('financial_auditor', 'accounting.read'), ('financial_auditor', 'billing.read'), ('financial_auditor', 'audit.read'),
  ('financial_auditor', 'patient.directory'), ('financial_auditor', 'reports.finance'),
  ('hr_manager', 'staff.read'),
  ('security_auditor', 'audit.read')
) v(r, p);

insert into public.payment_methods (code, name_ar, name_en, account_key, requires_reference, requires_cash_session) values
  ('cash',          'نقدي',              'Cash',            'cash_on_hand',      false, true),
  ('card',          'بطاقة بنكية',        'Bank card',       'card_clearing',     true,  false),
  ('instapay',      'إنستاباي',           'InstaPay',        'instapay_clearing', true,  false),
  ('wallet',        'محفظة إلكترونية',     'Mobile wallet',   'wallet_clearing',   true,  false),
  ('bank_transfer', 'تحويل بنكي',          'Bank transfer',   'bank_main',         true,  false);
