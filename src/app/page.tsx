import Link from "next/link";
import type { ReactNode } from "react";
import { FrameworkBar, HeroMap, OpenFolder, UnresolvedImport } from "@/components/landing/figures";
import { ThemeControl } from "@/components/theme/theme-control";
import { FRAMEWORKS, ROLES, type FrameworkId } from "@/parser/taxonomy";

// The signed-out front door. The proxy sends anyone signed in on to their
// workspace (or to pick an organization), so this page never reads the
// session and prerenders whole.

const COLUMN = "mx-auto w-full max-w-[1188px] px-6";
const H2 = "text-[clamp(1.875rem,3.4vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance";

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Section labelledBy="what-heading">
          <WhatItDoes />
        </Section>
        <Section labelledBy="how-heading">
          <HowItWorks />
        </Section>
        <Section labelledBy="frameworks-heading">
          <Frameworks />
        </Section>
        <Section labelledBy="refusals-heading">
          <WhatItWontDo />
        </Section>
      </main>
      <Footer />
    </div>
  );
}

function Mark() {
  return (
    <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-xs text-accent-fg">
      C
    </span>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
      <div className={`${COLUMN} flex h-14 items-center justify-between gap-4`}>
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Mark />
          Cartograph
        </Link>
        <div className="flex items-center gap-3">
          <ThemeControl />
          <Link
            href="/sign-in"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-fg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Sections after the hero: one hairline above, the same generous padding each. */
function Section({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <section aria-labelledby={labelledBy} className={COLUMN}>
      <div className="border-t border-border py-24 sm:py-32">{children}</div>
    </section>
  );
}

/** A drawing on the canvas's dot grid, framed the way the map pane is. */
function Figure({ children }: { children: ReactNode }) {
  return <figure className="overflow-hidden rounded-xl border border-border bg-bg">{children}</figure>;
}

function Hero() {
  return (
    <section aria-labelledby="hero-heading" className={`${COLUMN} flex min-h-[calc(100svh-3.5rem)] items-center py-16`}>
      <div className="grid w-full items-center gap-x-20 gap-y-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <h1 id="hero-heading" className="text-[clamp(2.5rem,5.6vw,4.5rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-balance">
            See how a codebase fits together before you read it.
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-fg-muted">
            Paste a public GitHub repository. Cartograph parses every import and draws the folders as boxes and the
            imports as lines between them.
          </p>
          <HeroForm />
        </div>
        <Figure>
          <HeroMap />
        </Figure>
      </div>
    </section>
  );
}

// A plain GET form, so it works before any script loads. /start carries the
// URL through sign-in and on to the workspace, where it's submitted.
function HeroForm() {
  return (
    <form action="/start" method="get" className="mt-10 flex max-w-[34rem] flex-col gap-2">
      <label htmlFor="hero-repository" className="text-sm font-medium">
        Public GitHub repository
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="hero-repository"
          name="repo"
          type="text"
          inputMode="url"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repository"
          aria-describedby="hero-repository-hint"
          className="h-12 min-w-0 flex-1 rounded-md border border-border bg-surface px-3.5 font-mono text-sm text-fg outline-none placeholder:font-sans placeholder:text-fg-muted/70 focus:border-accent focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="h-12 rounded-md bg-accent px-5 font-medium text-accent-fg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Map it
        </button>
      </div>
      <p id="hero-repository-hint" className="text-sm text-fg-muted">
        TypeScript or JavaScript. You&apos;ll sign in first, then the map starts.
      </p>
    </form>
  );
}

function WhatItDoes() {
  return (
    <div className="grid items-center gap-x-20 gap-y-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div>
        <h2 id="what-heading" className={H2}>
          Start at the folders. Open only what you need.
        </h2>
        <div className="mt-6 max-w-[46ch] space-y-4 leading-relaxed text-fg-muted">
          <p>
            A whole repository drawn file by file is unreadable, so the map starts folded: one box per folder, one line
            for the imports between each pair.
          </p>
          <p>
            Open a folder and its files become rows. Select one and the lines take sides: green from the files that
            import it, amber to the files it imports. Beside the map, you see what would break two levels out if it
            changed.
          </p>
          <p>Ask a question and the answer is looked up in the same graph, so every file it names is one that exists.</p>
        </div>
      </div>
      <Figure>
        <OpenFolder />
      </Figure>
    </div>
  );
}

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: "Paste a link",
    body: "Any public GitHub repository. Requests to GitHub are anonymous, so there's no token to grant.",
  },
  {
    title: "The parser reads it",
    body: "ts-morph resolves each import the way the compiler would, tsconfig paths included. Progress streams in as it goes.",
  },
  {
    title: "The map is drawn",
    body: "Folders, files and imports, laid out left to right. The result is stored, so coming back doesn't parse it again.",
  },
  {
    title: "Ask about it",
    body: "An agent answers by querying the map: searching paths, walking what depends on what, reading the route table.",
  },
];

function HowItWorks() {
  return (
    <>
      <h2 id="how-heading" className={`${H2} max-w-[22ch]`}>
        From a URL to a map, in four steps.
      </h2>
      <ol className="mt-16 grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span className="block text-sm font-medium text-accent tabular-nums">{i + 1}</span>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">{step.title}</h3>
            <p className="mt-2 max-w-[34ch] leading-relaxed text-fg-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

const FRAMEWORK_ORDER: readonly FrameworkId[] = ["nextjs", "nestjs", "express", "react", "none"];

function Frameworks() {
  return (
    <>
      <h2 id="frameworks-heading" className={`${H2} max-w-[22ch]`}>
        It knows what a framework&apos;s files are for.
      </h2>
      <p className="mt-6 max-w-[64ch] leading-relaxed text-fg-muted">
        In a Next.js, NestJS, Express or React project, each file gets a role from the framework&apos;s own
        conventions, and each role gets a colour. Those colours are the bar along the foot of every folder on the map.
        A project with no framework is still mapped, by folder.
      </p>
      <dl className="mt-16 grid gap-y-12">
        {FRAMEWORK_ORDER.map((id) => {
          const { name, roles } = FRAMEWORKS[id];
          return (
            <div key={id} className="grid gap-x-20 gap-y-4 md:grid-cols-[11rem_minmax(0,1fr)]">
              <dt className="text-lg font-semibold tracking-tight">{name}</dt>
              <dd>
                <div className="overflow-hidden rounded-full">
                  <FrameworkBar roles={roles} />
                </div>
                <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted">
                  {roles.map((role) => (
                    <li key={role} className="flex items-center gap-1.5">
                      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: ROLES[role].color }} />
                      {ROLES[role].name}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}

const REFUSALS: readonly { title: string; body: string }[] = [
  {
    title: "It won't guess an import",
    body: "If the parser can't resolve an import, it stays unresolved. It never becomes a line to whichever file looks likely.",
  },
  {
    title: "The AI doesn't draw",
    body: "Explanations and answers describe the graph the parser built. A model can't add, remove or rename a file, a folder or an import.",
  },
  {
    title: "It won't answer what the graph can't",
    body: "Ask whether the code is any good and it declines, then says what it can tell you instead.",
  },
  {
    title: "It won't read private code",
    body: "Public repositories only. No GitHub token is ever asked for, so there's no access to hand over.",
  },
  {
    title: "It doesn't run your code",
    body: "The repository is read as source text. Nothing in it is installed or executed.",
  },
];

function WhatItWontDo() {
  return (
    <>
      <div className="grid items-center gap-x-20 gap-y-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <h2 id="refusals-heading" className={H2}>
            What it deliberately doesn&apos;t do.
          </h2>
          <p className="mt-6 max-w-[46ch] leading-relaxed text-fg-muted">
            A map that&apos;s wrong is worse than no map, because you&apos;d trust it. So most of what Cartograph is
            comes down to things it refuses to do. When it doesn&apos;t know, the map shows a gap, not a guess.
          </p>
        </div>
        <Figure>
          <UnresolvedImport />
        </Figure>
      </div>
      <dl className="mt-20 grid gap-x-20 gap-y-12 md:grid-cols-2">
        {REFUSALS.map((refusal) => (
          <div key={refusal.title}>
            <dt className="text-lg font-semibold tracking-tight">{refusal.title}</dt>
            <dd className="mt-2 max-w-[46ch] leading-relaxed text-fg-muted">{refusal.body}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Footer() {
  return (
    <footer className={COLUMN}>
      <div className="flex flex-col gap-3 border-t border-border py-10 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2">
          <Mark />
          Dependency maps drawn from the code itself.
        </span>
        <Link href="/sign-in" className="hover:text-fg">
          Sign in
        </Link>
      </div>
    </footer>
  );
}
