import { useEffect, useState } from 'react'
import { GraduationCap, Info, Loader2, Power, RefreshCw, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
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
  const [pendingDelete, setPendingDelete] = useState<RevisionLesson | null>(null)

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

  const confirmRemove = () => {
    const lesson = pendingDelete
    if (!lesson) return
    setBusy(lesson.lesson_id)
    void deleteLesson(lesson.lesson_id)
      .then(() => {
        setRows((all) => all.filter((x) => x.lesson_id !== lesson.lesson_id))
        setPendingDelete(null)
      })
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
      <div className="mb-5 overflow-hidden rounded-[1.25rem] bg-gradient-to-r from-violet-950 via-navy-950 to-indigo-950 px-5 py-4 text-white shadow-soft">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-300/90">{t('lessons.title')}</p>
        <p className="mt-1 font-display text-lg font-semibold tracking-tight">{t('lessons.subtitle')}</p>
      </div>

      <p className="mb-5 flex items-start gap-3 rounded-2xl border border-violet-200/80 bg-gradient-to-r from-violet-50 to-white px-4 py-3 text-sm text-violet-950 shadow-sm">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
          <Info className="h-4 w-4" aria-hidden />
        </span>
        <span className="leading-relaxed">{t('lessons.how')}</span>
      </p>
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-navy-950 px-3 py-1.5 text-xs font-semibold text-white">
        <GraduationCap className="h-3.5 w-3.5 text-violet-300" aria-hidden />
        {activeCount}/{rows.length}
      </div>

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
                    onClick={() => setPendingDelete(lesson)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => {
          if (!busy) setPendingDelete(null)
        }}
        title={t('lessons.delete')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={Boolean(busy)}
              icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              onClick={confirmRemove}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{t('lessons.deleteConfirm')}</p>
      </Modal>
    </>
  )
}
