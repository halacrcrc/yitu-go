// 通用小组件：内联图标 + 模态框 + 徽章
import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  play: (
    <>
      <circle cx="8" cy="8" r="3.2" />
      <circle cx="16" cy="16" r="3.2" />
    </>
  ),
  book: <path d="M4 4h7a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4zM20 4h-4a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20z" />,
  puzzle: <path d="M10 3h4v2.5a1.5 1.5 0 1 0 3 0V3h4v4h-2.5a1.5 1.5 0 1 0 0 3H21v4h-2.5a1.5 1.5 0 1 1-3 0H21v4h-4v-2.5a1.5 1.5 0 1 0-3 0V21h-4v-4h2.5a1.5 1.5 0 1 1 0-3H10v-4h2.5a1.5 1.5 0 1 0 0-3H10z" />,
  records: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  pass: <path d="M5 12a7 7 0 1 1 7 7M5 12V6M5 12h6" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 3.6 10.8c-.7.5-1.1 1.3-1.1 2.2H9.5c0-.9-.4-1.7-1.1-2.2A6 6 0 0 1 12 3z" />,
  flag: <path d="M5 21V4M5 4h13l-2.5 4L18 12H5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  export: <path d="M12 3v12M7 8l5-5 5 5M4 17v3h16v-3" />,
  import: <path d="M12 15V3M7 10l5 5 5-5M4 17v3h16v-3" />,
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  chevronLeft: <path d="M14 6l-6 6 6 6" />,
  chevronRight: <path d="M10 6l6 6-6 6" />,
  chevronFirst: <path d="M17 6l-6 6 6 6M7 6v12" />,
  chevronLast: <path d="M7 6l6 6-6 6M17 6v12" />,
  check: <path d="M4 12l5 5L20 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  soundOn: <path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />,
  soundOff: <path d="M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6" />,
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  playSolid: <path d="M8 5v14l11-7z" />,
  pause: <path d="M7 5h4v14H7zM13 5h4v14h-4z" />,
};

export function Icon({ name, size = 20, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? null}
    </svg>
  );
}

export function Modal({ open, title, onClose, children, width = 520 }: { open: boolean; title: string; onClose: () => void; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
