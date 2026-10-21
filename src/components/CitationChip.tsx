import { useApp } from '../context/AppContext'

export function CitationChip({ id }: { id: number }) {
  const { openSource, sourceId } = useApp()
  const active = sourceId === id
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        openSource(id)
      }}
      title="Kaynağı görüntüle"
      className={`mx-0.5 inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded px-1 align-middle text-[11px] font-semibold transition ${
        active ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-100'
      }`}
    >
      [{id}]
    </button>
  )
}

export function Citations({ ids }: { ids?: number[] }) {
  if (!ids?.length) return null
  return (
    <span className="whitespace-nowrap">
      {ids.map((i) => (
        <CitationChip key={i} id={i} />
      ))}
    </span>
  )
}
