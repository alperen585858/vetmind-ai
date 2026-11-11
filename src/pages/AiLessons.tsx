import { useEffect, useState } from 'react'
import { GraduationCap, Info, Loader2, Power, RefreshCw, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { deleteLesson, listLessons, updateLesson, type RevisionLesson } from '../lib/backend'
import { modalityLabel, regionLabel } from '../lib/displayClean'
import { fmtDate } from '../lib/format'

export default function AiLessons() {
  const { pushToast } = useApp()
  const { t } = useLocale()
  const [rows, setRows] = useState<RevisionLesson[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    void listLessons()
      .then(setRows)
      .catch((err) =>
        pushToast({ tone: 'error', title: t('lessons.loadFailed'), body: err instanceof Error ? err.message : undefined }),
      )
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (lesson: RevisionLesson) => {
    setBusy(lesson.lesson_id)
    void updateLesson(lesson.lesson_id, { active: !lesson.active })
      .then((next) => setRows((all) => all.map((x) => (x.lesson_id === next.lesson_id ? next : x))))
      .catch((err) =>
        pushToast({ tone: 'error', title: t('lessons.updateFailed'), body: err instanceof Error ? err.message : undefined }),
      )
      .finally(() => setBusy(null))
  }

  const remove = (lesson: RevisionLesson) => {
    if (!window.confirm(t('lessons.deleteConfirm'))) return
    setBusy(lesson.lesson_id)
    void deleteLesson(lesson.lesson_id)
      .then(() => setRows((all) => all.filter((x) => x.lesson_id !== lesson.lesson_id)))
      .catch((err) =>
        pushToast({ tone: 'error', title: t('lessons.updateFailed'), body: err instanceof Error ? err.message : undefined }),
      )
      .finally(() => setBusy(null))
  }

  const speciesLabel = (s: string) => (s === 'canine' ? t('pets.speciesCanine') : s === 'feline' ? t('pets.speciesFeline') : s)
  const activeCount = rows.filter((r) => r.active).length

  return (
    <>
      <PageHeader
        title={t('lessons.title')}
        subtitle={t('lessons.subtitle')}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load} disabled={loading}>
            {t('common.refresh')}
          </Button>
        }
      />

      <p className="mb-4 flex items-start gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {t('lessons.how')}
      </p>

      <Card>
        <CardHeader
          title={t('lessons.title')}
          subtitle={t('lessons.count', { active: activeCount, total: rows.length })}
          icon={<GraduationCap className="h-4 w-4" />}
        />
        {loading ? (
          <div className="flex justify-center py-10 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<GraduationCap className="h-6 w-6" />} title={t('lessons.empty')} text={t('lessons.emptyText')} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((lesson) => (
              <li key={lesson.lesson_id} className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start ${lesson.active ? '' : 'opacity-60'}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-navy-900">{lesson.instruction}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {regionLabel(t, lesson.region)} · {speciesLabel(lesson.species)} · {modalityLabel(t, lesson.modality)}
                    {' · '}
                    {fmtDate(lesson.created_at)}
                    {lesson.source_case_id ? ` · ${t('lessons.sourceCase')}: ${lesson.source_case_id.replace(/^case-/, 'VM-').toUpperCase()}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('lessons.colUsed')}:{' '}
                    {lesson.times_applied ? t('lessons.times', { count: lesson.times_applied }) : t('lessons.never')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      lesson.active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {lesson.active ? t('lessons.active') : t('lessons.inactive')}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Power className="h-3.5 w-3.5" />}
                    disabled={busy === lesson.lesson_id}
                    onClick={() => toggle(lesson)}
                  >
                    {lesson.active ? t('lessons.turnOff') : t('lessons.turnOn')}
                  </Button>
                  <button
                    type="button"
                    className="inline-flex items-center text-slate-400 hover:text-[color:var(--vm-danger)] disabled:opacity-50"
                    aria-label={t('lessons.delete')}
                    disabled={busy === lesson.lesson_id}
                    onClick={() => remove(lesson)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
