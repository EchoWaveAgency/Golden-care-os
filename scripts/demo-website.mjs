// DEMO website content (synthetic). Created through the real approval workflow by signing in as the
// demo marketing user and the demo medical director. Replace with Golden Care's approved content.
import { createClient } from "@supabase/supabase-js";
import { elevate } from "./local/totp.mjs";

const SPECIALTIES = {
  derm: ["dermatology-laser", "الجلدية والتجميل والليزر", "Dermatology, Aesthetics & Laser",
    "تشخيص ومتابعة أمراض الجلد والشعر والأظافر، وجلسات الليزر والإجراءات التجميلية بعد تقييم طبي.",
    "Diagnosis and follow-up of skin, hair and nail conditions, plus laser sessions and aesthetic procedures after medical assessment.",
    "يبدأ طبيب الجلدية بكشف وتقييم لنوع البشرة والتاريخ المرضي، ثم يقترح الخطة المناسبة. تُجرى جلسات الليزر على جهاز مخصص وبإعدادات يحددها الطبيب لكل حالة.",
    "The dermatologist starts with an examination and skin-type assessment, then recommends a suitable plan. Laser sessions use a dedicated device with settings the doctor sets for each case.",
    "تجنّب التعرض المباشر للشمس قبل جلسة الليزر بأسبوعين، وأبلغ الطبيب بأي أدوية تستخدمها.",
    "Avoid direct sun exposure for two weeks before a laser session and tell the doctor about any medication you use.",
    [["هل أحتاج كشفًا قبل جلسة الليزر؟", "نعم، يحدد الطبيب مدى ملاءمة الجلسة وإعداداتها بعد الكشف.", "Do I need a consultation before laser?", "Yes. The doctor decides suitability and settings after examination."]]],
  dental: ["dentistry", "الأسنان والزراعة والتركيبات", "Dentistry, Implants & Prosthodontics",
    "علاج الأسنان والتجميل وزراعة الأسنان والتركيبات الثابتة والمتحركة.", "General and cosmetic dentistry, implants, and fixed and removable prosthodontics.",
    "خطة علاج مكتوبة لكل مريض مع مراحل واضحة وتكلفة معروفة قبل البدء، ومتابعة حالات المعمل حتى التسليم.",
    "A written treatment plan for every patient with clear stages and known cost before starting, and lab-case tracking until delivery.",
    "أحضر أي أشعة سابقة للأسنان إن وجدت.", "Bring any previous dental X-rays if available.",
    [["هل يمكن تقسيط خطة العلاج؟", "تُناقش خيارات السداد مع خطة العلاج المكتوبة.", "Can the treatment plan be paid in installments?", "Payment options are discussed with the written treatment plan."]]],
  obgyn: ["obstetrics-gynecology", "النساء والتوليد", "Obstetrics & Gynecology",
    "متابعة الحمل وصحة المرأة في بيئة تحترم الخصوصية.", "Pregnancy follow-up and women's health in a privacy-respecting environment.",
    "جدول متابعة واضح للحمل وسجل موحد للقياسات والفحوصات.", "A clear pregnancy follow-up schedule and one record of measurements and tests.",
    "أحضر نتائج أي تحاليل أو أشعة سابقة.", "Bring any previous test or scan results.", []],
  ortho: ["orthopedics", "العظام", "Orthopedics", "تشخيص وعلاج إصابات وأمراض العظام والمفاصل.", "Diagnosis and treatment of bone and joint injuries and conditions.", null, null, "أحضر الأشعة السابقة إن وجدت.", "Bring previous imaging if available.", []],
  gensurg: ["general-surgery", "الجراحة العامة", "General Surgery", "تقييم الحالات الجراحية والتحضير لها والمتابعة بعدها.", "Assessment, preparation and follow-up for surgical conditions.", null, null, null, null, []],
  plastic: ["plastic-surgery", "جراحة التجميل", "Plastic Surgery", "استشارات جراحة التجميل والترميم بعد تقييم طبي شامل.", "Plastic and reconstructive surgery consultations after a full medical assessment.", null, null, null, null, []],
  vascular: ["vascular-surgery", "جراحة الأوعية الدموية", "Vascular Surgery", "تشخيص وعلاج أمراض الأوردة والشرايين.", "Diagnosis and treatment of vein and artery conditions.", null, null, null, null, []],
  neuro: ["neurosurgery", "جراحة المخ والأعصاب", "Neurosurgery", "استشارات جراحة المخ والأعصاب والعمود الفقري.", "Brain, nerve and spine surgery consultations.", null, null, null, null, []],
  internal: ["internal-medicine", "الباطنة", "Internal Medicine", "تشخيص ومتابعة الأمراض الباطنية والمزمنة.", "Diagnosis and follow-up of internal and chronic conditions.", null, null, null, null, []],
  nutrition: ["clinical-nutrition", "التغذية العلاجية", "Clinical Nutrition", "خطط تغذية علاجية ومتابعة القياسات والأهداف.", "Clinical nutrition plans with measurement and goal tracking.", null, null, null, null, []],
};

