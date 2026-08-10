'use client'

import * as React from 'react'
import { GripVerticalIcon } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '@/lib/core'

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        'flex h-full w-full data-[panel-group-direction=vertical]:flex-col',
        className,
      )}
      {...props}
    />
  )
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        'group/handle bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-3 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90',
        // A resize handle has to *look* draggable before it's grabbed — the
        // library only sets a global cursor once a drag is already underway.
        'cursor-col-resize data-[panel-group-direction=vertical]:cursor-row-resize',
        'transition-colors hover:bg-primary/60 data-[resize-handle-state=drag]:bg-primary',
        className,
      )}
      {...props}
    >
      {/*
        A 1px hairline reads as a border, not a control. Widen the hit area,
        light the divider up on hover/drag, and give the grip enough contrast
        that it's obviously grabbable.
      */}
      {withHandle && (
        <div
          className={cn(
            'z-10 flex h-8 w-3.5 items-center justify-center rounded-sm border bg-muted text-muted-foreground',
            'transition-colors group-hover/handle:border-primary/60 group-hover/handle:bg-primary/15 group-hover/handle:text-primary',
            'group-data-[resize-handle-state=drag]/handle:border-primary group-data-[resize-handle-state=drag]/handle:bg-primary/25 group-data-[resize-handle-state=drag]/handle:text-primary',
          )}
        >
          <GripVerticalIcon className="size-3" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
