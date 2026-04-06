import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
];

export default function MarketingFooter() {
  return (
    <footer className="py-12 border-t border-border relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="font-serif font-bold text-foreground">Jarble</span>
          </Link>
          <nav className="flex flex-wrap justify-center gap-x-8 gap-y-2">
            {FOOTER_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                {label}
              </Link>
            ))}
            <span className="text-muted-foreground/50 cursor-default" title="Coming soon">
              Contact
            </span>
          </nav>
        </div>
        <div className="mt-8 pt-8 border-t border-border text-center text-muted-foreground text-sm">
          <p>&copy; 2026 Jarble. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
