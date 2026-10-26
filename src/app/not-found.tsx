import Link from "next/link";
import { ButtonLink } from "@/components/ui/primitives";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5 px-4 py-20 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">404</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">This page doesn’t exist</h1>
      <p className="max-w-xl text-[15px] leading-relaxed text-fg-muted">
        The link may be outdated, or the page may have moved. Try the generator, browse the
        industry directory, or search the blog.
      </p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/generator">Open the generator</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Back to home
        </ButtonLink>
      </div>
      <p className="text-xs text-fg-subtle">
        Looking for something specific?{" "}
        <Link href="/contact" className="underline hover:text-fg">
          Contact us
        </Link>
        .
      </p>
    </div>
  );
}
