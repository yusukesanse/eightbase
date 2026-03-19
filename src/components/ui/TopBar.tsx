import clsx from "clsx";

interface TopBarProps {
  title: string;
  subtitle?: string;
  color?: string; // tailwind bg class
}

export function TopBar({ title, subtitle, color = "bg-[#06C755]" }: TopBarProps) {
  return (
    <header className={clsx("px-4 pt-3 pb-4 text-white", color)}>
      <h1 className="text-[15px] font-medium leading-tight">{title}</h1>
      {subtitle && (
        <p className="text-[11px] text-white/75 mt-0.5">{subtitle}</p>
      )}
    </header>
  );
}
