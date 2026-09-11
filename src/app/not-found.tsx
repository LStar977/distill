import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[1140px] flex-col gap-3 px-8 py-16">
      <span className="eyebrow">404</span>
      <h1 className="m-0 font-serif text-[34px] font-semibold leading-[1.1] tracking-[-0.01em]">Nothing here yet</h1>
      <p className="m-0 max-w-[560px] text-[15px] text-ink-dim">That run or opportunity doesn&apos;t exist. Start from a new run.</p>
      <Link href="/" className="font-mono text-[12px] no-underline">
        ← New run
      </Link>
    </div>
  );
}
