"use client";
import { useEffect, useState } from "react";
import Script from "next/script";

type Ids = { ga4: string | null; meta: string | null; tiktok: string | null; ads: string | null };

// Analytics and advertising tags load ONLY after explicit consent. Nothing identifying is sent.
export function Consent({ ids, text, accept, reject }: { ids: Ids; text: string; accept: string; reject: string }) {
  const [state, setState] = useState<"unknown" | "granted" | "denied">("unknown");
  useEffect(() => {
    try {
      const v = localStorage.getItem("gc_consent");
      if (v === "granted" || v === "denied") setState(v);
    } catch { /* storage unavailable: keep asking, load nothing */ }
  }, []);
  const decide = (v: "granted" | "denied") => {
    setState(v);
    try { localStorage.setItem("gc_consent", v); } catch { /* ignore */ }
  };
  const anyIds = ids.ga4 || ids.meta || ids.tiktok || ids.ads;
  return (
    <>
      {state === "granted" && ids.ga4 && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ids.ga4}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ids.ga4}',{anonymize_ip:true});${ids.ads ? `gtag('config','${ids.ads}');` : ""}`}</Script>
        </>
      )}
      {state === "granted" && ids.meta && (
        <Script id="meta" strategy="afterInteractive">{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${ids.meta}');fbq('track','PageView');`}</Script>
      )}
      {state === "granted" && ids.tiktok && (
        <Script id="tiktok" strategy="afterInteractive">{`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${ids.tiktok}');ttq.page();}(window,document,'ttq');`}</Script>
      )}
      {state === "unknown" && anyIds && (
        <div role="dialog" aria-live="polite" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-2xl border border-ivory-300 bg-white p-4 shadow-card sm:flex sm:items-center sm:gap-4">
          <p className="flex-1 text-sm text-ink-500">{text}</p>
          <div className="mt-3 flex gap-2 sm:mt-0">
            <button onClick={() => decide("denied")} className="rounded-full px-4 py-2 text-sm text-ink-500 hover:bg-ivory-200">{reject}</button>
            <button onClick={() => decide("granted")} className="rounded-full bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-900">{accept}</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Conversion event helper: only fires if tags were loaded (i.e. consent was given). No personal data. */
export function trackConversion(name: "lead_submitted" | "booking_requested" | "whatsapp_click") {
  const w = window as unknown as { gtag?: (...a: unknown[]) => void; fbq?: (...a: unknown[]) => void; ttq?: { track: (n: string) => void } };
  w.gtag?.("event", name);
  w.fbq?.("track", name === "whatsapp_click" ? "Contact" : "Lead");
  w.ttq?.track(name === "whatsapp_click" ? "Contact" : "SubmitForm");
}
