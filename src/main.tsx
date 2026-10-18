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









function Home({
  profile, deliveries, stores, couriers, reload, notice, setNotice,
}: {
  profile: Profile
  deliveries: Delivery[]
  stores: Store[]
  couriers: Profile[]
  reload: () => void
  notice: string
  setNotice: (value: string) => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [storesOpen, setStoresOpen] = useState(false)
  const [couriersOpen, setCouriersOpen] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null)
  const [contactDelivery, setContactDelivery] = useState<Delivery | null>(null)
  const [filter, setFilter] = useState<DeliveryView>('all')
  const [search, setSearch] = useState('')
  const isAdmin = profile.role === 'admin'

  const unassignedCount = deliveries.filter(
    item => !item.courier_id && item.status !== 'completed' && item.status !== 'cancelled',
  ).length

  const overdueCount = deliveries.filter(isOverdue).length

  const shown = deliveries
    .filter(item => {
      if (filter === 'today' && !isTodayDelivery(item)) return false
      if (filter === 'scheduled' && !isFuture(item.scheduled_for)) return false
      if (
        filter === 'unassigned' &&
        (item.courier_id || item.status === 'completed' || item.status === 'cancelled')
      ) return false
      if (filter === 'overdue' && !isOverdue(item)) return false
      if (
        filter !== 'all' &&
        filter !== 'today' &&
        filter !== 'scheduled' &&
        filter !== 'unassigned' &&
        filter !== 'overdue' &&
        item.status !== filter
      ) return false

      const term = search.trim().toLocaleLowerCase('pt-BR')
      return (
        !term ||
        [item.order_code, item.customer_name, item.delivery_address, item.customer_phone ?? '']
          .some(value => value.toLocaleLowerCase('pt-BR').includes(term))
      )
    })
    .sort((left, right) => Number(right.priority === 'high') - Number(left.priority === 'high'))

  const totals = useMemo(() => {
    const today = deliveries.filter(isTodayDelivery)
    return {
      pending: today.filter(item => item.status === 'pending').length,
      moving: today.filter(item => item.status === 'in_progress').length,
      done: today.filter(item => item.status === 'completed').length,
    }
  }, [deliveries])

  const updateStatus = async (delivery: Delivery) => {
    const next: Status | null =
      delivery.status === 'pending'
        ? 'in_progress'
        : delivery.status === 'in_progress'
          ? 'completed'
          : null

    if (!next) return

    if (next === 'completed' && delivery.confirmation_code) {
      const typedCode = window
        .prompt('Peça ao cliente o código de confirmação de 4 dígitos.')
        ?.trim()

      if (typedCode !== delivery.confirmation_code) {
        setNotice('Código de confirmação incorreto. A entrega continua em rota.')
        return
      }
    }

    const { error } = await supabase
      .from('deliveries')
      .update({ status: next })
      .eq('id', delivery.id)

    if (error) {
      setNotice(`Não foi possível atualizar: ${error.message}`)
      return
    }

    reload()
  }

  return (
    <main className="shell">
      <header>
        <div className="logo">B</div>
        <div className="heading">
          <span>BAMBUÍ ENTREGADORES</span>
          <h1>{isAdmin ? 'Visão de hoje' : `Olá, ${profile.full_name || 'entregador'}`}</h1>
        </div>
        <button className="ghost" onClick={() => void supabase.auth.signOut()}>Sair</button>
      </header>

      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice('')}>×</button>
        </div>
      )}

      <section className="greeting">
        <div>
          <b>{isAdmin ? 'Tudo sob controle.' : 'Boa rota!'}</b>
          <p>
            {isAdmin
              ? 'Acompanhe os pedidos da cidade em um só lugar.'
              : 'Veja os pedidos atribuídos a você e avance o status.'}
          </p>
        </div>
        <span>🏍️</span>
      </section>

      <section className="numbers">
        <Metric title="Aguardando" value={totals.pending} />
        <Metric title="Em rota" value={totals.moving} />
        <Metric title="Concluídas" value={totals.done} />
      </section>

      <label className="search">
        🔎
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Buscar por cliente, endereço ou código"
        />
      </label>

      <section className="commands">
        <div className="tabs">
          {(['today', 'scheduled', 'all', 'pending', 'in_progress', 'completed'] as const).map(value => (
            <button
              key={value}
              className={filter === value ? 'tab active' : 'tab'}
              onClick={() => setFilter(value)}
            >
              {value === 'all'
                ? 'Todas'
                : value === 'today'
                  ? 'Hoje'
                  : value === 'scheduled'
                    ? 'Agendadas'
                    : statusName[value]}
            </button>
          ))}
        </div>

        <div className="actions">
          {isAdmin && (
            <button
              className={filter === 'overdue' ? 'danger' : 'ghost'}
              onClick={() => setFilter('overdue')}
            >
              Atrasadas{overdueCount ? ` (${overdueCount})` : ''}
            </button>
          )}

          {isAdmin && (
            <button
              className={filter === 'unassigned' ? 'tab active' : 'ghost'}
              onClick={() => setFilter('unassigned')}
            >
              Sem entregador{unassignedCount ? ` (${unassignedCount})` : ''}
            </button>
          )}

          {isAdmin && <button className="ghost" onClick={() => setStoresOpen(true)}>Lojas</button>}
          {isAdmin && <button className="ghost" onClick={() => setCouriersOpen(true)}>Entregadores</button>}
          {isAdmin && <button onClick={() => setFormOpen(true)}>Nova entrega</button>}
          <button className="ghost" onClick={reload}>Atualizar</button>
        </div>
      </section>

      {formOpen && (
        <DeliveryForm
          owner={profile.id}
          stores={stores}
          couriers={couriers}
          close={() => setFormOpen(false)}
          saved={() => { setFormOpen(false); reload() }}
          showError={setNotice}
        />
      )}

      {storesOpen && (
        <StoreManager
          stores={stores}
          close={() => setStoresOpen(false)}
          saved={reload}
          showError={setNotice}
        />
      )}

      {couriersOpen && (
        <CourierManager
          couriers={couriers}
          close={() => setCouriersOpen(false)}
          saved={reload}
          showError={setNotice}
        />
      )}

      {editingDelivery && (
        <DeliveryEditor
          item={editingDelivery}
          stores={stores}
          couriers={couriers}
          close={() => setEditingDelivery(null)}
          saved={() => { setEditingDelivery(null); reload() }}
          showError={setNotice}
        />
      )}

      {contactDelivery && (
        <ContactPanel
          item={contactDelivery}
          viewerId={profile.id}
          close={() => setContactDelivery(null)}
          showError={setNotice}
        />
      )}

      <section className="deliveries">
        {shown.length === 0 ? (
          <div className="empty">Nenhuma entrega nesta lista.</div>
        ) : (
          shown.map(delivery => (
            <Card
              key={delivery.id}
              item={delivery}
              store={stores.find(store => store.id === delivery.store_id)}
              courier={couriers.find(courier => courier.id === delivery.courier_id)}
              isAdmin={isAdmin}
              advance={() => void updateStatus(delivery)}
              edit={() => setEditingDelivery(delivery)}
              contact={() => setContactDelivery(delivery)}
            />
          ))
        )}
      </section>
    </main>
  )
}

