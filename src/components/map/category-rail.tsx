import type { FileCategory } from "@/map/categories";

/**
 * The left rail: one row per category of file. Rows aren't interactive yet,
 * so they render as a plain list rather than buttons.
 */
export function CategoryRail({ categories }: { categories: FileCategory[] }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <h2 className="px-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Categories</h2>
      {categories.length === 0 ? (
        <p className="px-1 text-sm text-fg-muted">No files parsed.</p>
      ) : (
        <ul className="flex flex-col">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm">
              <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: category.color }} />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              <span className="font-mono text-xs text-fg-muted tabular-nums">{category.fileCount}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
