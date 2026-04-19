import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogClose,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipProvider,
} from '@niuulabs/ui';

export function OverlaysPage() {
  return (
    <TooltipProvider>
      <div style={{ padding: 'var(--space-6)', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        <h2 style={{ margin: 0 }}>Overlay primitives</h2>

        <section>
          <h3 style={{ margin: '0 0 var(--space-3)' }}>Dialog</h3>
          <Dialog>
            <DialogTrigger asChild>
              <button data-testid="dialog-trigger">Open dialog</button>
            </DialogTrigger>
            <DialogContent
              title="Confirm action"
              description="This action cannot be undone."
            >
              <p data-testid="dialog-body" style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
                Dialog body content.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', justifyContent: 'flex-end' }}>
                <DialogClose asChild>
                  <button data-testid="dialog-cancel">Cancel</button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
        </section>

        <section>
          <h3 style={{ margin: '0 0 var(--space-3)' }}>Drawer</h3>
          <Drawer>
            <DrawerTrigger asChild>
              <button data-testid="drawer-trigger">Open drawer</button>
            </DrawerTrigger>
            <DrawerContent title="Side panel">
              <p data-testid="drawer-body" style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
                Drawer body content.
              </p>
            </DrawerContent>
          </Drawer>
        </section>

        <section>
          <h3 style={{ margin: '0 0 var(--space-3)' }}>Popover</h3>
          <Popover>
            <PopoverTrigger asChild>
              <button data-testid="popover-trigger">Open popover</button>
            </PopoverTrigger>
            <PopoverContent>
              <p data-testid="popover-body" style={{ margin: 0 }}>Popover body content.</p>
            </PopoverContent>
          </Popover>
        </section>

        <section>
          <h3 style={{ margin: '0 0 var(--space-3)' }}>Tooltip</h3>
          <Tooltip content="Tooltip content" delayMs={0}>
            <button data-testid="tooltip-trigger">Hover for tooltip</button>
          </Tooltip>
        </section>
      </div>
    </TooltipProvider>
  );
}
