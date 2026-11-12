"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WHATSAPP_URL } from "../../lib/contact";
import { DEMO_PATH, FEATURE_LINKS, LOGIN_PATH, MAIN_NAV, featurePath } from "../../lib/nav";
import { ButtonLink, cx } from "../ui";

/**
 * Site header. Every page opens on a dark band, so the header is always light-on-dark:
 * transparent over the hero, a frosted navy bar once the page scrolls.
 */
export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the menu on navigation (React's "adjust state on prop change" pattern).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) => (href === "/features" ? pathname === href : pathname.startsWith(href));

  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-500",
        scrolled || open
          ? "border-b border-white/[0.07] bg-navy-900/80 backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between gap-6 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link href="/" aria-label="FlexicaAI home" className="shrink-0 rounded-md">
          <Image src="/logo-dark.svg" alt="FlexicaAI" width={148} height={37} priority className="h-8 w-auto lg:h-9" />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {MAIN_NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={cx(
                    "rounded-full px-3.5 py-2 text-[0.9rem] font-medium transition-colors",
                    isActive(n.href) ? "text-white" : "text-slate-300 hover:text-white",
                  )}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/contact"
            className="hidden rounded-full px-3.5 py-2 text-[0.9rem] font-medium text-slate-300 transition-colors hover:text-white md:inline-flex"
          >
            Contact
          </Link>
          {/* Clinic staff come to the website to get into the app: one click, at every width. */}
          <ButtonLink href={LOGIN_PATH} tone="ghost-dark" className="min-h-10 px-4 py-2 text-[0.88rem] sm:px-5">
            Sign in
          </ButtonLink>
          <ButtonLink href={DEMO_PATH} className="hidden min-h-10 px-5 py-2 text-[0.88rem] sm:inline-flex">
            Book a demo
          </ButtonLink>
          <button
            ref={menuButton}
            type="button"
            className="grid size-11 place-items-center rounded-full text-white lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-menu" className="h-[calc(100dvh-4rem)] overflow-y-auto border-t border-white/[0.07] bg-navy-900 px-4 pb-10 pt-6 sm:px-6 lg:hidden">
          <nav aria-label="Mobile">
            <p className="eyebrow text-slate-500">Features</p>
            <ul className="mt-3 grid gap-1">
              {FEATURE_LINKS.map((f) => (
                <li key={f.slug}>
                  <Link href={featurePath(f.slug)} className="block rounded-xl px-3 py-3 text-lg font-medium text-white hover:bg-white/5">
                    {f.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="eyebrow mt-8 text-slate-500">Company</p>
            <ul className="mt-3 grid gap-1">
              {[
                { href: "/features", label: "All features" },
                { href: "/about", label: "About" },
                { href: "/contact", label: "Contact" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="block rounded-xl px-3 py-3 text-lg font-medium text-white hover:bg-white/5">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-8 grid gap-3">
            <ButtonLink href={DEMO_PATH} arrow>
              Book a personalised demo
            </ButtonLink>
            <ButtonLink href={WHATSAPP_URL} tone="ghost-dark">
              WhatsApp us
            </ButtonLink>
            <ButtonLink href={LOGIN_PATH} tone="ghost-dark">
              Sign in
            </ButtonLink>
          </div>
        </div>
      )}
    </header>
  );
}
