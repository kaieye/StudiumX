import { isAbsolute, relative, resolve } from 'node:path'

export function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

export function isPathInsideConfiguredRoot(rootPath: string, targetPath: string): boolean {
  return rootPath.trim().length > 0 && isPathInsideRoot(rootPath, targetPath)
}