function Metric({ title, value }: { title: string; value: number }) {
  return <article className="number"><small>{title}</small><strong>{value}</strong></article>
}

function Card({
  item, store, courier, isAdmin, advance, edit, contact,
}: {
  item: Delivery
  store?: Store
  courier?: Profile
  isAdmin: boolean
  advance: () => void
  edit: () => void
  contact: () => void
}) {
  const canAdvance = item.status === 'pending' || item.status === 'in_progress'

  return (
    <article className="card">
      <div className="card-head">
        <span className={`pill ${item.status}`}>{statusName[item.status]}</span>
        <small>{item.order_code}</small>
      </div>

      <h2>{item.customer_name}</h2>
      {item.priority === 'high' && <p className="priority">⚡ Prioridade alta</p>}
      {isOverdue(item) && <p className="cancel-reason">⚠ Entrega atrasada</p>}
      <p>📍 {item.delivery_address}</p>
      {item.scheduled_for && <p>🗓️ Agendada: {scheduleValue(item.scheduled_for)}</p>}
      {store && <p>🏪 {store.name}</p>}
      {isAdmin && <p>🛵 {courier?.full_name || 'Sem entregador'}</p>}

      {isAdmin && item.confirmation_code && item.status !== 'completed' && item.status !== 'cancelled' && (
        <p className="confirmation-code">
          🔐 Código para concluir: <b>{item.confirmation_code}</b>
        </p>
      )}

      {item.notes && <p className="notes">{item.notes}</p>}
      {item.status === 'cancelled' && item.cancellation_reason && (
        <p className="cancel-reason">Cancelamento: {item.cancellation_reason}</p>
      )}

      <footer>
        <button className="ghost" onClick={contact}>Contato</button>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.delivery_address)}`}
          target="_blank"
          rel="noreferrer"
        >
          Abrir rota
        </a>
        {isAdmin && <button className="ghost" onClick={edit}>Editar</button>}
        {canAdvance && (
          <button onClick={advance}>
            {item.status === 'pending' ? 'Iniciar' : 'Concluir'}
          </button>
        )}
      </footer>
    </article>
  )
}
