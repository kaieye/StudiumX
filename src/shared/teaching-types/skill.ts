export type SkillCategory = 'learning' | 'productivity' | 'development' | 'lifestyle' | 'other'

export type SkillSummary = {
  id: string
  name: string
  description: string
  argumentHint?: string
  category: SkillCategory
  icon: string
  author: string
  command: string
  source: 'builtin' | 'personal'
  installed: boolean
  installedPath?: string
}

export type SkillCatalogResult = {
  rootPath: string
  skills: SkillSummary[]
}

export type InstallSkillPayload = {
  skillId: string
}

export type InstalledSkillReference = {
  id: string
  name: string
  source: string
  content: string
}
