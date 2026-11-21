-- Golden Care — real website content (contact details + medical team), supplied by EchoWave on 2026-11-22.
-- Run once per environment by an administrator (SQL editor / psql). Safe to run again: nothing is duplicated.
--
-- What it does
--   1. Sets the clinic's public contact details (mobile/WhatsApp, Google Maps link, address, working hours).
--   2. Adds the doctors as staff records (name + specialty only) and creates a DRAFT website profile for each.
--      Profiles are NOT published here: they go through the normal CMS approval
--      (medical review → marketing review → publish) in /os, like every other website content.
--
-- Deliberately NOT included: doctors' personal phone numbers (the clinic's own number is the only public contact),
-- titles/degrees, biographies and photos — to be added in the CMS once the Medical Director approves them.
-- Not added (crossed out on the clinic's list): Dr. Dina (OB/GYN), Dr. Amr Saeed (plastic surgery).

begin;

-- 1. Contact details ---------------------------------------------------------------------------------------
update public.site_settings set value_ar = v.ar, value_en = v.en
from (values
  ('mobile',   '+201002028808', '+201002028808'),
  ('whatsapp', '+201002028808', '+201002028808'),
  ('map_url',  'https://maps.app.goo.gl/wduG44pwc3aJBwn59', 'https://maps.app.goo.gl/wduG44pwc3aJBwn59'),
  ('address',  'مدينة الشروق — تاون سنتر مول — الدور الثالث', 'Madinat El Shorouk — Town Center Mall — Third Floor'),
  ('hours',    'السبت إلى الخميس ١٠ صباحًا – ١٠ مساءً', 'Saturday–Thursday, 10 am – 10 pm')
) as v(key, ar, en)
where site_settings.key = v.key;

-- 2. Medical team ------------------------------------------------------------------------------------------
create temporary table gc_doctors (specialty_code text, slug text, name_ar text, name_en text, title_ar text, title_en text, sort_order int) on commit drop;
insert into gc_doctors values
  -- النساء والتوليد
  ('obgyn',     'dr-sobhy-heikal',      'د. صبحي هيكل',      'Dr. Sobhy Heikal',      null, null, 10),
  ('obgyn',     'dr-hesham-abo-el-ezz', 'د. هشام أبو العز',   'Dr. Hesham Abo El-Ezz', null, null, 11),
  ('obgyn',     'dr-mohamed-kouta',     'د. محمد قوطة',      'Dr. Mohamed Kouta',     null, null, 12),
  ('obgyn',     'dr-hamed-hegazy',      'د. حامد حجازي',     'Dr. Hamed Hegazy',      null, null, 13),
  ('obgyn',     'dr-rabab',             'د. رباب',           'Dr. Rabab',             null, null, 14),
  -- الجلدية والتجميل والليزر
  ('derm',      'dr-hala-shawky',       'د. هالة شوقي',      'Dr. Hala Shawky',       null, null, 20),
  ('derm',      'dr-maria',             'د. مارية',          'Dr. Maria',             null, null, 21),
  ('derm',      'dr-tahia',             'د. تحية',           'Dr. Tahia',             'الليزر', 'Laser', 22),
  ('derm',      'dr-tamam',             'د. تمام',           'Dr. Tamam',             'الليزر', 'Laser', 23),
  -- الأسنان
  ('dental',    'dr-ramy',              'د. رامي',           'Dr. Ramy',              null, null, 30),
  ('dental',    'dr-rawaa',             'د. رواء',           'Dr. Rawaa',             null, null, 31),
  ('dental',    'dr-amr-osmany',        'د. عمرو عثماني',    'Dr. Amr Osmany',        null, null, 32),
  ('dental',    'dr-youssef',           'د. يوسف',           'Dr. Youssef',           null, null, 33),
  -- الجراحة العامة
  ('gensurg',   'dr-tarek-el-beheiry',  'د. طارق البحيري',   'Dr. Tarek El-Beheiry',  null, null, 40),
  -- جراحة التجميل
  ('plastic',   'dr-abeer-el-sayad',    'د. عبير الصياد',    'Dr. Abeer El-Sayad',    null, null, 50),
  -- العظام
  ('ortho',     'dr-mohamed-salem',     'د. محمد سالم',      'Dr. Mohamed Salem',     null, null, 60),
  -- جراحة المخ والأعصاب
  ('neuro',     'dr-hossam-mahmoud',    'د. حسام محمود',     'Dr. Hossam Mahmoud',    null, null, 70),
  -- جراحة الأوعية الدموية
  ('vascular',  'dr-hossam-ibrahim',    'د. حسام إبراهيم',   'Dr. Hossam Ibrahim',    null, null, 80),
  -- الباطنة
  ('internal',  'dr-mohamed-kamal',     'د. محمد كمال',      'Dr. Mohamed Kamal',     null, null, 90),
  -- التغذية العلاجية
  ('nutrition', 'dr-karim-mokhtar',     'د. كريم مختار',     'Dr. Karim Mokhtar',     null, null, 100),
  ('nutrition', 'dr-hala-saleh',        'د. هالة صالح',      'Dr. Hala Saleh',        null, null, 101);

-- Staff record per doctor (skipped if a doctor with the same Arabic name and specialty already exists).
insert into public.staff (branch_id, kind, full_name_ar, full_name_en, specialty_id, title_ar, title_en)
select (select id from public.branches where is_active order by code limit 1),
       'doctor', g.name_ar, g.name_en, sp.id, g.title_ar, g.title_en
from gc_doctors g join public.specialties sp on sp.code = g.specialty_code
where not exists (select 1 from public.staff s where s.kind = 'doctor' and s.full_name_ar = g.name_ar and s.specialty_id = sp.id);

-- Draft website profile per doctor (skipped if the slug or the staff member already has one).
insert into public.site_doctor_profiles (staff_id, slug, title_ar, title_en, languages, accepts_online_booking, sort_order, status)
select s.id, g.slug, g.title_ar, g.title_en, array['ar'], true, g.sort_order, 'draft'
from gc_doctors g
join public.specialties sp on sp.code = g.specialty_code
join public.staff s on s.kind = 'doctor' and s.full_name_ar = g.name_ar and s.specialty_id = sp.id
where not exists (select 1 from public.site_doctor_profiles p where p.slug = g.slug or p.staff_id = s.id);

commit;
