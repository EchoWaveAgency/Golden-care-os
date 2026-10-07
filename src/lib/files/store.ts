import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adminClient } from "@/lib/server/admin";

// Private object storage for patient files. The database decides who may read a file (patient_file_access /
// portal_file); this module only moves bytes for a path the database has just authorised.
// - "supabase" (default): private Supabase Storage bucket (FILES_BUCKET, default "patient-files").
// - "local": a folder on this machine, allowed only against the local development stack.
const isLocalStack = () => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
export function filesMode(): "supabase" | "local" {
  return process.env.FILES_MODE === "local" && isLocalStack() ? "local" : "supabase";
}
const bucket = () => process.env.FILES_BUCKET || "patient-files";
const localPath = (p: string) => {
  const root = path.join(process.cwd(), ".localfiles");
  const full = path.join(root, p);
  if (!full.startsWith(root + path.sep)) throw new Error("bad path");
  return full;
};

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export async function putFile(p: string, buf: Buffer, contentType: string) {
  if (filesMode() === "local") {
    const full = localPath(p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buf, { flag: "wx" });
    return;
  }
  const { error } = await adminClient().storage.from(bucket()).upload(p, buf, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

export async function getFile(p: string): Promise<Buffer> {
  if (filesMode() === "local") return readFile(localPath(p));
  const { data, error } = await adminClient().storage.from(bucket()).download(p);
  if (error || !data) throw new Error(error?.message ?? "file missing");
  return Buffer.from(await data.arrayBuffer());
}

// What the file really is (first bytes), so a renamed file cannot pass as a PDF or a photo.
export function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.subarray(4, 8).toString("latin1") === "ftyp" && /hei[cx]|mif1|msf1/.test(buf.subarray(8, 12).toString("latin1"))) return "image/heic";
  return null;
}
