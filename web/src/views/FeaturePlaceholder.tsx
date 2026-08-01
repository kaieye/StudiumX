/**
 * Legacy placeholder retained for contract fixtures from the pre-shared Web
 * shell. The current authenticated Web surface is rendered by the shared
 * desktop App, so this component is not mounted by `web/src/App.tsx`.
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
