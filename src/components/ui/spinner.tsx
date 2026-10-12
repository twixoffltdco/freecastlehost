import { cn } from '@/lib/utils';

/** ui/spinner.tsx — мини-спиннер загрузки (CSS-only, без зависимостей). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-label="Загрузка"
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
