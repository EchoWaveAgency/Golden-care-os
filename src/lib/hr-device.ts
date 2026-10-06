/** ZKTeco "ADMS" ATTLOG body: one punch per line, "PIN<TAB>YYYY-MM-DD HH:MM:SS<TAB>status…". Pure, unit-tested. */
export function parseAttlog(body: string): { biometric_id: string; at: string }[] {
  return (body ?? "").split(/\r?\n/).map((l) => l.split("\t")).filter((c) => c.length >= 2 && /^\d{1,12}$/.test(c[0].trim()) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(c[1].trim()))
    .map((c) => ({ biometric_id: c[0].trim().replace(/^0+(?=\d)/, ""), at: c[1].trim() }));
}

/** Optional allow-list of device IP addresses (ATTENDANCE_DEVICE_IPS="1.2.3.4,5.6.7.8"). Empty = any registered device. */
export function deviceIpAllowed(ip: string | null): boolean {
  const list = (process.env.ATTENDANCE_DEVICE_IPS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return list.length === 0 || (ip != null && list.includes(ip));
}
