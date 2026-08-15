import type { SVGProps } from 'react'

type ToolbarIconProps = SVGProps<SVGSVGElement> & {
  size?: number
}

function ToolbarIcon({ size = 20, children, ...props }: ToolbarIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Inward-facing chevrons: collapse the last visible topic level. */
export function CollapseAllTopicsIcon(props: ToolbarIconProps) {
  return (
    <ToolbarIcon {...props}>
      <path d="M5.5 5.5L9 10L5.5 14.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 5.5L11 10L14.5 14.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </ToolbarIcon>
  )
}

/** Outward-facing chevrons: expand the next topic level. */
export function ExpandAllTopicsIcon(props: ToolbarIconProps) {
  return (
    <ToolbarIcon {...props}>
      <path d="M8.5 5.5L5 10L8.5 14.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 5.5L15 10L11.5 14.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </ToolbarIcon>
  )
}

/** A selected topic connected directly to a new child topic on its right. */
export function AddChildTopicIcon(props: ToolbarIconProps) {
  return (
    <ToolbarIcon {...props}>
      <rect x="1.75" y="7.5" width="7" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.75 10H11.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="11.25" y="7.5" width="7" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.5" />
      <circle cx="16" cy="15.75" r="3.25" className="mindmap-toolbar-glyph__badge" />
      <path d="M14.5 15.75H17.5M16 14.25V17.25" className="mindmap-toolbar-glyph__badge-mark" />
    </ToolbarIcon>
  )
}

/** A selected topic and a new topic sharing the same parent level. */
export function AddSiblingTopicIcon(props: ToolbarIconProps) {
  return (
    <ToolbarIcon {...props}>
      <path d="M3.25 4.75V14.25M3.25 5.25H6M3.25 13.75H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="6" y="2.75" width="8" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="11.25" width="8" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.5" />
      <circle cx="16" cy="15.75" r="3.25" className="mindmap-toolbar-glyph__badge" />
      <path d="M14.5 15.75H17.5M16 14.25V17.25" className="mindmap-toolbar-glyph__badge-mark" />
    </ToolbarIcon>
  )
}
