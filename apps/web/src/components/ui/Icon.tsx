/**
 * Lightweight inline SVG icons to replace the Material Symbols font.
 * Icons are sized with em units so existing text-* classes keep working.
 */

import React from "react";
import { lucideIconBodies } from "./lucideIconBodies";

const strokeProps = {
  stroke: "currentColor",
  strokeWidth: 2,
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const iconPaths = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" {...strokeProps} />
      <line x1="16.65" y1="16.65" x2="21" y2="21" {...strokeProps} />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" {...strokeProps} />
      <line x1="18" y1="6" x2="6" y2="18" {...strokeProps} />
    </>
  ),
  add: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" {...strokeProps} />
      <line x1="5" y1="12" x2="19" y2="12" {...strokeProps} />
    </>
  ),
  remove: <line x1="5" y1="12" x2="19" y2="12" {...strokeProps} />,
  check: <polyline points="5 12 10 17 19 7" {...strokeProps} />,
  sort: (
    <>
      <line x1="8" y1="4" x2="8" y2="20" {...strokeProps} />
      <polyline points="5 7 8 4 11 7" {...strokeProps} />
      <line x1="16" y1="4" x2="16" y2="20" {...strokeProps} />
      <polyline points="13 17 16 20 19 17" {...strokeProps} />
    </>
  ),
  arrow_upward: (
    <>
      <line x1="12" y1="19" x2="12" y2="5" {...strokeProps} />
      <polyline points="7 10 12 5 17 10" {...strokeProps} />
    </>
  ),
  arrow_downward: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" {...strokeProps} />
      <polyline points="7 14 12 19 17 14" {...strokeProps} />
    </>
  ),
  arrow_back: (
    <>
      <line x1="19" y1="12" x2="5" y2="12" {...strokeProps} />
      <polyline points="10 7 5 12 10 17" {...strokeProps} />
    </>
  ),
  download: (
    <>
      <line x1="12" y1="3" x2="12" y2="15" {...strokeProps} />
      <polyline points="7 10 12 15 17 10" {...strokeProps} />
      <line x1="4" y1="20" x2="20" y2="20" {...strokeProps} />
    </>
  ),
  open_in_new: (
    <>
      <path d="M14 3h7v7" {...strokeProps} />
      <line x1="10" y1="14" x2="21" y2="3" {...strokeProps} />
      <path d="M20 13v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7" {...strokeProps} />
    </>
  ),
  upload_file: (
    <>
      <path d="M14 3h-7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" {...strokeProps} />
      <polyline points="14 3 14 8 19 8" {...strokeProps} />
      <line x1="12" y1="16" x2="12" y2="10" {...strokeProps} />
      <polyline points="9 13 12 10 15 13" {...strokeProps} />
    </>
  ),
  folder_open: (
    <>
      <path d="M3 8h6l2 2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3z" {...strokeProps} />
      <path d="M3 8V6a2 2 0 0 1 2-2h5l2 2h9" {...strokeProps} />
    </>
  ),
  folder_zip: (
    <>
      <path d="M3 8h6l2 2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3z" {...strokeProps} />
      <path d="M3 8V6a2 2 0 0 1 2-2h5l2 2h9" {...strokeProps} />
      <line x1="12" y1="12" x2="12" y2="20" {...strokeProps} />
      <line x1="12" y1="12" x2="13.5" y2="12" {...strokeProps} />
      <line x1="12" y1="16" x2="13.5" y2="16" {...strokeProps} />
    </>
  ),
  videocam: (
    <>
      <rect x="3" y="7" width="14" height="10" rx="2" {...strokeProps} />
      <polygon points="17 9 22 7 22 17 17 15" {...strokeProps} />
    </>
  ),
  photo_camera_front: (
    <>
      <rect x="3" y="7" width="16" height="10" rx="2" {...strokeProps} />
      <circle cx="11" cy="12" r="3" {...strokeProps} />
      <circle cx="6.5" cy="10" r="1" fill="currentColor" />
    </>
  ),
  photo_camera_back: (
    <>
      <rect x="3" y="7" width="16" height="10" rx="2" {...strokeProps} />
      <circle cx="11" cy="12" r="3" {...strokeProps} />
      <circle cx="15.5" cy="10" r="1" fill="currentColor" />
    </>
  ),
  description: (
    <>
      <path d="M6 3h8l4 4v14H6z" {...strokeProps} />
      <polyline points="14 3 14 7 18 7" {...strokeProps} />
      <line x1="8" y1="12" x2="16" y2="12" {...strokeProps} />
      <line x1="8" y1="16" x2="16" y2="16" {...strokeProps} />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8" {...strokeProps} />
      <line x1="12" y1="7" x2="12" y2="12" {...strokeProps} />
      <line x1="12" y1="12" x2="15" y2="15" {...strokeProps} />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" {...strokeProps} />
      <line x1="12" y1="2" x2="12" y2="5" {...strokeProps} />
      <line x1="12" y1="19" x2="12" y2="22" {...strokeProps} />
      <line x1="2" y1="12" x2="5" y2="12" {...strokeProps} />
      <line x1="19" y1="12" x2="22" y2="12" {...strokeProps} />
      <line x1="4.5" y1="4.5" x2="6.7" y2="6.7" {...strokeProps} />
      <line x1="17.3" y1="17.3" x2="19.5" y2="19.5" {...strokeProps} />
      <line x1="17.3" y1="6.7" x2="19.5" y2="4.5" {...strokeProps} />
      <line x1="4.5" y1="19.5" x2="6.7" y2="17.3" {...strokeProps} />
    </>
  ),
  qr_code_2: (
    <>
      <rect x="3" y="3" width="6" height="6" {...strokeProps} />
      <rect x="15" y="3" width="6" height="6" {...strokeProps} />
      <rect x="3" y="15" width="6" height="6" {...strokeProps} />
      <rect x="12" y="12" width="3" height="3" {...strokeProps} />
      <rect x="17" y="17" width="2" height="2" {...strokeProps} />
      <rect x="13" y="17" width="2" height="2" {...strokeProps} />
    </>
  ),
  qr_code_scanner: (
    <>
      <polyline points="4 8 4 4 8 4" {...strokeProps} />
      <polyline points="16 4 20 4 20 8" {...strokeProps} />
      <polyline points="20 16 20 20 16 20" {...strokeProps} />
      <polyline points="8 20 4 20 4 16" {...strokeProps} />
      <rect x="9" y="9" width="6" height="6" {...strokeProps} />
    </>
  ),
  center_focus_weak: (
    <>
      <polyline points="4 9 4 4 9 4" {...strokeProps} />
      <polyline points="15 4 20 4 20 9" {...strokeProps} />
      <polyline points="20 15 20 20 15 20" {...strokeProps} />
      <polyline points="9 20 4 20 4 15" {...strokeProps} />
      <circle cx="12" cy="12" r="3" {...strokeProps} />
    </>
  ),
  fullscreen: (
    <>
      <polyline points="4 9 4 4 9 4" {...strokeProps} />
      <polyline points="15 4 20 4 20 9" {...strokeProps} />
      <polyline points="20 15 20 20 15 20" {...strokeProps} />
      <polyline points="9 20 4 20 4 15" {...strokeProps} />
    </>
  ),
  fullscreen_exit: (
    <>
      <polyline points="9 4 9 9 4 9" {...strokeProps} />
      <polyline points="15 4 15 9 20 9" {...strokeProps} />
      <polyline points="20 15 15 15 15 20" {...strokeProps} />
      <polyline points="4 15 9 15 9 20" {...strokeProps} />
    </>
  ),
  expand_more: <polyline points="6 9 12 15 18 9" {...strokeProps} />,
  expand_less: <polyline points="6 15 12 9 18 15" {...strokeProps} />,
  zoom_in: (
    <>
      <circle cx="11" cy="11" r="7" {...strokeProps} />
      <line x1="21" y1="21" x2="16.65" y2="16.65" {...strokeProps} />
      <line x1="11" y1="8" x2="11" y2="14" {...strokeProps} />
      <line x1="8" y1="11" x2="14" y2="11" {...strokeProps} />
    </>
  ),
  zoom_out: (
    <>
      <circle cx="11" cy="11" r="7" {...strokeProps} />
      <line x1="21" y1="21" x2="16.65" y2="16.65" {...strokeProps} />
      <line x1="8" y1="11" x2="14" y2="11" {...strokeProps} />
    </>
  ),
  visibility: (
    <>
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" {...strokeProps} />
      <circle cx="12" cy="12" r="3" {...strokeProps} />
    </>
  ),
  cloud: (
    <path
      d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.7-1.5A4 4 0 0 0 7 18z"
      {...strokeProps}
    />
  ),
  cloud_upload: (
    <>
      <path
        d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.7-1.5A4 4 0 0 0 7 18z"
        {...strokeProps}
      />
      <line x1="12" y1="15" x2="12" y2="9" {...strokeProps} />
      <polyline points="9 12 12 9 15 12" {...strokeProps} />
    </>
  ),
  cloud_off: (
    <>
      <path
        d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.7-1.5A4 4 0 0 0 7 18z"
        {...strokeProps}
      />
      <line x1="4" y1="4" x2="20" y2="20" {...strokeProps} />
    </>
  ),
  sync: (
    <>
      <path d="M21 12a9 9 0 0 0-15-6" {...strokeProps} />
      <polyline points="3 4 6 6 6 2" {...strokeProps} />
      <path d="M3 12a9 9 0 0 0 15 6" {...strokeProps} />
      <polyline points="21 20 18 18 18 22" {...strokeProps} />
    </>
  ),
  delete: (
    <>
      <polyline points="3 6 5 6 21 6" {...strokeProps} />
      <path d="M8 6v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...strokeProps} />
      <rect x="6" y="6" width="12" height="14" rx="2" {...strokeProps} />
      <line x1="10" y1="11" x2="10" y2="17" {...strokeProps} />
      <line x1="14" y1="11" x2="14" y2="17" {...strokeProps} />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />,
  play_arrow: <path d="M8 5l11 7-11 7z" fill="currentColor" />,
  pause: (
    <>
      <rect x="8" y="5" width="3" height="14" rx="1" fill="currentColor" />
      <rect x="13" y="5" width="3" height="14" rx="1" fill="currentColor" />
    </>
  ),
  play_circle: (
    <>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <path d="M10 8l7 4-7 4z" fill="currentColor" />
    </>
  ),
  pause_circle: (
    <>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <rect x="9" y="8" width="2.5" height="8" fill="currentColor" />
      <rect x="12.5" y="8" width="2.5" height="8" fill="currentColor" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.5 1.1-1.5 2.2" {...strokeProps} />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3l10 18H2z" {...strokeProps} />
      <line x1="12" y1="9" x2="12" y2="14" {...strokeProps} />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <line x1="12" y1="10" x2="12" y2="16" {...strokeProps} />
      <circle cx="12" cy="7" r="1" fill="currentColor" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <line x1="12" y1="7" x2="12" y2="13" {...strokeProps} />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </>
  ),
  verified_user: (
    <>
      <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" {...strokeProps} />
      <polyline points="8.5 12.5 11 15 15.5 10.5" {...strokeProps} />
    </>
  ),
  wifi: (
    <>
      <path d="M5 9a10 10 0 0 1 14 0" {...strokeProps} />
      <path d="M8 12a6 6 0 0 1 8 0" {...strokeProps} />
      <path d="M11 15a2 2 0 0 1 2 0" {...strokeProps} />
      <circle cx="12" cy="18" r="1" fill="currentColor" />
    </>
  ),
  wifi_tethering: (
    <>
      <path d="M5 9a10 10 0 0 1 14 0" {...strokeProps} />
      <path d="M8 12a6 6 0 0 1 8 0" {...strokeProps} />
      <path d="M11 15a2 2 0 0 1 2 0" {...strokeProps} />
      <circle cx="12" cy="18" r="1" fill="currentColor" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3" {...strokeProps} />
      <path d="M5 20a7 7 0 0 1 14 0" {...strokeProps} />
    </>
  ),
  payments: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" {...strokeProps} />
      <line x1="3" y1="10" x2="21" y2="10" {...strokeProps} />
      <circle cx="8" cy="15" r="1.5" {...strokeProps} />
    </>
  ),
  text_fields: (
    <>
      <line x1="5" y1="6" x2="19" y2="6" {...strokeProps} />
      <line x1="12" y1="6" x2="12" y2="18" {...strokeProps} />
      <line x1="8" y1="18" x2="16" y2="18" {...strokeProps} />
    </>
  ),
  gif_box: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" {...strokeProps} />
      <circle cx="9" cy="10" r="2" {...strokeProps} />
      <path d="M5 18l5-4 3 2 3-3 3 5" {...strokeProps} />
    </>
  ),
  save: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" {...strokeProps} />
      <rect x="8" y="4" width="8" height="5" {...strokeProps} />
      <rect x="8" y="13" width="8" height="5" {...strokeProps} />
    </>
  ),
  flashlight_on: (
    <>
      <path d="M9 3h6l-1 6 2 3v9H8v-9l2-3z" {...strokeProps} />
      <line x1="12" y1="1.5" x2="12" y2="3" {...strokeProps} />
      <line x1="9" y1="1.5" x2="9.7" y2="3" {...strokeProps} />
      <line x1="15" y1="1.5" x2="14.3" y2="3" {...strokeProps} />
    </>
  ),
  flashlight_off: (
    <>
      <path d="M9 3h6l-1 6 2 3v9H8v-9l2-3z" {...strokeProps} />
      <line x1="4" y1="4" x2="20" y2="20" {...strokeProps} />
    </>
  ),
  restart_alt: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.7" {...strokeProps} />
      <polyline points="4 4 6.3 6.3 2.5 6.3" {...strokeProps} />
    </>
  ),
  light_mode: (
    <>
      <circle cx="12" cy="12" r="4" {...strokeProps} />
      <line x1="12" y1="2" x2="12" y2="5" {...strokeProps} />
      <line x1="12" y1="19" x2="12" y2="22" {...strokeProps} />
      <line x1="2" y1="12" x2="5" y2="12" {...strokeProps} />
      <line x1="19" y1="12" x2="22" y2="12" {...strokeProps} />
      <line x1="4.5" y1="4.5" x2="6.7" y2="6.7" {...strokeProps} />
      <line x1="17.3" y1="17.3" x2="19.5" y2="19.5" {...strokeProps} />
      <line x1="17.3" y1="6.7" x2="19.5" y2="4.5" {...strokeProps} />
      <line x1="4.5" y1="19.5" x2="6.7" y2="17.3" {...strokeProps} />
    </>
  ),
  speed: (
    <>
      <path d="M5 16a7 7 0 0 1 14 0" {...strokeProps} />
      <line x1="12" y1="12" x2="16" y2="9" {...strokeProps} />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </>
  ),
  push_pin: (
    <>
      <path d="M8 4h8l-2 6 3 3-5 2-5-2 3-3z" {...strokeProps} />
      <line x1="12" y1="15" x2="12" y2="21" {...strokeProps} />
    </>
  ),
  grid_view: (
    <>
      <rect x="4" y="4" width="6" height="6" {...strokeProps} />
      <rect x="14" y="4" width="6" height="6" {...strokeProps} />
      <rect x="4" y="14" width="6" height="6" {...strokeProps} />
      <rect x="14" y="14" width="6" height="6" {...strokeProps} />
    </>
  ),
  hourglass_empty: (
    <>
      <path d="M7 2h10v4c0 2-3 3-5 5 2 2 5 3 5 5v4H7v-4c0-2 3-3 5-5-2-2-5-3-5-5z" {...strokeProps} />
    </>
  ),
  star: (
    <path
      d="M12 3l3 6 6.5.9-4.7 4.4 1.1 6.4L12 17l-5.9 3.7 1.1-6.4L2.5 9.9 9 9z"
      {...strokeProps}
    />
  ),
  autorenew: (
    <>
      <path d="M21 12a9 9 0 0 0-15-6" {...strokeProps} />
      <polyline points="3 4 6 6 6 2" {...strokeProps} />
      <path d="M3 12a9 9 0 0 0 15 6" {...strokeProps} />
      <polyline points="21 20 18 18 18 22" {...strokeProps} />
    </>
  ),
  check_circle: (
    <>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <polyline points="8 12 11 15 16 9" {...strokeProps} />
    </>
  ),
  info_outline: (
    <>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <line x1="12" y1="10" x2="12" y2="16" {...strokeProps} />
      <circle cx="12" cy="7" r="1" fill="currentColor" />
    </>
  ),
  flashlight: (
    <path d="M9 3h6l-1 6 2 3v9H8v-9l2-3z" {...strokeProps} />
  ),
  article: (
    <>
      <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" {...strokeProps} />
      <line x1="8" y1="8" x2="16" y2="8" {...strokeProps} />
      <line x1="8" y1="12" x2="16" y2="12" {...strokeProps} />
      <line x1="8" y1="16" x2="12" y2="16" {...strokeProps} />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" {...strokeProps} />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" {...strokeProps} />
    </>
  ),
  refresh: (
    <>
      <path d="M4 12a8 8 0 0 1 14-5" {...strokeProps} />
      <polyline points="20 3 20 7 16 7" {...strokeProps} />
      <path d="M20 12a8 8 0 0 1-14 5" {...strokeProps} />
      <polyline points="4 21 4 17 8 17" {...strokeProps} />
    </>
  ),
  content_copy: (
    <>
      <rect x="9" y="9" width="10" height="10" rx="2" {...strokeProps} />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" {...strokeProps} />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" {...strokeProps} />
      <rect x="14" y="4" width="6" height="6" {...strokeProps} />
      <rect x="4" y="14" width="6" height="6" {...strokeProps} />
      <rect x="14" y="14" width="6" height="6" {...strokeProps} />
    </>
  ),
};

