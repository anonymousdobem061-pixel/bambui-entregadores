import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Status = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type Priority = 'normal' | 'high'
type Profile = { id: string; full_name: string; role: 'admin' | 'courier'; active: boolean }
type Store = { id: string; name: string; address: string | null; phone: string | null }
type Delivery = {
  id: string
  order_code: string
  customer_name: string
  customer_phone: string | null
  delivery_address: string
  notes: string
  cancellation_reason: string | null
  confirmation_code: string | null
  priority: Priority
  status: Status
  store_id: string | null
  courier_id: string | null
  scheduled_for: string | null
  created_at: string
}
type DeliveryMessage = { id: string; author_id: string; body: string; created_at: string }
type DeliveryView = 'all' | 'today' | 'scheduled' | 'unassigned' | 'overdue' | Status

const projectUrl = 'https://quxgxxffiobgqlotpfnl.supabase.co'
const publishableKey = 'sb_publishable_mxo_SkEaEzkRKQ9jOLgjlQ_fiOIaZvl'
const supabase = createClient(projectUrl, publishableKey)

const statusName: Record<Status, string> = {
  pending: 'Aguardando',
  in_progress: 'Em rota',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}

const priorityName: Record<Priority, string> = {
  normal: 'Normal',
  high: 'Prioridade alta',
}

const scheduleValue = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : ''

const inputScheduleValue = (value: string | null) =>
  value
    ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : ''

const scheduleForDatabase = (value: FormDataEntryValue | null) => {
  const date = typeof value === 'string' && value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

const isToday = (value: string) => {
  const date = new Date(value)
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

const isTodayDelivery = (item: Delivery) => isToday(item.scheduled_for ?? item.created_at)
const isFuture = (value: string | null) =>
  Boolean(value && new Date(value).getTime() > new Date().getTime())

const isOverdue = (item: Delivery) =>
  Boolean(
    item.scheduled_for &&
      new Date(item.scheduled_for).getTime() < new Date().getTime() &&
      item.status !== 'completed' &&
      item.status !== 'cancelled',
  )

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [couriers, setCouriers] = useState<Profile[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async (userId: string) => {
    setLoading(true)

    const me = await supabase
      .from('profiles')
      .select('id,full_name,role,active')
      .eq('id', userId)
      .maybeSingle()

    if (me.error || !me.data) {
      setNotice('Seu usuário ainda não possui perfil no aplicativo.')
      setLoading(false)
      return
    }

    const current = me.data as Profile
    setProfile(current)

    if (!current.active) {
      setNotice('Seu perfil está inativo.')
      setLoading(false)
      return
    }

    const [deliveryData, storeData, courierData] = await Promise.all([
      supabase
        .from('deliveries')
        .select(
          'id,order_code,customer_name,customer_phone,delivery_address,notes,cancellation_reason,confirmation_code,priority,status,store_id,courier_id,scheduled_for,created_at',
        )
        .order('created_at', { ascending: false }),
      supabase.from('stores').select('id,name,address,phone').eq('active', true).order('name'),
      current.role === 'admin'
        ? supabase
            .from('profiles')
            .select('id,full_name,role,active')
            .eq('role', 'courier')
            .order('full_name')
        : Promise.resolve({ data: [], error: null }),
    ])

    if (deliveryData.error) {
      setNotice(`Não foi possível carregar as entregas: ${deliveryData.error.message}`)
    } else {
      setDeliveries((deliveryData.data ?? []) as Delivery[])
    }

    if (!storeData.error) setStores((storeData.data ?? []) as Store[])
    if (!courierData.error) setCouriers((courierData.data ?? []) as Profile[])

    setLoading(false)
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) void load(data.session.user.id)
      else setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setProfile(null)
      setDeliveries([])

      if (next) void load(next.user.id)
      else setLoading(false)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  if (!session) return <Login onNotice={setNotice} notice={notice} />
  if (loading) return <Message title="Bambuí Entregadores" text="Carregando…" />
  if (!profile?.active) {
    return <Message title="Acesso indisponível" text={notice || 'Perfil não encontrado.'} signOut />
  }

  return (
    <Home
      profile={profile}
      deliveries={deliveries}
      stores={stores}
      couriers={couriers}
      reload={() => void load(session.user.id)}
      notice={notice}
      setNotice={setNotice}
    />
  )
}

function Message({ title, text, signOut }: { title: string; text: string; signOut?: boolean }) {
  return (
    <main className="message">
      <div className="logo">B</div>
      <h1>{title}</h1>
      <p>{text}</p>
      {signOut && <button onClick={() => void supabase.auth.signOut()}>Sair</button>}
    </main>
  )
}

function Login({ onNotice, notice }: { onNotice: (value: string) => void; notice: string }) {
  const [sending, setSending] = useState(false)

  const enter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSending(true)
    onNotice('')

    const values = new FormData(event.currentTarget)
    const { error } = await supabase.auth.signInWithPassword({
      email: String(values.get('email')),
      password: String(values.get('password')),
    })

    if (error) onNotice(`Não foi possível entrar: ${error.message}`)
    setSending(false)
  }

  return (
    <main className="login">
      <section>
        <div className="logo">B</div>
        <span>BAMBUÍ ENTREGADORES</span>
        <h1>Seu dia começa aqui.</h1>
        <p>Entre para acompanhar ou realizar suas entregas.</p>

        <form onSubmit={enter}>
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Senha<input name="password" type="password" required /></label>
          {notice && <b className="error">{notice}</b>}
          <button disabled={sending}>{sending ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  )
}
