import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 shrink-0 cursor-pointer', {
  variants: {
    variant: { default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs', outline: 'border border-border bg-background hover:bg-muted text-foreground shadow-xs', ghost: 'hover:bg-muted text-muted-foreground hover:text-foreground', secondary: 'bg-accent text-accent-foreground hover:bg-accent/75', destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20' },
    size: { default: 'h-8 px-3 text-xs', sm: 'h-8 px-3 text-xs', lg: 'h-11 px-5', icon: 'size-8' },
  }, defaultVariants: { variant: 'default', size: 'default' },
});
export function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
