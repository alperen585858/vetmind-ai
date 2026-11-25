import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, FileText, History, Link2, Loader2, Unlink } from 'lucide-react'
import { Card, CardHeader } from '../../shared/ui/Card'
import { LocalizedLink } from '../../shared/shell/LocalizedLink'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useApp } from '../../shared/shell/AppContext'
import { modalityLabel, regionLabel } from '../../shared/lib/displayClean'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { getCasePriorStudies, linkCasePatient } from '../../shared/api'
import type { BackendCasePriorStudies, BackendPatient, BackendPriorStudy } from '../../shared/types'
import { PatientPicker } from './PatientPicker'
import { fromBackendSpecies, relativeAge, studyDate } from './patientLib'

// The comparison viewer pulls in the DICOM viewer; load it only when opened.
const ComparisonViewer = lazy(() => import('./ComparisonViewer').then((m) => ({ default: m.ComparisonViewer })))

/**
 * Issue #108: the same animal's other studies, shown on the case page and the radiologist
 * workspace. Comparable studies (same modality and region) come first.
 */
export function PriorStudiesPanel({ caseId, canLink }: { caseId: string; canLink: boolean }) {
  const { t, locale } = useLocale()
  const { pushToast } = useApp()
  const [data, setData] = useState<BackendCasePriorStudies | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [comparing, setComparing] = useState<BackendPriorStudy | null>(null)
  const [searching, setSearching] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    getCasePriorStudies(caseId)
      .then(setData)
      .catch(() => setFailed(true))
  }, [caseId])

  useEffect(() => {
    setComparing(null)
    setData(null)
    load()
  }, [load])

  const link = async (patient: BackendPatient | null) => {
    setBusy(true)
    try {
      await linkCasePatient(caseId, patient?.patient_id ?? null)
      setSearching(false)
      pushToast({
        tone: 'success',
        title: patient ? t('patients.linkedToast', { name: patient.name }) : t('patients.unlinkedToast'),
      })
      load()
    } catch (err) {
      pushToast({ tone: 'error', title: t('patients.linkFailed'), body: toastErrorBody(err, t) })
    } finally {
      setBusy(false)
    }
  }

  if (failed) return null
  if (!data) {
    return (
      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm text-slate-500" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('patients.loadingPrior')}
        </p>
      </Card>
    )
  }

  const caseDate = studyDate({ study_date: data.case_study_date, created_at: data.case_created_at ?? new Date().toISOString() })
  const dateFmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeZone: 'UTC' })

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader title={t('patients.priorTitle')} icon={<History className="h-5 w-5" />} />

        {!data.patient ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{t('patients.notLinked')}</p>
            {data.suggestions.length > 0 && (
              <ul className="space-y-2">
                {data.suggestions.map((s) => (
                  <li
                    key={s.patient.patient_id}
                    className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
                  >
                    <span className="min-w-0 flex-1">
                      {t(s.reason === 'dicom_patient_id' ? 'patients.suggestDicom' : 'patients.suggestName', {
                        name: s.patient.name,
                        species: fromBackendSpecies(s.patient.species),
                      })}
                    </span>
                    {canLink && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void link(s.patient)}
                        className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                      >
                        <Link2 className="h-3.5 w-3.5" /> {t('patients.link')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canLink &&
              (searching ? (
                <PatientPicker selected={null} onSelect={(p) => p && void link(p)} typedName="" typedSpecies="Diğer" />
              ) : (
                <button type="button" className="text-sm font-medium text-teal-700 hover:underline" onClick={() => setSearching(true)}>
                  {t('patients.searchToLink')}
                </button>
              ))}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-navy-900">{data.patient.name}</span>
              <span className="text-slate-500">
                · {fromBackendSpecies(data.patient.species)}
                {data.patient.breed ? ` · ${data.patient.breed}` : ''}
                {data.patient.microchip ? ` · ${t('patients.microchip')}: ${data.patient.microchip}` : ''}
              </span>
              {canLink && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void link(null)}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-700"
                >
                  <Unlink className="h-3.5 w-3.5" /> {t('patients.unlink')}
                </button>
              )}
            </div>
            {data.studies.length === 0 ? (
              <p className="text-sm text-slate-500">{t('patients.noPrior')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {data.studies.map((s) => {
                  const when = studyDate(s)
                  const age = relativeAge(when, caseDate)
                  const earlier = when.getTime() <= caseDate.getTime()
                  return (
                    <li key={s.case_id} className="flex flex-wrap items-start gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-navy-900">
                          {dateFmt.format(when)}
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            {earlier ? t(`patients.ago.${age.unit}`, { n: age.value }) : t('patients.later')}
                          </span>
                          {s.comparable && (
                            <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800">
                              {t('patients.comparable')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {modalityLabel(t, s.modality)} · {regionLabel(t, s.anatomical_region)} ·{' '}
                          {s.approved_report_version ? t('patients.reportApproved') : t('patients.reportPending')}
                        </p>
                        {s.impression_excerpt && <p className="mt-1 line-clamp-2 text-sm text-slate-700">{s.impression_excerpt}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <LocalizedLink
                          to={`/vakalar/${s.case_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <FileText className="h-3.5 w-3.5" /> {t('patients.openCase')}
                        </LocalizedLink>
                        {s.has_dicom && (
                          <button
                            type="button"
                            onClick={() => setComparing(s)}
                            aria-pressed={comparing?.case_id === s.case_id}
                            className="inline-flex items-center gap-1 rounded-lg bg-vet-turquoise px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" /> {t('patients.compare')}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      {comparing && (
        <Suspense
          fallback={
            <Card className="p-5">
              <Loader2 className="h-4 w-4 animate-spin" />
            </Card>
          }
        >
          <ComparisonViewer currentCaseId={caseId} currentDate={caseDate} prior={comparing} onClose={() => setComparing(null)} />
        </Suspense>
      )}
    </div>
  )
}