export async function seedWebsite({ db, url, PASSWORD, BRANCH }) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const login = async (email) => {
    const c = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`${email}: ${error.message}`);
    // Clear any factor left by an interrupted earlier run (it would block enrollment).
    const { data: u } = await c.auth.getUser();
    const { data: old } = await db.auth.admin.mfa.listFactors({ userId: u.user.id });
    for (const f of old?.factors ?? []) await db.auth.admin.mfa.deleteFactor({ id: f.id, userId: u.user.id });
    // Privileged demo users must use two-factor sign-in: add a temporary factor for seeding,
    // removed at the end so the person trying the demo enrolls their own authenticator.
    cleanups.push(await elevate(c, "demo-seed"));
    return c;
  };
  const cleanups = [];
  try {
    const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
    const mkt = await login("marketing@demo.goldencare.local");
    const med = await login("meddir@demo.goldencare.local");
  
    // Website-visible services, and a weekly schedule for each demo doctor (Friday off).
    must(await db.from("services").update({ public_visible: true, public_show_price: true, online_bookable: true }).neq("code", ""), "services flags");
    const doctors = must(await db.from("staff").select("id, full_name_en, specialty_id").eq("kind", "doctor"), "doctors");
    for (const d of doctors) {
      const has = must(await db.from("doctor_schedules").select("id").eq("doctor_id", d.id), "sched");
      if (!has.length) must(await db.from("doctor_schedules").insert([0, 1, 2, 3, 4, 6].map((w) => ({ doctor_id: d.id, branch_id: BRANCH, weekday: w, start_time: "10:00", end_time: "18:00", slot_minutes: 30 }))), "schedule");
    }
    must(await db.from("site_settings").update({ value_ar: "السبت إلى الخميس ١٠ صباحًا – ١٠ مساءً", value_en: "Saturday–Thursday, 10 am – 10 pm" }).eq("key", "hours"), "hours");
  
    const publish = async (table, id, requiresMedical = true) => {
      if (requiresMedical) {
        must(await mkt.rpc("content_transition", { p_table: table, p_id: id, p_to: "medical_review" }), "to medical");
        must(await med.rpc("content_transition", { p_table: table, p_id: id, p_to: "marketing_review" }), "medical ok");
      }
      must(await mkt.rpc("content_transition", { p_table: table, p_id: id, p_to: "approved" }), "marketing ok");
      must(await mkt.rpc("content_transition", { p_table: table, p_id: id, p_to: "published" }), "publish");
    };
  
    const specs = must(await db.from("specialties").select("id, code, sort_order"), "specialties");
    const existing = must(await db.from("site_specialty_pages").select("specialty_id"), "pages").map((r) => r.specialty_id);
    for (const s of specs) {
      const d = SPECIALTIES[s.code];
      if (!d || existing.includes(s.id)) continue;
      const [slug, tar, ten, sar, sen, bar, ben, par, pen, faq] = d;
      const row = must(await mkt.from("site_specialty_pages").insert({
        specialty_id: s.id, slug, title_ar: tar, title_en: ten, summary_ar: sar, summary_en: sen, body_ar: bar, body_en: ben,
        preparation_ar: par, preparation_en: pen, sort_order: s.sort_order,
        faq: faq.map(([q_ar, a_ar, q_en, a_en]) => ({ q_ar, a_ar, q_en, a_en })),
      }).select("id").single(), `page ${slug}`);
      await publish("site_specialty_pages", row.id);
    }
  
    const profs = must(await db.from("site_doctor_profiles").select("staff_id"), "profiles").map((r) => r.staff_id);
    const bios = {
      "Dr. Sara Mansour": ["dr-sara-mansour", "أخصائي الجلدية والتجميل والليزر", "Dermatology, Aesthetics & Laser Specialist"],
      "Dr. Karim El-Sherif": ["dr-karim-el-sherif", "أخصائي طب وتجميل وزراعة الأسنان", "Cosmetic Dentistry & Implants Specialist"],
      "Dr. Hala Fawzy": ["dr-hala-fawzy", "أخصائي النساء والتوليد", "Obstetrics & Gynecology Specialist"],
    };
    for (const d of doctors) {
      const b = bios[d.full_name_en];
      if (!b || profs.includes(d.id)) continue;
      const row = must(await mkt.from("site_doctor_profiles").insert({
        staff_id: d.id, slug: b[0], title_ar: b[1], title_en: b[2],
        bio_ar: "ملف تعريفي تجريبي — يُستبدل بالسيرة المعتمدة من الطبيب.", bio_en: "Demo profile — to be replaced by the doctor's approved biography.",
        languages: ["ar", "en"], accepts_online_booking: true,
      }).select("id").single(), `profile ${b[0]}`);
      await publish("site_doctor_profiles", row.id);
    }
  
    const offers = must(await db.from("offers").select("id").eq("slug", "laser-underarm-launch"), "offers");
    if (!offers.length) {
      const svc = must(await db.from("services").select("id, specialty_id").eq("code", "LASER-AXILLA").single(), "svc");
      const now = new Date();
      const o = must(await mkt.from("offers").insert({
        slug: "laser-underarm-launch", branch_id: BRANCH, specialty_id: svc.specialty_id, service_id: svc.id,
        title_ar: "جلسة ليزر الإبط — عرض الافتتاح (تجريبي)", title_en: "Underarm laser session — opening offer (demo)",
        summary_ar: "سعر خاص لأول جلسة بعد الكشف وتحديد الملاءمة.", summary_en: "Special price for the first session after consultation and suitability check.",
        price: 700, regular_price: 900, starts_at: now.toISOString(), ends_at: new Date(now.getTime() + 30 * 86400000).toISOString(), capacity: 50,
        terms_ar: "للجلسة الأولى فقط. يتطلب كشفًا مسبقًا. غير قابل للتحويل. الإلغاء قبل الموعد بـ ٢٤ ساعة.",
        terms_en: "First session only. Requires prior consultation. Non-transferable. Cancel at least 24 hours before.",
        disclaimer_ar: "يحدد الطبيب مدى ملاءمة الجلسة بعد الكشف.", disclaimer_en: "Suitability is decided by the doctor after examination.",
      }).select("id").single(), "offer");
      await publish("offers", o.id);
  
      const derm = must(await db.from("specialties").select("id").eq("code", "derm").single(), "derm");
      const sara = doctors.find((d) => d.full_name_en === "Dr. Sara Mansour");
      const lp = must(await mkt.from("landing_pages").insert({
        slug: "laser-october", campaign_name: "Laser — October (demo)", specialty_id: derm.id, offer_id: o.id, doctor_ids: sara ? [sara.id] : [],
        title_ar: "ابدئي رحلة الليزر بثقة", title_en: "Start your laser journey with confidence",
        hero_ar: "كشف وتقييم لنوع البشرة قبل أي جلسة، وخطة واضحة يحددها الطبيب.", hero_en: "Skin assessment before any session, and a clear plan set by the doctor.",
        benefits: [{ ar: "كشف طبي قبل الجلسة", en: "Medical consultation before the session" }, { ar: "إعدادات يحددها الطبيب لكل حالة", en: "Settings chosen by the doctor for each case" }, { ar: "متابعة بعد الجلسة", en: "Follow-up after the session" }],
        cta_variant: "book", show_countdown: true, ends_at: new Date(now.getTime() + 30 * 86400000).toISOString(),
      }).select("id").single(), "landing");
      await publish("landing_pages", lp.id);
    }
  } finally {
    for (const done of cleanups) await done().catch(() => {});
  }
}
