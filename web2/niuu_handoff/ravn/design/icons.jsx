/* global React, lucide */
// Lucide React wrapper — renders an SVG string from lucide-static via dangerouslySetInnerHTML
// Falls back to a tiny box placeholder if an icon name isn't found.

const LUCIDE_CACHE = new Map();

function Icon({ name, size = 16, stroke = 2, className = '', color }) {
  const [html, setHtml] = React.useState(() => LUCIDE_CACHE.get(name) || null);
  React.useEffect(() => {
    if (html) return;
    if (!window.lucide) return;
    // lucide.icons keys are kebab-case
    const kebab = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    const pascal = kebab.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
    const iconData = lucide.icons?.[pascal] || lucide.icons?.[name] || null;
    if (iconData) {
      // iconData is [tag, attrs, children] in newer versions, or has a .toSvg() method
      let svg = '';
      if (typeof iconData.toSvg === 'function') {
        svg = iconData.toSvg({ 'stroke-width': stroke });
      } else if (Array.isArray(iconData)) {
        // Shape varies by lucide version:
        //   [tag, attrs, children]  OR  children-array directly
        let children = iconData;
        if (iconData.length === 3 && typeof iconData[0] === 'string' && iconData[0] === 'svg') {
          children = iconData[2];
        }
        const body = (Array.isArray(children) ? children : []).map(node => {
          if (!Array.isArray(node)) return '';
          const t = node[0];
          const a = node[1] || {};
          const at = Object.entries(a).map(([k,v]) => `${k}="${v}"`).join(' ');
          return `<${t} ${at}/>`;
        }).join('');
        svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
      }
      if (svg) {
        LUCIDE_CACHE.set(name, svg);
        setHtml(svg);
      }
    }
  }, [name, html, size, stroke]);

  if (html) {
    // re-size existing cached svg if needed
    const sized = html.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
    return <span className={`icon ${className}`} style={{ display:'inline-flex', color }} dangerouslySetInnerHTML={{ __html: sized }} />;
  }
  return <span className={`icon icon-ph ${className}`} style={{ width: size, height: size, display:'inline-block', border:'1px solid currentColor', opacity: 0.4, borderRadius: 2 }} />;
}

// Rune glyph — lines up with JetBrains Mono
function Rune({ ch, size = 14, color }) {
  return <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: size, color: color || 'var(--color-brand)', lineHeight: 1 }}>{ch}</span>;
}

window.Icon = Icon;
window.Rune = Rune;
