import type { Metadata } from "next";
import { GeneratorWorkspace } from "@/components/generator/generator-workspace";

export const metadata: Metadata = {
  title: "Domain generator",
  description:
    "Generate brandable domain candidates from root keywords with deterministic naming rules, industry dictionaries and explained quality and brandability scores.",
  alternates: { canonical: "/generator" },
};

export default function GeneratorPage() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6">
      <GeneratorWorkspace />
    </div>
  );
}
