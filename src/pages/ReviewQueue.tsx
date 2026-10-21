import { Info } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { QueueList } from './Dashboard'

export default function ReviewQueue() {
  const { cases } = useApp()
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde')
  return (
    <>
      <PageHeader title="Onay Kuyruğu" subtitle="AI tarafından hazırlanan ve uzman onayı bekleyen rapor taslakları" />
      <Card>
        <CardHeader title={`${queue.length} rapor bekliyor`} subtitle="Acil vakalar en üstte listelenir" />
        <QueueList items={queue} />
      </Card>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" /> Hiçbir AI taslağı uzman onayı olmadan hekime veya hayvan sahibine iletilmez.
      </p>
    </>
  )
}
