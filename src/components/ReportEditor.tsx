import { FileText } from 'lucide-react'
import { REPORT_TEMPLATES, type ReportTemplateId } from '../data/reportTemplates'
import type { ReportSections, SectionKey } from '../types'
import { SECTION_LABELS } from '../data/mock'

const KEYS = Object.keys(SECTION_LABELS) as SectionKey[]

export function ReportEditor({
  value,
  onChange,
  disabled = false,
  onApplyTemplate,
}: {
  value: ReportSections
  onChange: (next: ReportSections) => void
  disabled?: boolean
  onApplyTemplate?: (id: ReportTemplateId) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <FileText className="h-3.5 w-3.5" />
          Şablon
          <select
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
            disabled={disabled}
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value as ReportTemplateId
              if (!id) return
              const tpl = REPORT_TEMPLATES.find((t) => t.id === id)
              if (!tpl) return
              onChange({ ...tpl.sections })
              onApplyTemplate?.(id)
              e.target.value = ''
            }}
          >
            <option value="">Şablon uygula…</option>
            {REPORT_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {KEYS.map((key) => (
        <label key={key} className="block">
          <span className="mb-1 block text-xs font-semibold text-navy-900">{SECTION_LABELS[key]}</span>
          <textarea
            className="min-h-[88px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
            value={value[key] ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
    </div>
  )
}
