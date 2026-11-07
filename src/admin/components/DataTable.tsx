/**
 * Reusable data table: search, sortable columns, pagination and empty states.
 * Every admin list screen uses it, so behaviour stays consistent (and Phase 2
 * can swap the data source without touching the table).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Inbox } from 'lucide-react'
import { Button, EmptyState, SearchInput, cn } from './ui'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  sortValue?: (row: T) => string | number
  className?: string
  headerClassName?: string
  align?: 'left' | 'right' | 'center'
  hideBelow?: 'sm' | 'md' | 'lg'
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  searchText?: (row: T) => string
  searchPlaceholder?: string
  toolbar?: ReactNode
  pageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  initialSort?: { key: string; direction: 'asc' | 'desc' }
  caption?: string
  /** Shows skeleton rows while the repository resolves. */
  loading?: boolean
}

export const DataTable = <T,>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Search…',
  toolbar,
  pageSize = 8,
  emptyTitle = 'Nothing here yet',
  emptyDescription = 'Records you create will appear in this list.',
  onRowClick,
  initialSort,
  caption,
  loading = false,
}: DataTableProps<T>) => {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(initialSort ?? null)

  const filtered = useMemo(() => {
    if (!searchText || query.trim() === '') return rows
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => searchText(row).toLowerCase().includes(needle))
  }, [rows, query, searchText])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const column = columns.find((entry) => entry.key === sort.key)
    if (!column?.sortValue) return filtered
    const copy = [...filtered]
    copy.sort((a, b) => {
      const left = column.sortValue!(a)
      const right = column.sortValue!(b)
      if (typeof left === 'number' && typeof right === 'number') {
        return sort.direction === 'asc' ? left - right : right - left
      }
      return sort.direction === 'asc'
        ? String(left).localeCompare(String(right))
        : String(right).localeCompare(String(left))
    })
    return copy
  }, [filtered, sort, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  useEffect(() => {
    setPage(1)
  }, [query, rows])
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const visible = sorted.slice(start, start + pageSize)

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: 'asc' }
      if (current.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
  }

  const alignClass = (align: Column<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <div>
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {searchText ? (
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full sm:w-72"
            />
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-line bg-soft/60">
              {columns.map((column) => {
                const isSorted = sort?.key === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-muted',
                      alignClass(column.align),
                      column.hideBelow === 'sm' ? 'hidden sm:table-cell' : '',
                      column.hideBelow === 'md' ? 'hidden md:table-cell' : '',
                      column.hideBelow === 'lg' ? 'hidden lg:table-cell' : '',
                      column.headerClassName,
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                          isSorted && 'text-ink',
                        )}
                        aria-label={`Sort by ${column.header}`}
                      >
                        {column.header}
                        {isSorted ? (
                          sort?.direction === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: Math.min(pageSize, 4) }, (_, index) => (
                  <tr key={`skeleton-${index}`} className="border-b border-line/70 last:border-0">
                    {columns.map((column) => (
                      <td key={column.key} className="px-4 py-3">
                        <span className="block h-3.5 w-full max-w-[10rem] animate-pulse rounded bg-soft" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {!loading && visible.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line/70 last:border-0 transition',
                  onRowClick ? 'cursor-pointer hover:bg-soft/70' : 'hover:bg-soft/40',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 align-middle text-ink',
                      alignClass(column.align),
                      column.hideBelow === 'sm' ? 'hidden sm:table-cell' : '',
                      column.hideBelow === 'md' ? 'hidden md:table-cell' : '',
                      column.hideBelow === 'lg' ? 'hidden lg:table-cell' : '',
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && visible.length === 0 ? (
        <EmptyState icon={<Inbox className="h-5 w-5" />} title={emptyTitle} description={emptyDescription} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
        <p>
          {sorted.length === 0
            ? 'No records'
            : `Showing ${start + 1}–${Math.min(start + pageSize, sorted.length)} of ${sorted.length}`}
          {query ? ` · filtered from ${rows.length}` : ''}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: totalPages }, (_, index) => index + 1)
            .filter((pageNumber) => {
              if (totalPages <= 5) return true
              return Math.abs(pageNumber - currentPage) <= 1 || pageNumber === 1 || pageNumber === totalPages
            })
            .map((pageNumber, index, list) => {
              const previous = list[index - 1]
              const gap = previous !== undefined && pageNumber - previous > 1
              return (
                <span key={pageNumber} className="flex items-center gap-1">
                  {gap ? <span className="px-1 text-muted">…</span> : null}
                  <button
                    type="button"
                    onClick={() => setPage(pageNumber)}
                    aria-current={pageNumber === currentPage ? 'page' : undefined}
                    className={cn(
                      'h-8 min-w-8 rounded-lg px-2 font-semibold transition',
                      pageNumber === currentPage
                        ? 'bg-brand-600 text-white'
                        : 'text-muted hover:bg-soft hover:text-ink',
                    )}
                  >
                    {pageNumber}
                  </button>
                </span>
              )
            })}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
