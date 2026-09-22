import * as React from 'react';
import { cn } from '@/lib/utils';
export function Table({ className, ...props }: React.ComponentProps<'table'>) { return <div data-slot="table-container" className="relative w-full overflow-x-auto"><table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} /></div>; }
export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) { return <thead className={cn('[&_tr]:border-b', className)} {...props} />; }
export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) { return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />; }
export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) { return <tr className={cn('border-b border-border transition-colors hover:bg-muted/40', className)} {...props} />; }
export function TableHead({ className, ...props }: React.ComponentProps<'th'>) { return <th className={cn('h-11 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap', className)} {...props} />; }
export function TableCell({ className, ...props }: React.ComponentProps<'td'>) { return <td className={cn('px-4 py-3 align-middle', className)} {...props} />; }
