// Simple line icons per specialty (original artwork).
const P: Record<string, string> = {
  derm: "M12 3c3 3 6 5.5 6 9.5A6 6 0 0 1 6 12.5C6 8.5 9 6 12 3Zm0 7v6m-3-3h6",
  dental: "M8 3c-2.5 0-4 2-4 4.5 0 3 1.5 4.5 2 7.5.4 3 1 6 2.5 6s1.5-4 3.5-4 2 4 3.5 4 2.1-3 2.5-6c.5-3 2-4.5 2-7.5C20 5 18.5 3 16 3c-1.8 0-2.6 1-4 1S9.8 3 8 3Z",
  obgyn: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Zm0-9v4m-2-2h4",
  ortho: "M7 4a2.5 2.5 0 0 0-2 4l9 9a2.5 2.5 0 1 0 3 3 2.5 2.5 0 1 0 1-4l-9-9a2.5 2.5 0 1 0-3-3Z",
  gensurg: "M4 20 15 9m0 0 5-5-2 7-3-2Zm-6 6-3 3",
  plastic: "M12 3a6 6 0 0 0-6 6v2c0 4 3 8 6 10 3-2 6-6 6-10V9a6 6 0 0 0-6-6Zm-2.5 8h.01m4.99 0h.01M10 15.5c1.2.8 2.8.8 4 0",
  vascular: "M12 3v6m0 0c-3 2-5 4-5 7a5 5 0 0 0 10 0c0-3-2-5-5-7Zm-2 7c-1 1-1 3 0 4",
  neuro: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V5a2 2 0 0 0-3-1Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0",
  internal: "M6 3v6a4 4 0 0 0 8 0V3M10 13v3a4 4 0 0 0 8 0v-2m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  nutrition: "M12 8c-4-3-8 0-8 5s3 8 5 8c1 0 2-.5 3-.5s2 .5 3 .5c2 0 5-3 5-8s-4-8-8-5Zm0 0c0-2 1-4 3-5",
};

export function SpecialtyIcon({ code, className = "h-7 w-7" }: { code: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[code] ?? "M12 4v16M4 12h16"} />
    </svg>
  );
}
