import type { HTMLAttributes, ReactNode } from 'react'

const FSI = '\u2068'
const PDI = '\u2069'
const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

export function stripBidiControls(value: string): string {
  return value.replace(BIDI_CONTROL_PATTERN, '')
}

/** Isolates dynamic text when it must be embedded in an aria-label or other plain string. */
export function bidiIsolate(value: string): string {
  return `${FSI}${stripBidiControls(value)}${PDI}`
}

export type BidiTextProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'dir'> & {
  children: ReactNode
}

/** Use for user/source-provided labels so mixed RTL, CJK, emoji, and Latin text cannot reorder surrounding UI. */
export function BidiText({ children, ...props }: BidiTextProps) {
  const safeChildren = typeof children === 'string' ? stripBidiControls(children) : children
  return <bdi dir="auto" {...props}>{safeChildren}</bdi>
}
