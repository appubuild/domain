import { Compass, Trophy } from 'lucide-react';
import { Seo } from '@/components/shared/Seo';
import { DemoRunner } from '@/components/shared/DemoRunner';
import { FIRST_RUN_DEEP_CUTS, FIRST_RUN_STEPS } from '@/lib/demo';

export default function DemoPage() {
  return (
    <>
      <Seo title="Guided demo — 20 steps from blank page to paid book" description="A clickable end-to-end tour of Scriptora: write, design, illustrate, format, validate, export, publish and sell. Every screen is live mock state." />
      <DemoRunner
        run="first-run"
        title="Scriptora in 20 steps"
        intro="This is the full first-run journey: discover the product, create a book, write and design it, export and publish it, then sell it and read a purchase in the built-in reader. Every button along the way changes real state."
        steps={FIRST_RUN_STEPS}
        signIn={{ role: 'user', label: 'Sign in as demo author' }}
        deepCuts={FIRST_RUN_DEEP_CUTS}
      />
      <div className="container pb-12">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <Trophy className="h-4 w-4 text-primary" />
          <span>Finish all 20 steps and you have touched every module: editor, AI, assets, export, preflight, publishing, marketplace, earnings, subscription and settings.</span>
          <span className="inline-flex items-center gap-1 text-primary"><Compass className="h-3 w-3" /> Admins: open the 15-step console flow from the admin sidebar.</span>
        </div>
      </div>
    </>
  );
}
