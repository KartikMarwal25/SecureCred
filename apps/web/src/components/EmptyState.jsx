export function EmptyState({ title, action }) {
  return (
    <div className="flex flex-col items-center gap-16 rounded-[16px] border border-edge bg-surface px-24 py-48 text-center shadow-xs">
      <p className="max-w-[440px] text-[16px] leading-[24px] text-muted">{title}</p>
      {action}
    </div>
  );
}
