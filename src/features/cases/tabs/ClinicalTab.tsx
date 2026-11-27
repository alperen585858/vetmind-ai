import { useEffect, useState } from 'react'
import {
  Brain,
  ClipboardList,
  Image as ImageIcon,
  Info,
  Stethoscope,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card, CardHeader } from '../../../shared/ui/Card'
import { Button } from '../../../shared/ui/Button'
import { localize } from '../../../shared/lib/neuroLocalization'
import { toastErrorBody } from '../../../shared/lib/apiErrors'
import { OwnerNameField } from '../../../shared/ui/OwnerNameField'
import { fmtDateTimeLocal } from '../../../shared/lib/format'
import { USERS } from '../../../shared/demo/users'
import { cleanClinicalHistory, displayClinic, studyLabel } from '../../../shared/lib/displayClean'
import { reviewerDisplay } from '../../../shared/lib/reviewer'
import {
  appendCaseClinicalNote,
  closeCaseInfoRequest,
  createCaseInfoRequest,
  getBackendCase,
  replyCaseInfoRequest,
  revokeCaseReportViewLinks,
  updateCaseOwner,
} from '../../../shared/api'
import type { BackendCaseRecord } from '../../../shared/types'
import { NOT_EVALUATED, cranialNervesText, isEvaluated, isNeuroExamEmpty } from '../../../shared/lib/neuroExam'
import type { VetCase } from '../../../shared/types'

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-3 py-2 text-sm">
      <dt className="col-span-2 text-slate-500">{k}</dt>
      <dd className="col-span-3 text-navy-900">{v}</dd>
    </div>
  )
}

