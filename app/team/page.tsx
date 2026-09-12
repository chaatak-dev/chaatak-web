import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Team — The Overcast",
  description:
    "Meet The Overcast, winners of Smart India Hackathon 2026 — led by Yash Sharma.",
};

type Member = {
  name: string;
  role: string;
  initials: string;
};

const leader: Member = {
  name: "Yash Sharma",
  role: "Team Leader",
  initials: "YS",
};

const members: Member[] = [
  { name: "Krrish Choudhary", role: "Member", initials: "KC" },
  { name: "Madhur Verma", role: "Member", initials: "MV" },
  { name: "Prachi Panchal", role: "Member", initials: "PP" },
  { name: "Prarthna Mishra", role: "Member", initials: "PM" },
  { name: "Sameer", role: "Member", initials: "S" },
];

function Monogram({ initials, large }: { initials: string; large?: boolean }) {
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-400 font-semibold tracking-tight text-zinc-700 ring-1 ring-black/[.06] dark:from-zinc-700 dark:to-zinc-900 dark:text-zinc-200 dark:ring-white/[.12] ${
        large ? "h-20 w-20 text-2xl" : "h-14 w-14 text-base"
      }`}
    >
      {initials}
    </div>
  );
}

export default function TeamPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl flex-1 px-6 py-20 sm:px-16 sm:py-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
          <span aria-hidden>&#9733;</span>
          SIH 2026 Winners
        </span>

        <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-black sm:text-5xl dark:text-zinc-50">
          The Overcast
        </h1>
        <p className="mt-4 max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Winners of the Smart India Hackathon 2026. Six people, one build.
        </p>

        <section aria-labelledby="leader-heading" className="mt-16">
          <h2
            id="leader-heading"
            className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500"
          >
            Team Leader
          </h2>
          <div className="mt-4 flex items-center gap-5 rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
            <Monogram initials={leader.initials} large />
            <div>
              <p className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
                {leader.name}
              </p>
              <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">
                {leader.role}
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="members-heading" className="mt-12">
          <h2
            id="members-heading"
            className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500"
          >
            Members
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {members.map((member) => (
              <li
                key={member.name}
                className="flex items-center gap-4 rounded-2xl border border-black/[.08] bg-white p-5 transition-colors hover:border-black/[.16] dark:border-white/[.145] dark:bg-zinc-950 dark:hover:border-white/[.28]"
              >
                <Monogram initials={member.initials} />
                <div>
                  <p className="text-base font-medium tracking-tight text-black dark:text-zinc-50">
                    {member.name}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                    {member.role}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Link
          href="/"
          className="mt-16 inline-flex items-center gap-2 text-sm font-medium text-zinc-600 transition-colors hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          <span aria-hidden>&#8592;</span> Back home
        </Link>
      </main>
    </div>
  );
}
