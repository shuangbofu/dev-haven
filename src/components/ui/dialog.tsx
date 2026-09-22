'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" /><DialogPrimitive.Content className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg outline-none max-h-[88vh] overflow-auto', className)} {...props}>{children}<DialogPrimitive.Close aria-label="关闭" className="dialog-close absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X size={16} /></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal>;
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title className={cn('text-xl font-semibold tracking-tight', className)} {...props} />; }
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description className={cn('text-sm leading-6 text-muted-foreground mt-2', className)} {...props} />; }