export function Overview({ c }: { c: VetCase }) {
  const { role, pushToast, hydrateBackendCase } = useApp()
  const { t, locale } = useLocale()
  const isVet = role === 'vet' || role === 'clinic_owner'
  const isExpert = role === 'expert'
  const p = c.patient
  const n = c.neuro
  const loc = localize(n, c.clinical, locale)
  // Unrecorded exam items are shown as "not entered", never as a normal finding (#72).
  const item = (value: string) =>
    isEvaluated(value) ? value : <span className="font-medium text-amber-700">{t('cases.detail.notEntered')}</span>
  const caseKey = c.backendCaseId || c.id
  const [note, setNote] = useState('')
  const [infoBody, setInfoBody] = useState('')
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [backendExtras, setBackendExtras] = useState<Pick<
    BackendCaseRecord,
    'info_requests' | 'clinical_notes_log'
  > | null>(null)
  const [extrasTick, setExtrasTick] = useState(0)
  const savedOwnerName = c.ownerContactName || (c.patient.ownerName !== '—' ? c.patient.ownerName : '') || ''
  const [ownerDraft, setOwnerDraft] = useState(savedOwnerName)
  const [ownerBusy, setOwnerBusy] = useState(false)

  useEffect(() => {
    setOwnerDraft(savedOwnerName)
  }, [savedOwnerName])

  useEffect(() => {
    if (!c.fromBackend || !caseKey.startsWith('case-')) {
      setBackendExtras(null)
      return
    }
    let cancelled = false
    void getBackendCase(caseKey)
      .then((rec) => {
        if (cancelled) return
        setBackendExtras({
          info_requests: rec.info_requests,
          clinical_notes_log: rec.clinical_notes_log,
        })
      })
      .catch(() => {
        if (!cancelled) setBackendExtras(null)
      })
    return () => {
      cancelled = true
    }
  }, [caseKey, c.fromBackend, extrasTick])

  const refresh = async () => {
    if (caseKey.startsWith('case-')) await hydrateBackendCase(caseKey)
    setExtrasTick((t) => t + 1)
  }

  const addNote = async () => {
    if (!note.trim() || !caseKey.startsWith('case-')) return
    setBusy(true)
    try {
      await appendCaseClinicalNote(caseKey, note.trim())
      setNote('')
      pushToast({ tone: 'success', title: t('cases.detail.toastNoteAdded') })
      await refresh()
    } catch (e) {
      pushToast({ tone: 'error', title: t('cases.detail.toastNoteFailed'), body: toastErrorBody(e, t) })
    } finally {
      setBusy(false)
    }
  }

  const roleLabel = (role: string) => {
    if (role === 'expert') return t('cases.detail.roleExpert')
    if (role === 'vet' || role === 'clinic_owner') return t('cases.detail.roleVet')
    return role
  }
  // Who wrote a note (#68): stored name, else the demo persona for demo accounts, else the
  // e-mail's local part. Never "anonymous" or a raw e-mail address.
  const noteAuthor = (n: { author_name?: string | null; author_subject: string; author_role: string }) => {
    if (n.author_name?.trim()) return n.author_name.trim()
    const persona = USERS[n.author_role as keyof typeof USERS]
    if (persona && (n.author_subject.endsWith('@demo.local') || n.author_subject === 'anonymous')) return persona.name
    return n.author_subject.split('@')[0]
  }

  const statusLabel = (status: string) => {
    if (status === 'OPEN') return t('cases.detail.statusOpen')
    if (status === 'ANSWERED') return t('cases.detail.statusAnswered')
    if (status === 'CLOSED') return t('cases.detail.statusClosed')
    return status
  }

  // The vet <-> radiologist channel (#70): a vet always asks the radiologist, a radiologist the vet.
  const askInfo = async () => {
    if (!infoBody.trim() || !caseKey.startsWith('case-')) return
    const target = isExpert ? 'vet' : 'expert'
    setBusy(true)
    try {
      await createCaseInfoRequest(caseKey, {
        body: infoBody.trim(),
        to_role: target,
      })
      setInfoBody('')
      pushToast({
        tone: 'info',
        title:
          target === 'expert'
            ? t('cases.detail.toastExpertQuestionSent')
            : t('cases.detail.toastInfoRequestOpened'),
      })
      await refresh()
    } catch (e) {
      pushToast({ tone: 'error', title: t('cases.detail.toastRequestFailed'), body: toastErrorBody(e, t) })
    } finally {
      setBusy(false)
    }
  }


  return (
    <div>
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader title={t('cases.detail.patient')} icon={<ClipboardList className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2">
              <Row k={t('reports.doc.name')} v={p.name} />
              <Row k={t('cases.detail.rowSpeciesBreed')} v={`${p.species} · ${p.breed}`} />
              <Row k={t('cases.detail.rowSex')} v={`${p.sex}, ${p.neutered ? t('cases.detail.neutered') : t('cases.detail.intact')}`} />
              <Row k={t('cases.detail.rowAgeWeight')} v={t('cases.detail.ageWeight', { age: p.age, weight: p.weight })} />
              <Row k={t('reports.doc.owner')} v={savedOwnerName || '—'} />
              {c.vetEmailDeliveryStatus ? (
                <Row
                  k={t('reports.doc.delivery')}
                  v={
                    c.vetEmailDeliveryStatus === 'sent'
                      ? t('reportEmail.sent')
                      : c.vetEmailDeliveryStatus === 'failed'
                        ? t('reportEmail.failed')
                        : c.vetEmailDeliveryStatus === 'not_configured'
                          ? t('reportEmail.notConfigured')
                          : t('reportEmail.skipped')
                  }
                />
              ) : null}
              <Row k={t('cases.detail.rowClinicVet')} v={[displayClinic(c.clinic), c.vetName].filter(Boolean).join(' · ') || '—'} />
              <Row k={t('cases.detail.rowPriorityAssign')} v={`${c.priority}${c.assignedReviewerId ? ` · ${reviewerDisplay(c, t)}` : ''}`} />
            </dl>
            {isVet && c.fromBackend && caseKey.startsWith('case-') && (
              <div className="space-y-3 border-t border-slate-100 px-5 py-4">
                {!savedOwnerName ? <p className="text-xs text-slate-500">{t('ownerContact.legacyHint')}</p> : null}
                <OwnerNameField value={ownerDraft} onChange={setOwnerDraft} disabled={ownerBusy} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={ownerBusy || ownerDraft.trim() === savedOwnerName.trim()}
                    onClick={() => {
                      void (async () => {
                        setOwnerBusy(true)
                        try {
                          await updateCaseOwner(caseKey, { owner_name: ownerDraft.trim() || null })
                          await hydrateBackendCase(caseKey)
                          setExtrasTick((n) => n + 1)
                          pushToast({ tone: 'success', title: t('ownerContact.attached') })
                        } catch (e) {
                          pushToast({
                            tone: 'error',
                            title: t('ownerContact.attachTitle'),
                            body: toastErrorBody(e, t),
                          })
                        } finally {
                          setOwnerBusy(false)
                        }
                      })()
                    }}
                  >
                    {t('ownerContact.attachSave')}
                  </Button>
                  {c.status === 'onaylandi' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={ownerBusy}
                      onClick={() => {
                        void (async () => {
                          setOwnerBusy(true)
                          try {
                            await revokeCaseReportViewLinks(caseKey)
                            await hydrateBackendCase(caseKey)
                            pushToast({ tone: 'success', title: t('ownerContact.revoked') })
                          } catch (e) {
                            pushToast({
                              tone: 'error',
                              title: t('ownerContact.revokeLinks'),
                              body: toastErrorBody(e, t),
                            })
                          } finally {
                            setOwnerBusy(false)
                          }
                        })()
                      }}
                    >
                      {t('ownerContact.revokeLinks')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title={t('cases.detail.clinicalInfo')} icon={<Stethoscope className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2">
              <Row k={t('cases.detail.rowComplaint')} v={cleanClinicalHistory(c.clinical.complaint) || '—'} />
              <Row k={t('cases.detail.rowOnset')} v={c.clinical.onset} />
              <Row k={t('cases.detail.rowCourse')} v={c.clinical.course} />
              <Row k={t('cases.detail.rowHistory')} v={cleanClinicalHistory(c.clinical.history) || '—'} />
              <Row k={t('cases.detail.rowMedications')} v={c.clinical.medications || '—'} />
              {c.handoffNotes ? <Row k={t('cases.detail.rowHandoffNotes')} v={c.handoffNotes} /> : null}
            </dl>
            {(isVet || isExpert) && c.fromBackend && caseKey.startsWith('case-') && (
              <div className="space-y-2 border-t border-slate-100 px-5 py-3" data-testid="clinical-notes">
                <div>
                  <p className="text-sm font-semibold text-navy-900">{t('cases.detail.clinicalNotesTitle')}</p>
                  <p className="text-xs text-slate-500">{t('cases.detail.clinicalNotesHint')}</p>
                </div>
                {(backendExtras?.clinical_notes_log || []).length > 0 && (
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {backendExtras!.clinical_notes_log!.map((n) => (
                      <li key={n.note_id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" data-testid="clinical-note">
                        <p className="whitespace-pre-wrap text-sm text-navy-900">{n.body}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {noteAuthor(n)} · {roleLabel(n.author_role)} · {fmtDateTimeLocal(n.created_at, locale)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="block text-xs text-slate-600">
                  {t('cases.detail.addClinicalNote')}
                  <textarea
                    className="input mt-1 min-h-[64px] text-sm"
                    data-testid="clinical-note-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('cases.detail.clinicalNotePlaceholder')}
                  />
                </label>
                <Button size="sm" disabled={busy || !note.trim()} onClick={() => void addNote()} data-testid="clinical-note-save">
                  {t('cases.detail.saveClinicalNote')}
                </Button>
              </div>
            )}
          </Card>
        </div>
        {(isVet || isExpert) && c.fromBackend && caseKey.startsWith('case-') && (
          <Card>
            <CardHeader
              title={isExpert ? t('cases.detail.qaTitleExpert') : t('cases.detail.qaTitleVet')}
              subtitle={isExpert ? t('cases.detail.qaHintExpert') : t('cases.detail.qaHintVet')}
              icon={<Info className="h-5 w-5" />}
            />
            <div className="space-y-3 px-5 pb-5">
              <label className="block text-xs text-slate-600">
                {isExpert ? t('cases.detail.askVet') : t('cases.detail.askExpert')}
                <input
                  className="input mt-1 text-sm"
                  data-testid="info-request-input"
                  value={infoBody}
                  onChange={(e) => setInfoBody(e.target.value)}
                  placeholder={isExpert ? t('cases.detail.requestPlaceholder') : t('cases.detail.expertQuestionPlaceholder')}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="info-request-send"
                  disabled={busy || !infoBody.trim()}
                  onClick={() => void askInfo()}
                >
                  {isExpert ? t('cases.detail.openRequest') : t('cases.detail.sendToExpert')}
                </Button>
              </div>
              <ul className="space-y-2 text-xs">
                {(backendExtras?.info_requests || []).map((r) => (
                  <li key={r.request_id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="font-medium text-navy-900">
                      {t('cases.detail.requestMeta', {
                        status: statusLabel(r.status),
                        role: roleLabel(r.to_role),
                      })}
                    </p>
                    <p className="mt-0.5 text-navy-900">{r.body}</p>
                    {r.reply ? <p className="text-teal-800">{t('cases.detail.replyLabel')} {r.reply}</p> : null}
                    {r.status === 'OPEN' && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <input
                          className="input flex-1 text-sm"
                          placeholder={t('cases.detail.replyPlaceholder')}
                          value={replyDraft[r.request_id] || ''}
                          onChange={(e) => setReplyDraft((prev) => ({ ...prev, [r.request_id]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          disabled={busy || !(replyDraft[r.request_id] || '').trim()}
                          onClick={() =>
                            void replyCaseInfoRequest(caseKey, r.request_id, replyDraft[r.request_id].trim())
                              .then(() => refresh())
                              .then(() => pushToast({ tone: 'success', title: t('cases.detail.toastReplySaved') }))
                              .catch((e) =>
                                pushToast({
                                  tone: 'error',
                                  title: t('cases.detail.toastReplyFailed'),
                                  body: toastErrorBody(e, t),
                                }),
                              )
                          }
                        >
                          {t('cases.detail.reply')}
                        </Button>
                      </div>
                    )}
                    {(r.status === 'ANSWERED' || r.status === 'OPEN') && (
                      <button
                        type="button"
                        className="mt-1 text-teal-700 hover:underline"
                        onClick={() =>
                          void closeCaseInfoRequest(caseKey, r.request_id)
                            .then(() => refresh())
                            .then(() => pushToast({ tone: 'info', title: t('cases.detail.toastRequestClosed') }))
                        }
                      >
                        {t('cases.detail.closeRequest')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title={t('cases.detail.imagingClassification')} icon={<ImageIcon className="h-5 w-5" />} />
          <dl className="divide-y divide-slate-50 px-5 py-2">
            <Row k={t('cases.detail.rowModalityRegion')} v={studyLabel(t, c.modality, c.anatomicalRegion) || '—'} />
            <Row
              k={t('cases.detail.rowSeriesImages')}
              v={
                c.seriesCount != null || c.instanceCount != null
                  ? t('cases.detail.seriesImages', { series: c.seriesCount ?? '—', images: c.instanceCount ?? '—' })
                  : '—'
              }
            />
          </dl>
        </Card>
        <Card>
          <CardHeader title={t('cases.detail.neuroExam')} icon={<Brain className="h-5 w-5" />} action={loc && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">{t('cases.detail.likelyLocalization')} {loc.region}</span>} />
          {isNeuroExamEmpty(n) ? (
            <p className="px-5 py-4 text-sm font-medium text-amber-700">{t('cases.detail.neuroNotEntered')}</p>
          ) : (
            <div className="grid gap-x-8 px-5 py-2 md:grid-cols-2">
              <dl className="divide-y divide-slate-50">
                <Row k={t('cases.detail.rowConsciousness')} v={item(n.consciousness)} />
                <Row k={t('cases.detail.rowGait')} v={<>{item(n.gait)}{n.limbs.length ? ` — ${n.limbs.join(', ')}` : ''}</>} />
                <Row k={t('cases.detail.rowPostural')} v={<>{item(n.posturalThoracic)} / {item(n.posturalPelvic)}</>} />
                <Row k={t('cases.detail.rowReflexes')} v={<>{item(n.reflexThoracic)} / {item(n.reflexPelvic)}</>} />
              </dl>
              <dl className="divide-y divide-slate-50">
                <Row k={t('cases.detail.rowCranialNerves')} v={item(cranialNervesText(n, NOT_EVALUATED))} />
                <Row k={t('cases.detail.rowDeepPain')} v={item(n.deepPain)} />
                <Row k={t('cases.detail.rowHyperesthesia')} v={item(n.hyperesthesia)} />
              </dl>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
