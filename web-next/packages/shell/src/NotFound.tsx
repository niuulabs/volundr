import { Rune } from '@niuulabs/ui';

export function NotFound() {
  return (
    <div className="niuu-shell__not-found">
      <Rune glyph="?" size={48} />
      <h2 className="niuu-shell__not-found-title">404</h2>
      <p className="niuu-shell__not-found-text">Page not found</p>
    </div>
  );
}
