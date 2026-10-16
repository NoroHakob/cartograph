import type { FileCategory } from "@/map/categories";
import type { Language } from "@/parser/types";

/**
 * The left rail: one row per category of file. Choosing one dims every file
 * outside it on the map, without removing anything, and each folder says how
 * many of its files matched. Choosing it again, or Clear, undoes that.
 */
export function CategoryRail({
  categories,
  active,
  onSelect,
}: {
  categories: FileCategory[];
  active: Language | null;
  onSelect: (category: Language | null) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">Categories</h2>
        {active !== null && (
          <button type="button" onClick={() => onSelect(null)} className="text-xs text-accent hover:underline">
            Clear
          </button>
        )}
      </div>
      {categories.length === 0 ? (
        <p className="px-1 text-sm text-fg-muted">No files parsed.</p>
      ) : (
        <ul className="flex flex-col">
          {categories.map((category) => {
            const pressed = active === category.id;
            return (
              <li key={category.id}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onSelect(pressed ? null : category.id)}
                  title={pressed ? "Show every file at full strength" : `Dim everything that isn't ${category.name}`}
                  className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-surface-muted ${
                    pressed ? "bg-accent/12 font-medium ring-1 ring-accent ring-inset" : active !== null ? "text-fg-muted" : ""
                  }`}
                >
                  <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: category.color }} />
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <span className="font-mono text-xs text-fg-muted tabular-nums">{category.fileCount}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
