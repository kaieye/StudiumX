import type { ReactNode } from 'react'

type StudyWorkPanelsProps = {
  children?: ReactNode
}

export function StudyWorkPanels({ children }: StudyWorkPanelsProps) {
  return (
    <>
      {children}

      <section className="study-panel study-work-panel study-growth-panel" aria-label="养成" />
    </>
  )
}
