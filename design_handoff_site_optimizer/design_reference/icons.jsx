/* Simple line icons. Stroke-based, 1.6px, currentColor. */
const I = ({ d, size = 16, fill, vb = 24, sw = 1.7, children }) => (
  <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill="none"
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} fill={fill || 'none'} /> : children}
  </svg>
);

const Icon = {
  zip: (p) => <I {...p}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 3v3M14 6v3M10 9v3M14 12v3"/></I>,
  folder: (p) => <I {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>,
  arrowDown: (p) => <I {...p} d="M12 5v14M6 13l6 6 6-6"/>,
  check: (p) => <I {...p} d="M4 12.5l5 5L20 6.5"/>,
  gear: (p) => <I {...p}><path d="M4 7h9.6M18.4 7H20M4 12h1.6M10.4 12H20M4 17h6.6M15.4 17H20"/><circle cx="16" cy="7" r="2.3"/><circle cx="8" cy="12" r="2.3"/><circle cx="13" cy="17" r="2.3"/></I>,
  chevron: (p) => <I {...p} d="M6 9l6 6 6-6"/>,
  arrowRight: (p) => <I {...p} d="M5 12h13M12 5.5 18.5 12 12 18.5"/>,
  sparkles: (p) => <I {...p}><path d="M12 3l1.5 4.8L18 9l-4.5 1.2L12 15l-1.5-4.8L6 9l4.5-1.2z"/><path d="M18.5 14l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/></I>,
  spark: (p) => <I {...p} d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/>,
  file: (p) => <I {...p}><path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/></I>,
  doc: (p) => <I {...p}><path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M9 13h6M9 17h4"/></I>,
  refresh: (p) => <I {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5"/></I>,
  x: (p) => <I {...p} d="M6 6l12 12M18 6L6 18"/>,
  min: (p) => <I {...p} d="M5 12h14"/>,
  max: (p) => <I {...p}><rect x="5" y="5" width="14" height="14" rx="1.5"/></I>,
  stop: (p) => <I {...p}><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></I>,
  globe: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></I>,
  download: (p) => <I {...p} d="M12 3v12M7 10l5 5 5-5M4 21h16"/>,
  edit: (p) => <I {...p} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>,
  sun: (p) => <I {...p}><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7"/></I>,
  moon: (p) => <I {...p} d="M20.5 14.2A8.2 8.2 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7z"/>,
  search: (p) => <I {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></I>,
  image: (p) => <I {...p}><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16l-5-5-7 7"/></I>,
  type: (p) => <I {...p} d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5"/>,
  code: (p) => <I {...p} d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>,
  brace: (p) => <I {...p} d="M8 4c-2 0-2.5 1.2-2.5 3v1.5C5.5 10 5 11 3.5 11C5 11 5.5 12 5.5 13.5V16c0 1.8.5 3 2.5 3M16 4c2 0 2.5 1.2 2.5 3v1.5C18.5 10 19 11 20.5 11C19 11 18.5 12 18.5 13.5V16c0 1.8-.5 3-2.5 3"/>,
  trash: (p) => <I {...p} d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>,
  alert: (p) => <I {...p}><path d="M12 9v4"/><circle cx="12" cy="16.5" r="0.4" fill="currentColor"/><path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></I>,
  trend: (p) => <I {...p} d="M3 17l6-6 4 4 8-8M21 7v5M21 7h-5"/>,
};

window.Icon = Icon;
