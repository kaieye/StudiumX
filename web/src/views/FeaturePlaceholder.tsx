/**
 * Lightweight "coming in a later phase" placeholder for feature routes that
 * are auto-discovered by App.tsx but not yet implemented (plan §8 Phase 4+).
 *
 * Not a route module itself (its filename is not `route.tsx`), so it is not
 * picked up by the views route-module glob.
 */

interface FeaturePlaceholderProps {
  title: string
  description?: string
}

export function FeaturePlaceholder({ title, description }: FeaturePlaceholderProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-2xl text-neutral-600">
        {description ?? '该功能将在后续阶段接入（plan §8 Phase 4+）。'}
      </p>
    </main>
  )
}
