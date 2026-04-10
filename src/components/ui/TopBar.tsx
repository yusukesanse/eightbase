import clsx from "clsx";

interface TopBarProps {
  title: string;
  subtitle?: string;
  color?: string; // tailwind bg class
}

export function TopBar({ title, subtitle, color = "bg-[#A5C1C8]" }: TopBarProps) {
  return (
    <header className={clsx("px-4 pt-3 pb-4", color)}>
      <h1 className="text-[15px] font-medium leading-tight text-[#231714]">{title}</h1>
      {subtitle && (
        <p className="text-[11px] text-[#231714]/50 mt-0.5">{subtitle}</p>
      )}
    </header>
  );
}
