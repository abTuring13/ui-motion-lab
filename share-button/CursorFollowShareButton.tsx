"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * White pill with a black orb that trails the pointer on a spring.
 * The label uses difference blending, so it stays readable over the orb.
 * Click: the orb opens into a circle that fills the button, and the link is copied.
 * React + Tailwind port of share-button/index.html.
 */
type Spring = { x: number; v: number; t: number; k: number; c: number };
const spring = (x: number, k: number, c: number): Spring => ({ x, v: 0, t: x, k, c });

export function CursorFollowShareButton({ url }: { url?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const orb = useRef<HTMLSpanElement>(null);
  const icon = useRef<SVGSVGElement>(null);
  const s = useRef({ X: spring(112, 320, 30), Y: spring(32, 320, 30), S: spring(0, 420, 32) });
  const hovering = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const n = Math.max(1, Math.ceil(dt * 240));
      for (const sp of Object.values(s.current)) {
        if (reduce) { sp.x = sp.t; sp.v = 0; continue; }
        for (let i = 0; i < n; i++) { sp.v += (-sp.k * (sp.x - sp.t) - sp.c * sp.v) * (dt / n); sp.x += sp.v * (dt / n); }
      }
      const { X, Y, S } = s.current;
      if (orb.current) orb.current.style.transform = `translate(${X.x}px, ${Y.x - 12}px) scale(${Math.max(0, S.x)})`;
      if (icon.current) icon.current.style.opacity = String(Math.max(0, 1 - (S.x - 1) * 1.5));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer.current); };
  }, []);

  const local = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const onEnter = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const [x, y] = local(e);
    const { X, Y, S } = s.current;
    X.x = X.t = x; Y.x = Y.t = y; X.v = Y.v = 0;
    hovering.current = true; setHover(true);
    if (!copied) S.t = 1;
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const [x, y] = local(e);
    s.current.X.t = x; s.current.Y.t = y;
  };
  const onLeave = () => {
    hovering.current = false; setHover(false);
    if (!copied) s.current.S.t = 0;
  };

  const onClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = btn.current!;
    const { X, Y, S } = s.current;
    if (e.detail === 0) { X.t = el.offsetWidth / 2; Y.t = el.offsetHeight / 2; }
    const w = el.offsetWidth, h = el.offsetHeight;
    const far = Math.max(Math.hypot(X.t, Y.t), Math.hypot(w - X.t, Y.t), Math.hypot(X.t, h - Y.t), Math.hypot(w - X.t, h - Y.t));
    S.t = (far + 4) / 20;
    setCopied(true);
    try { await navigator.clipboard.writeText(url ?? location.href.split("#")[0]); } catch { /* feedback still plays */ }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setCopied(false); S.t = hovering.current ? 1 : 0; }, 1700);
  };

  const roll = "col-start-1 row-start-1 whitespace-nowrap leading-6 [transition:transform_.45s_cubic-bezier(.2,.9,.3,1),opacity_.2s_ease]";

  return (
    <button
      ref={btn}
      type="button"
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onClick={onClick}
      aria-label={copied ? "Link copied" : undefined}
      className="relative isolate grid h-16 w-[min(224px,calc(100vw-40px))] cursor-pointer place-items-center overflow-hidden rounded-full border-0 bg-white p-0 font-[Geist,ui-sans-serif,system-ui,sans-serif] text-[18px] font-medium tracking-[-0.02em] text-[#111] shadow-[0_1px_2px_rgba(0,0,0,.2),0_18px_40px_-20px_rgba(255,255,255,.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-white"
    >
      <span ref={orb} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-0 -ml-5 -mt-5 grid size-10 scale-0 place-items-center rounded-full bg-[#111] text-white">
        <svg ref={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]">
          <path d="M21 3 10.5 13.5" /><path d="M21 3 14.5 21l-4-7.5L3 9.5z" />
        </svg>
      </span>
      <span className={`pointer-events-none relative z-10 col-start-1 row-start-1 grid h-6 overflow-hidden text-white mix-blend-difference [transition:opacity_.12s_ease] ${copied ? "opacity-0" : ""}`}>
        <span className={`${roll} ${hover ? "-translate-y-[110%] opacity-0" : ""}`}>Share it now</span>
        <span aria-hidden="true" className={`${roll} ${hover ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0"}`}>Share it now</span>
      </span>
      <span aria-hidden="true" className={`pointer-events-none relative z-10 col-start-1 row-start-1 flex items-center gap-2 text-white mix-blend-difference [transition:opacity_.2s_ease,transform_.35s_cubic-bezier(.2,.9,.3,1),filter_.2s_ease] ${copied ? "translate-y-0 opacity-100 blur-0 delay-75" : "translate-y-2 opacity-0 blur-[4px]"}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        Link copied
      </span>
    </button>
  );
}
