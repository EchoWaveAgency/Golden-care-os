import { requireAny } from "@/lib/session";
import { PageHeader } from "@/components/PageHeader";
import { PatientForm } from "./PatientForm";

export const metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  const { t, locale } = await requireAny("patient.write");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("patient.new")} />
      <PatientForm
        l={{
          firstAr: t("patient.firstAr"), lastAr: t("patient.lastAr"), firstEn: t("patient.firstEn"), lastEn: t("patient.lastEn"),
          phone: t("patient.phone"), nationalId: t("patient.nationalId"), dob: t("patient.dob"), sex: t("patient.sex"),
          female: t("patient.sex.female"), male: t("patient.sex.male"), unknown: t("patient.sex.unknown"),
          channel: t("patient.channel"), call: locale === "ar" ? "مكالمة" : "Call",
          duplicates: t("patient.duplicates"), duplicatesHint: t("patient.duplicatesHint"), registerAnyway: t("patient.registerAnyway"),
          open: locale === "ar" ? "فتح الملف" : "Open file", save: t("common.save"), cancel: t("common.cancel"), loading: t("common.loading"),
        }}
      />
    </div>
  );
}
