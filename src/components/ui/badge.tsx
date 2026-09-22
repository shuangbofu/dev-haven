import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const variants = cva('inline-flex items-center justify-center rounded-sm border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1.5 [&>svg]:size-3', {
  variants: { variant: { default: 'border-transparent bg-primary text-primary-foreground', secondary: 'border-transparent bg-secondary text-secondary-foreground', outline: 'text-muted-foreground border-border', destructive: 'border-transparent bg-destructive/10 text-destructive' } }, defaultVariants: { variant: 'default' },
});
export function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof variants>) { return <span className={cn(variants({ variant }), className)} {...props} />; }