export type IconName = keyof typeof iconPaths | keyof typeof lucideIconBodies;

type IconProps = {
  name: IconName | string;
  className?: string;
  title?: string;
};

const hasExplicitIconColor = (className?: string): boolean => {
  if (!className) {
    return false;
  }

  return (
    className.includes("airqr-sync-icon") ||
    className.includes("text-[var(--airqr-") ||
    className.includes("text-[#") ||
    className.includes("text-[rgb") ||
    /(?:^|\s)text-(?:white|black|red|green|blue|amber|yellow|orange|emerald|rose|gray|grey|slate|zinc|neutral|stone)(?:-|\/|\s|$)/.test(
      className
    )
  );
};

function isLucideIconName(name: string): name is keyof typeof lucideIconBodies {
  return name in lucideIconBodies;
}

function isKnownIconPath(name: string): name is keyof typeof iconPaths {
  return name in iconPaths;
}

const Icon: React.FC<IconProps> = ({ name, className, title }) => {
  const lucideGlyph = isLucideIconName(name) ? lucideIconBodies[name] : undefined;
  const resolvedClassName = [
    "airqr-icon",
    hasExplicitIconColor(className) ? "airqr-icon-explicit" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (lucideGlyph) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={resolvedClassName}
        style={{ width: "1em", height: "1em" }}
        data-icon={name}
        aria-hidden={title ? undefined : true}
        role={title ? "img" : "presentation"}
        focusable="false"
      >
        {title ? <title>{title}</title> : null}
        <g dangerouslySetInnerHTML={{ __html: lucideGlyph }} />
      </svg>
    );
  }

  const glyph = isKnownIconPath(name) ? iconPaths[name] : iconPaths.help;

  return (
    <svg
      viewBox="0 0 24 24"
      className={resolvedClassName}
      style={{ width: "1em", height: "1em" }}
      data-icon={name}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : "presentation"}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
};

export default Icon;
