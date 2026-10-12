import * as React from 'react';
import { cn } from '@/lib/utils';

/** ui/badge.tsx — бейдж статуса (Online/Offline/Unknown) в стиле shadcn/ui. */
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'destructive' | 'outline' | 'muted';
}

const variants: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  success: 'border-transparent bg-emerald-600/20 text-emerald-400',
  destructive: 'border-transparent bg-red-600/20 text-red-400',
  outline: 'text-foreground border-border',
  muted: 'bg-muted text-muted-foreground border-transparent',
};

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
