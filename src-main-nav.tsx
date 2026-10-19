
import { FormEvent, useEffect, useMemo, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { createClient, type Session } from '@supabase/supabase-js'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Status = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type Priority = 'normal' | 'high'
type Profile = { id: string; full_name: string; role: 'admin' | 'courier'; active: boolean; store_id: string | null; is_online?: boolean }
type Store = { id: string; name: string; address: string | null; phone: string | null }
type Delivery = { id: string; order_code: string; customer_name: string; customer_phone: string | null; delivery_address: string; notes: string; cancellation_reason: string | null; pickup_code: string | null; confirmation_code: string | null; customer_access_token: string | null; accepted_at: string | null; collected_at: string | null; arrived_at: string | null; completed_at: string | null; priority: Priority; status: Status; store_id: string | null; courier_id: string | null; scheduled_for: string | null; created_at: string }
type CustomerDelivery = { order_code: string; customer_name: string; status: Status; confirmation_code: string | null }
type DeliveryMessage = { id: string; author_id: string; body: string; created_at: string }
type DeliveryView = 'all' | 'today' | 'scheduled' | 'unassigned' | 'overdue' | Status

const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!projectUrl || !publishableKey) {
  throw new Error(
    'Configuração do Supabase ausente. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY ' +
    '(veja env.example). Em desenvolvimento use .env.local; na Vercel configure as mesmas variáveis.'
  )
}

const supabase = createClient(projectUrl, publishableKey)

type LatLng = { lat: number; lng: number }
type RouteInfo = { distance: number; duration: number; geometry: LatLng[]; steps: string[] }

const geocode = async (address: string): Promise<LatLng | null> => {
  const q = encodeURIComponent(address + ', Brasil')
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`, {
    headers: { 'Accept': 'application/json' }
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.[0]) return null
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) }
}

const fetchRoute = async (from: LatLng, to: LatLng): Promise<RouteInfo | null> => {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const route = data?.routes?.[0]
  if (!route) return null
  const geometry = (route.geometry?.coordinates ?? []).map((c: number[]) => ({ lat: c[1], lng: c[0] }))
  const steps = (route.legs?.[0]?.steps ?? []).map((s: { maneuver?: { instruction?: string } }) => s.maneuver?.instruction || 'Siga em frente')
  return { distance: route.distance, duration: route.duration, geometry, steps }
}

const formatDistance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
const formatDuration = (s: number) => {
  const min = Math.round(s / 60)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

const requestLocation = (): Promise<GeolocationPosition | null> =>
  new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    )
  })

const statusName: Record<Status, string> = {
  pending: 'Aguardando',
  in_progress: 'Em rota',
  completed: 'Concluída',
  cancelled: 'Cancelada'
}

const priorityName: Record<Priority, string> = {
  normal: 'Normal',
  high: 'Prioridade alta'
}

const scheduleValue = (value: string | null) =>
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''

const inputScheduleValue = (value: string | null) =>
  value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''

const scheduleForDatabase = (value: FormDataEntryValue | null) => {
  const date = typeof value === 'string' && value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

const isToday = (value: string) => {
  const date = new Date(value)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
}

const isTodayDelivery = (item: Delivery) => isToday(item.scheduled_for ?? item.created_at)
const isFuture = (value: string | null) => Boolean(value && new Date(value).getTime() > new Date().getTime())

const isOverdue = (item: Delivery) =>
  Boolean(item.scheduled_for &&
    new Date(item.scheduled_for).getTime() < new Date().getTime() &&
    item.status !== 'completed' &&
    item.status !== 'cancelled')

function App() {
  const customerToken = new URLSearchParams(window.location.search).get('cliente')
  if (customerToken) return <CustomerConfirmation token={customerToken} />

  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [couriers, setCouriers] = useState<Profile[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async (userId: string) => {
    const { data: current, error: profileError } = await supabase
      .from('profiles')
      .select('id,full_name,role,active,store_id,is_online')
      .eq('id', userId)
      .single()

    if (profileError || !current) {
      setProfile(null)
      setNotice(
        profileError
          ? `Não foi possível carregar o perfil: ${profileError.message}`
          : 'Perfil não encontrado.'
      )
      setLoading(false)
      return
    }

    setProfile(current as Profile)

    if (!current.active) {
      setNotice('Seu perfil está inativo.')
      setLoading(false)
      return
    }

    const [deliveryData, storeData, courierData] = await Promise.all([
      supabase
        .from('deliveries')
        .select('id,order_code,customer_name,customer_phone,delivery_address,notes,cancellation_reason,pickup_code,confirmation_code,customer_access_token,accepted_at,collected_at,arrived_at,completed_at,priority,status,store_id,courier_id,scheduled_for,created_at')
        .order('created_at', { ascending: false }),

      supabase
        .from('stores')
        .select('id,name,address,phone')
        .order('name'),

      current.role === 'admin'
        ? supabase
            .from('profiles')
            .select('id,full_name,role,active,store_id,is_online')
            .eq('role', 'courier')
            .order('full_name')
        : Promise.resolve({ data: [], error: null })
    ])

    if (deliveryData.error) {
      setNotice(`Não foi possível carregar as entregas: ${deliveryData.error.message}`)
    } else {
      setDeliveries((deliveryData.data ?? []) as Delivery[])
    }

    if (storeData.error) {
      setNotice(`Não foi possível carregar as lojas: ${storeData.error.message}`)
    } else {
      setStores((storeData.data ?? []) as Store[])
    }

    if (courierData.error) {
      setNotice(`Não foi possível carregar os entregadores: ${courierData.error.message}`)
    } else {
      setCouriers((courierData.data ?? []) as Profile[])
    }

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
  if (!profile?.active) return <Message title="Acesso indisponível" text={notice || 'Perfil não encontrado.'} signOut />
  if (profile.store_id) return <StoreHome profile={profile} deliveries={deliveries} reload={() => void load(session.user.id)} notice={notice} setNotice={setNotice} />

  return <Home
    profile={profile}
    deliveries={deliveries}
    stores={stores}
    couriers={couriers}
    reload={() => void load(session.user.id)}
    notice={notice}
    setNotice={setNotice}
  />
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

function CustomerConfirmation({ token }: { token: string }) {
  const [delivery, setDelivery] = useState<CustomerDelivery | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void supabase.rpc('customer_delivery_confirmation', { access_token: token }).then(({ data, error: requestError }) => {
      if (requestError || !data?.[0]) {
        setError('Este link não é válido ou não está mais disponível.')
        return
      }
      setDelivery(data[0] as CustomerDelivery)
    })
  }, [token])

  if (error) return <Message title="Link indisponível" text={error} />
  if (!delivery) return <Message title="Bambuí Entregadores" text="Carregando pedido…" />

  return (
    <main className="message">
      <div className="logo">B</div>
      <h1>Seu código de entrega</h1>
      <p>Pedido {delivery.order_code} para {delivery.customer_name}.</p>
      {delivery.status === 'completed'
        ? <p>Esta entrega já foi concluída.</p>
        : delivery.status === 'cancelled'
          ? <p>Esta entrega foi cancelada.</p>
          : <>
              <strong className="delivery-code">{delivery.confirmation_code ?? '----'}</strong>
              <p>Informe este código somente ao entregador, no momento da entrega.</p>
            </>}
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
      password: String(values.get('password'))
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
          <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          {notice && <b className="error">{notice}</b>}
          <button disabled={sending}>{sending ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  )
}

function StoreHome({ profile, deliveries, reload, notice, setNotice }: {
  profile: Profile
  deliveries: Delivery[]
  reload: () => void
  notice: string
  setNotice: (value: string) => void
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [online, setOnline] = useState(false)
  const [onlineSync, setOnlineSync] = useState<'idle' | 'saving' | 'error'>('idle')
  const waiting = deliveries.filter(item => item.status === 'pending' && item.accepted_at)

  useEffect(() => {
    setOnline(Boolean(profile.is_online))
  }, [profile.is_online])

  const toggleOnline = async () => {
    const next = !online
    setOnlineSync('saving')
    const { error } = await supabase.from('profiles').update({ is_online: next }).eq('id', profile.id)
    if (error) {
      setOnlineSync('error')
      setNotice(`Não foi possível atualizar disponibilidade: ${error.message}`)
      return
    }
    setOnline(next)
    setOnlineSync('idle')
    reload()
  }

  useEffect(() => {
    const active = deliveries.find(d => d.courier_id === profile.id && d.status === 'in_progress')
    if (!active || !online) return
    if (!navigator.geolocation) return
    let lastSent = 0
    const watchId = navigator.geolocation.watchPosition(
      async pos => {
        const now = Date.now()
        if (now - lastSent < 20000) return
        lastSent = now
        const { error } = await supabase.from('courier_locations').upsert({
          courier_id: profile.id,
          delivery_id: active.id,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          updated_at: new Date().toISOString()
        })
        if (error) setNotice(`Falha ao enviar localização: ${error.message}`)
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [deliveries, online, profile.id])

  const confirmPickup = async (delivery: Delivery) => {
    const typedCode = window.prompt(`Informe o código de coleta do pedido ${delivery.order_code}.`)?.trim()
    if (!typedCode) return

    setConfirmingId(delivery.id)
    const { error } = await supabase.rpc('confirm_store_pickup', {
      p_delivery_id: delivery.id,
      p_pickup_code: typedCode
    })
    setConfirmingId(null)

    if (error) {
      setNotice(`Não foi possível confirmar a coleta: ${error.message}`)
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
          <h1>Coletas da loja</h1>
        </div>
        <button className="ghost" onClick={() => void supabase.auth.signOut()}>Sair</button>
      </header>

      <div className={`status-bar ${online ? 'online' : 'offline'}`}>
        <span><span className="dot" />{online ? 'Disponível para entregas' : 'Offline'}</span>
        <button className={online ? 'ghost' : ''} onClick={() => void toggleOnline()}>
          {onlineSync === 'saving' ? 'Salvando…' : online ? 'Ficar offline' : 'Ficar online'}
        </button>
      </div>

      {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}

      <section className="greeting">
        <div>
          <b>Pedidos aguardando coleta</b>
          <p>Confirme o código informado pela pessoa entregadora antes de liberar o pedido.</p>
        </div>
        <span>🏪</span>
      </section>

      <section className="deliveries">
        {waiting.length === 0
          ? <div className="empty">Nenhum pedido aguardando coleta.</div>
          : waiting.map(item => (
            <article className="card" key={item.id}>
              <div className="card-head">
                <span className="pill pending">Aguardando coleta</span>
                <small>{item.order_code}</small>
              </div>
              <h2>{item.customer_name}</h2>
              <p>📍 {item.delivery_address}</p>
              <p className="notes">Código esperado: <b>{item.pickup_code ?? 'Não informado'}</b></p>
              <footer>
                <button
                  disabled={confirmingId === item.id || !item.pickup_code}
                  onClick={() => void confirmPickup(item)}
                >
                  {confirmingId === item.id ? 'Confirmando…' : 'Confirmar coleta'}
                </button>
              </footer>
            </article>
          ))}
      </section>
    </main>
  )
}

function Home({ profile, deliveries, stores, couriers, reload, notice, setNotice }: {
  profile: Profile
  deliveries: Delivery[]
  stores: Store[]
  couriers: Profile[]
  reload: () => void
  notice: string
  setNotice: (value: string) => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [online, setOnline] = useState(false)
  const [onlineSync, setOnlineSync] = useState<'idle' | 'saving' | 'error'>('idle')
  const [myLocation, setMyLocation] = useState<GeolocationPosition | null>(null)
  const [gpsError, setGpsError] = useState('')
  const [tracking, setTracking] = useState(false)

  useEffect(() => {
    setOnline(Boolean(profile.is_online))
  }, [profile.is_online])

  const toggleOnline = async () => {
    const next = !online
    setOnlineSync('saving')
    const { error } = await supabase.from('profiles').update({ is_online: next }).eq('id', profile.id)
    if (error) {
      setOnlineSync('error')
      setNotice(`Não foi possível atualizar disponibilidade: ${error.message}. Estado continua ${online ? 'online' : 'offline'}.`)
      return
    }
    setOnline(next)
    setOnlineSync('idle')
    reload()
  }

  useEffect(() => {
    const channel = supabase.channel('deliveries-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => reload())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [reload])

  useEffect(() => {
    const active = deliveries.find(d => d.courier_id === profile.id && d.status === 'in_progress')
    if (!active || !online) {
      setTracking(false)
      return
    }
    if (!navigator.geolocation) {
      setGpsError('Geolocalização não suportada neste dispositivo.')
      return
    }
    setTracking(true)
    let lastSent = 0
    const watchId = navigator.geolocation.watchPosition(
      async pos => {
        setMyLocation(pos)
        const now = Date.now()
        if (now - lastSent < 20000) return
        lastSent = now
        const { error } = await supabase.from('courier_locations').upsert({
          courier_id: profile.id,
          delivery_id: active.id,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          updated_at: new Date().toISOString()
        })
        if (error) setGpsError(`Falha ao enviar localização: ${error.message}`)
        else setGpsError('')
      },
      err => setGpsError(err.message || 'Permissão de localização negada ou GPS indisponível.'),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
    )
    return () => {
      navigator.geolocation.clearWatch(watchId)
      setTracking(false)
    }
  }, [deliveries, online, profile.id])

  const refreshLocation = async () => {
    setGpsError('')
    const pos = await requestLocation()
    if (!pos) {
      setGpsError('Localização indisponível ou permissão negada.')
      return
    }
    setMyLocation(pos)
  }
  const [storesOpen, setStoresOpen] = useState(false)
  const [couriersOpen, setCouriersOpen] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null)
  const [contactDelivery, setContactDelivery] = useState<Delivery | null>(null)
  const [problemDelivery, setProblemDelivery] = useState<Delivery | null>(null)
  const [filter, setFilter] = useState<DeliveryView>('all')
  const [search, setSearch] = useState('')
  const isAdmin = profile.role === 'admin'

  const unassignedCount = deliveries.filter(item =>
    !item.courier_id && item.status !== 'completed' && item.status !== 'cancelled'
  ).length

  const overdueCount = deliveries.filter(isOverdue).length

  const shown = deliveries.filter(item => {
    if (filter === 'today' && !isTodayDelivery(item)) return false
    if (filter === 'scheduled' && !isFuture(item.scheduled_for)) return false
    if (filter === 'unassigned' && (item.courier_id || item.status === 'completed' || item.status === 'cancelled')) return false
    if (filter === 'overdue' && !isOverdue(item)) return false
    if (filter !== 'all' && filter !== 'today' && filter !== 'scheduled' && item.status !== filter) return false

    const term = search.trim().toLocaleLowerCase('pt-BR')
    return !term || [
      item.order_code,
      item.customer_name,
      item.delivery_address,
      item.customer_phone ?? ''
    ].some(value => value.toLocaleLowerCase('pt-BR').includes(term))
  }).sort((left, right) => Number(right.priority === 'high') - Number(left.priority === 'high'))

  const totals = useMemo(() => {
    const today = deliveries.filter(isTodayDelivery)
    return {
      pending: today.filter(item => item.status === 'pending').length,
      moving: today.filter(item => item.status === 'in_progress').length,
      done: today.filter(item => item.status === 'completed').length
    }
  }, [deliveries])

  const updateStatus = async (delivery: Delivery) => {
    if (delivery.status === 'pending' && !delivery.accepted_at) {
      const { error } = await supabase.from('deliveries')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', delivery.id)

      if (error) {
        setNotice(`Não foi possível aceitar: ${error.message}`)
        return
      }
      reload()
      return
    }

    if (delivery.status === 'pending') {
      setNotice('Aguarde a loja confirmar a coleta para iniciar a rota.')
      return
    }

    const next: Status | null = delivery.status === 'in_progress' ? 'completed' : null
    if (!next) return

    if (next === 'completed' && delivery.confirmation_code) {
      const typedCode = window.prompt('Peça ao cliente o código de confirmação de 4 dígitos.')?.trim()
      if (typedCode !== delivery.confirmation_code) {
        setNotice('Código de confirmação incorreto. A entrega continua em rota.')
        return
      }
    }

    const { error } = await supabase.from('deliveries')
      .update({ status: next, completed_at: new Date().toISOString() })
      .eq('id', delivery.id)

    if (error) {
      setNotice(`Não foi possível atualizar: ${error.message}`)
      return
    }
    reload()
  }

  const markArrived = async (delivery: Delivery) => {
    const { error } = await supabase.from('deliveries')
      .update({ arrived_at: new Date().toISOString() })
      .eq('id', delivery.id)

    if (error) {
      setNotice(`Não foi possível registrar a chegada: ${error.message}`)
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

      {!isAdmin && (
        <div className={`status-bar ${online ? 'online' : 'offline'}`}>
          <span><span className="dot" />{online ? 'Disponível para entregas' : 'Offline'}</span>
          <button className={online ? 'ghost' : ''} onClick={() => void toggleOnline()}>
            {onlineSync === 'saving' ? 'Salvando…' : online ? 'Ficar offline' : 'Ficar online'}
          </button>
        </div>
      )}

      {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}

      <section className="greeting">
        <div>
          <b>{isAdmin ? 'Tudo sob controle.' : 'Boa rota!'}</b>
          <p>{isAdmin ? 'Acompanhe os pedidos da cidade em um só lugar.' : 'Veja os pedidos atribuídos a você e avance o status.'}</p>
        </div>
        <span>🏍️</span>
      </section>

      {!isAdmin && (
        <div className="gps-status">
          <button className="ghost" onClick={() => void refreshLocation()}>Atualizar minha localização</button>
          {tracking && <span> · Rastreando entrega ativa</span>}{myLocation && <span> · precisão {myLocation.coords.accuracy.toFixed(0)} m</span>}
          {gpsError && <span> · {gpsError}</span>}
        </div>
      )}

      <section className="numbers">
        <Metric title="Aguardando" value={totals.pending} />
        <Metric title="Em rota" value={totals.moving} />
        <Metric title="Concluídas" value={totals.done} />
      </section>

      <label className="search">
        🔎 <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por cliente, endereço ou código" aria-label="Buscar entregas" />
      </label>

      <section className="commands">
        <div className="tabs">
          {(['today', 'scheduled', 'all', 'pending', 'in_progress', 'completed'] as const).map(value => (
            <button
              key={value}
              className={filter === value ? 'tab active' : 'tab'}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'Todas' : value === 'today' ? 'Hoje' : value === 'scheduled' ? 'Agendadas' : statusName[value]}
            </button>
          ))}
        </div>

        <div className="actions">
          {isAdmin && <button className={filter === 'overdue' ? 'danger' : 'ghost'} onClick={() => setFilter('overdue')}>Atrasadas{overdueCount ? ` (${overdueCount})` : ''}</button>}
          {isAdmin && <button className={filter === 'unassigned' ? 'tab active' : 'ghost'} onClick={() => setFilter('unassigned')}>Sem entregador{unassignedCount ? ` (${unassignedCount})` : ''}</button>}
          {isAdmin && <button className="ghost" onClick={() => setStoresOpen(true)}>Lojas</button>}
          {isAdmin && <button className="ghost" onClick={() => setCouriersOpen(true)}>Entregadores</button>}
          {isAdmin && <button onClick={() => setFormOpen(true)}>Nova entrega</button>}
          <button className="ghost" onClick={reload}>Atualizar</button>
        </div>
      </section>

      {formOpen && <DeliveryForm owner={profile.id} stores={stores} couriers={couriers} close={() => setFormOpen(false)} saved={() => { setFormOpen(false); reload() }} showError={setNotice} />}
      {storesOpen && <StoreManager stores={stores} close={() => setStoresOpen(false)} saved={reload} showError={setNotice} />}
      {couriersOpen && <CourierManager couriers={couriers} close={() => setCouriersOpen(false)} saved={reload} showError={setNotice} />}
      {editingDelivery && <DeliveryEditor item={editingDelivery} stores={stores} couriers={couriers} close={() => setEditingDelivery(null)} saved={() => { setEditingDelivery(null); reload() }} showError={setNotice} />}
      {contactDelivery && <ContactPanel item={contactDelivery} viewerId={profile.id} close={() => setContactDelivery(null)} showError={setNotice} />}
      {problemDelivery && <ProblemPanel item={problemDelivery} authorId={profile.id} close={() => setProblemDelivery(null)} saved={() => { setProblemDelivery(null); setNotice('Pedido de ajuda enviado para a equipe.') }} showError={setNotice} />}

      <section className="deliveries">
        {shown.length === 0
          ? <div className="empty">Nenhuma entrega nesta lista.</div>
          : shown.map(delivery => (
            <Card
              key={delivery.id}
              item={delivery}
              store={stores.find(store => store.id === delivery.store_id)}
              courier={couriers.find(courier => courier.id === delivery.courier_id)}
              isAdmin={isAdmin}
              advance={() => void updateStatus(delivery)}
              arrive={() => void markArrived(delivery)}
              edit={() => setEditingDelivery(delivery)}
              contact={() => setContactDelivery(delivery)}
              help={() => setProblemDelivery(delivery)}
            />
          ))}
      </section>
    </main>
  )
}

function Metric({ title, value }: { title: string; value: number }) {
  return <article className="number"><small>{title}</small><strong>{value}</strong></article>
}

function DeliveryTimeline({ item }: { item: Delivery }) {
  const steps = [
    { key: 'accepted', label: 'Aceita', done: Boolean(item.accepted_at), at: item.accepted_at },
    { key: 'collected', label: 'Coletada', done: Boolean(item.collected_at), at: item.collected_at },
    { key: 'moving', label: 'Em rota', done: item.status === 'in_progress' || item.status === 'completed', at: item.collected_at },
    { key: 'arrived', label: 'Chegou', done: Boolean(item.arrived_at), at: item.arrived_at },
    { key: 'done', label: 'Entregue', done: item.status === 'completed', at: item.completed_at }
  ]

  const currentIndex = steps.reduce((acc, step, index) => step.done ? index : acc, -1)

  return (
    <ol className="timeline" aria-label="Progresso da entrega">
      {steps.map((step, index) => {
        const state = step.done ? (index === currentIndex && item.status !== 'completed' ? 'current' : 'done') : 'todo'
        return (
          <li key={step.key} className={`timeline-step ${state}`}>
            <span className="timeline-dot" />
            <span className="timeline-label">{step.label}</span>
            {step.at && <small>{scheduleValue(step.at)}</small>}
          </li>
        )
      })}
    </ol>
  )
}


function CenterOn({ position }: { position: LatLng }) {
  const map = useMap()
  useEffect(() => { map.setView([position.lat, position.lng], map.getZoom()) }, [position, map])
  return null
}

function Navigation({ destination, onClose }: { destination: string; onClose: () => void }) {
  const [me, setMe] = useState<LatLng | null>(null)
  const [dest, setDest] = useState<LatLng | null>(null)
  const [route, setRoute] = useState<RouteInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const watchRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      setLoading(true)
      setError('')
      const destPos = await geocode(destination)
      if (cancelled) return
      if (!destPos) {
        setError('Não foi possível localizar o endereço de destino.')
        setLoading(false)
        return
      }
      setDest(destPos)
      if (!navigator.geolocation) {
        setError('Geolocalização não suportada.')
        setLoading(false)
        return
      }
      watchRef.current = navigator.geolocation.watchPosition(
        async pos => {
          const current = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setMe(current)
          const r = await fetchRoute(current, destPos)
          if (!cancelled) {
            setRoute(r)
            if (!r) setError('Serviço de rotas indisponível. O mapa mostra apenas a posição.')
            setLoading(false)
          }
        },
        err => {
          if (!cancelled) {
            setError(err.message || 'Permissão de localização negada.')
            setLoading(false)
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      )
    }
    void start()
    return () => {
      cancelled = true
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    }
  }, [destination])

  const center = me ?? dest ?? { lat: -20.0, lng: -45.97 }

  return (
    <div className="nav-overlay">
      <header className="nav-header">
        <button className="ghost" onClick={onClose}>Fechar</button>
        <div>
          <b>Navegação</b>
          <small>{destination}</small>
        </div>
      </header>
      <div className="nav-map">
        <MapContainer center={[center.lat, center.lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
          {me && <Marker position={[me.lat, me.lng]} icon={L.divIcon({ className: 'me-marker', html: '📍', iconSize: [24, 24] })} />}
          {dest && <Marker position={[dest.lat, dest.lng]} icon={L.divIcon({ className: 'dest-marker', html: '🏁', iconSize: [24, 24] })} />}
          {route && route.geometry.length > 1 && <Polyline positions={route.geometry.map(p => [p.lat, p.lng])} color="#e52335" weight={5} />}
          {me && <CenterOn position={me} />}
        </MapContainer>
      </div>
      <footer className="nav-footer">
        {loading && <p>Carregando rota…</p>}
        {error && <p className="error">{error}</p>}
        {route && (
          <>
            <div className="nav-stats">
              <span>{formatDistance(route.distance)}</span>
              <span>{formatDuration(route.duration)}</span>
            </div>
            {route.steps[0] && <p className="nav-step">{route.steps[0]}</p>}
          </>
        )}
      </footer>
    </div>
  )
}

function Card({ item, store, courier, isAdmin, advance, arrive, edit, contact, help }: {
  item: Delivery
  store?: Store
  courier?: Profile
  isAdmin: boolean
  advance: () => void
  arrive: () => void
  edit: () => void
  contact: () => void
  help: () => void
}) {
  const [navAddress, setNavAddress] = useState<string | null>(null)

  const canAdvance = item.status === 'in_progress' || (item.status === 'pending' && !item.accepted_at)
  const actionLabel = item.status === 'pending' ? 'Aceitar entrega' : 'Concluir'
  const routeToStore = item.status === 'pending' && Boolean(store?.address)
  const routeAddress = routeToStore ? store?.address ?? item.delivery_address : item.delivery_address

  return (
    <article className="card">
      <div className="card-head">
        <span className={`pill ${item.status}`}>{item.status === 'pending' && item.accepted_at ? 'Aguardando coleta da loja' : statusName[item.status]}</span>
        <small>{item.order_code}</small>
      </div>
      <h2>{item.customer_name}</h2>
      <DeliveryTimeline item={item} />
      {item.priority === 'high' && <p className="priority">⚡ {priorityName[item.priority]}</p>}
      {isOverdue(item) && <p className="cancel-reason">⚠ Entrega atrasada</p>}
      <p>📍 {item.delivery_address}</p>
      {store && <p>🏪 {store.name}</p>}
      {!isAdmin && item.status === 'pending' && item.accepted_at && item.pickup_code && <p className="notes">🔐 Informe à loja o código de coleta: <b>{item.pickup_code}</b></p>}
      {item.collected_at && <p className="notes">📦 Coletado: {scheduleValue(item.collected_at)}</p>}
      {item.arrived_at && <p className="notes">📍 Chegou: {scheduleValue(item.arrived_at)}</p>}
      {item.completed_at && <p className="notes">✅ Entregue: {scheduleValue(item.completed_at)}</p>}
      {item.scheduled_for && <p>🗓️ Agendada: {scheduleValue(item.scheduled_for)}</p>}
      {isAdmin && <p>🛵 {courier?.full_name || 'Sem entregador'}</p>}
      {item.notes && <p className="notes">{item.notes}</p>}
      {item.status === 'cancelled' && item.cancellation_reason && <p className="cancel-reason">Cancelamento: {item.cancellation_reason}</p>}

      <footer>
        <button className="ghost" onClick={contact}>Contato</button>
        {!isAdmin && item.status !== 'completed' && item.status !== 'cancelled' && <button className="ghost" onClick={help}>Preciso de ajuda</button>}
        <button className="ghost" onClick={() => setNavAddress(routeAddress)}>
          {routeToStore ? 'Navegar para loja' : 'Navegar para cliente'}
        </button>
        {isAdmin && <button className="ghost" onClick={edit}>Editar</button>}
        {item.status === 'in_progress' && !item.arrived_at && <button className="ghost" onClick={arrive}>Cheguei ao local</button>}
        {canAdvance && <button onClick={advance}>{actionLabel}</button>}
      </footer>
      {navAddress && <Navigation destination={navAddress} onClose={() => setNavAddress(null)} />}
    </article>
  )
}

function ProblemPanel({ item, authorId, close, saved, showError }: {
  item: Delivery
  authorId: string
  close: () => void
  saved: () => void
  showError: (value: string) => void
}) {
  const [sending, setSending] = useState(false)

  const report = async (reason: string) => {
    setSending(true)
    const { error } = await supabase.from('delivery_messages').insert({
      delivery_id: item.id,
      author_id: authorId,
      body: `🆘 Ajuda solicitada: ${reason}`
    })
    setSending(false)

    if (error) {
      showError(`Não foi possível enviar o pedido de ajuda: ${error.message}`)
      return
    }
    saved()
  }

  return (
    <div className="overlay">
      <section className="new-form">
        <header>
          <h2>Preciso de ajuda</h2>
          <button className="ghost" type="button" onClick={close}>Fechar</button>
        </header>
        <p className="helper">Escolha o que aconteceu com o pedido {item.order_code}.</p>
        <div className="store-actions">
          <button disabled={sending} onClick={() => void report('Cliente não localizado')}>Cliente não localizado</button>
          <button className="ghost" disabled={sending} onClick={() => void report('Endereço incorreto ou incompleto')}>Endereço incorreto</button>
          <button className="ghost" disabled={sending} onClick={() => void report('Problema na coleta da loja')}>Problema na coleta</button>
          <button className="ghost" disabled={sending} onClick={() => void report('Outro problema durante a entrega')}>Outro problema</button>
        </div>
      </section>
    </div>
  )
}

function ContactPanel({ item, viewerId, close, showError }: {
  item: Delivery
  viewerId: string
  close: () => void
  showError: (value: string) => void
}) {
  const [messages, setMessages] = useState<{ id: string; sender_type: string; message: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const loadMessages = async () => {
    setLoading(true)

    const { data, error } = await supabase.rpc('courier_read_delivery_messages', {
      p_delivery_id: item.id
    })

    setLoading(false)

    if (error) {
      showError(`Não foi possível carregar as mensagens: ${error.message}`)
      return
    }

    setMessages((data ?? []) as typeof messages)
  }

  useEffect(() => {
    void loadMessages()
  }, [item.id])

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const values = new FormData(form)
    const body = String(values.get('message') || '').trim()
    if (!body) return

    setSending(true)

    const { error } = await supabase.rpc('courier_send_delivery_message', {
      p_delivery_id: item.id,
      p_message: body
    })

    setSending(false)

    if (error) {
      showError(`Não foi possível enviar a mensagem: ${error.message}`)
      return
    }

    form.reset()
    await loadMessages()
  }

  return (
    <div className="overlay">
      <section className="new-form contact-panel">
        <header>
          <h2>Chat da entrega</h2>
          <button className="ghost" type="button" onClick={close}>Fechar</button>
        </header>

        <p className="helper">{item.order_code} · {item.customer_name}</p>

        {item.customer_phone
          ? <a className="call-customer" href={`tel:${item.customer_phone}`}>Ligar para o cliente</a>
          : <p className="helper">Telefone do cliente não informado.</p>}

        <h3>Mensagens com o cliente</h3>

        <div className="messages">
          {loading
            ? <p>Carregando mensagens…</p>
            : messages.length === 0
              ? <p>Nenhuma mensagem ainda. Envie uma mensagem para iniciar a conversa.</p>
              : messages.map(message => (
                <article className={message.sender_type === 'courier' ? 'mine' : ''} key={message.id}>
                  <span>{message.sender_type === 'courier' ? 'Equipe de entrega' : 'Cliente'}</span>
                  <p>{message.message}</p>
                  <small>{new Date(message.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
                </article>
              ))}
        </div>

        <form onSubmit={send}>
          <label>
            Nova mensagem
            <textarea name="message" rows={3} maxLength={2000} placeholder="Escreva uma mensagem para o cliente" required />
          </label>
          <button disabled={sending}>{sending ? 'Enviando…' : 'Enviar mensagem'}</button>
        </form>
      </section>
    </div>
  )
}

function DeliveryForm({ owner, stores, couriers, close, saved, showError }: {
  owner: string
  stores: Store[]
  couriers: Profile[]
  close: () => void
  saved: () => void
  showError: (value: string) => void
}) {
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)

    const values = new FormData(event.currentTarget)
    const pickupCode = String(Math.floor(1000 + Math.random() * 9000))
    const confirmationCode = String(Math.floor(1000 + Math.random() * 9000))
    const orderCode = String(values.get('orderCode') || '').trim().toUpperCase() || `BAM-${Date.now()}`

    const { error } = await supabase.from('deliveries').insert({
      order_code: orderCode,
      customer_name: String(values.get('customer')),
      customer_phone: String(values.get('phone') || '') || null,
      delivery_address: String(values.get('address')),
      scheduled_for: scheduleForDatabase(values.get('scheduledFor')),
      priority: String(values.get('priority')) as Priority,
      notes: String(values.get('notes') || ''),
      store_id: String(values.get('store') || '') || null,
      courier_id: String(values.get('courier') || '') || null,
      created_by: owner,
      pickup_code: pickupCode,
      confirmation_code: confirmationCode,
      status: 'pending'
    })

    setSaving(false)

    if (error) {
      showError(`Não foi possível salvar: ${error.message}`)
      return
    }
    saved()
  }

  return (
    <div className="overlay">
      <form className="new-form" onSubmit={submit}>
        <header>
          <h2>Nova entrega</h2>
          <button className="ghost" type="button" onClick={close}>Fechar</button>
        </header>
        <label>Número do pedido<input name="orderCode" placeholder="Ex.: 1024" /></label>
        <label>Cliente<input name="customer" required /></label>
        <label>Telefone do cliente<input name="phone" inputMode="tel" placeholder="(00) 00000-0000" /></label>
        <label>Endereço<input name="address" required placeholder="Rua, número e bairro" /></label>
        <label>Agendar para<input name="scheduledFor" type="datetime-local" /></label>
        <label>Prioridade<select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">Alta</option></select></label>
        <label>Loja<select name="store"><option value="">Definir depois</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label>Entregador<select name="courier"><option value="">Atribuir depois</option>{couriers.filter(courier => courier.active).map(courier => <option key={courier.id} value={courier.id}>{courier.full_name}</option>)}</select></label>
        <label>Observação<textarea name="notes" rows={3} /></label>
        <button disabled={saving}>{saving ? 'Salvando…' : 'Salvar pedido'}</button>
      </form>
    </div>
  )
}

function DeliveryEditor({ item, stores, couriers, close, saved, showError }: {
  item: Delivery
  stores: Store[]
  couriers: Profile[]
  close: () => void
  saved: () => void
  showError: (value: string) => void
}) {
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)

    const values = new FormData(event.currentTarget)
    const status = String(values.get('status')) as Status

    const { error } = await supabase.from('deliveries').update({
      customer_name: String(values.get('customer')).trim(),
      customer_phone: String(values.get('phone') || '').trim() || null,
      delivery_address: String(values.get('address')).trim(),
      scheduled_for: scheduleForDatabase(values.get('scheduledFor')),
      priority: String(values.get('priority')) as Priority,
      notes: String(values.get('notes') || '').trim(),
      cancellation_reason: status === 'cancelled' ? String(values.get('cancellationReason') || '').trim() || 'Não informado' : null,
      store_id: String(values.get('store') || '') || null,
      courier_id: String(values.get('courier') || '') || null,
      status
    }).eq('id', item.id)

    setSaving(false)

    if (error) {
      showError(`Não foi possível atualizar a entrega: ${error.message}`)
      return
    }
    saved()
  }

  return (
    <div className="overlay">
      <form className="new-form" onSubmit={submit}>
        <header>
          <h2>Editar entrega</h2>
          <button className="ghost" type="button" onClick={close}>Fechar</button>
        </header>
        <label>Cliente<input name="customer" defaultValue={item.customer_name} required /></label>
        <label>Telefone do cliente<input name="phone" inputMode="tel" defaultValue={item.customer_phone ?? ''} /></label>
        <label>Endereço<input name="address" defaultValue={item.delivery_address} required /></label>
        <label>Agendar para<input name="scheduledFor" type="datetime-local" defaultValue={inputScheduleValue(item.scheduled_for)} /></label>
        <label>Prioridade<select name="priority" defaultValue={item.priority}><option value="normal">Normal</option><option value="high">Alta</option></select></label>
        <label>Loja<select name="store" defaultValue={item.store_id ?? ''}><option value="">Definir depois</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label>Entregador<select name="courier" defaultValue={item.courier_id ?? ''}><option value="">Atribuir depois</option>{couriers.filter(courier => courier.active || courier.id === item.courier_id).map(courier => <option key={courier.id} value={courier.id}>{courier.full_name}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={item.status}>{(Object.keys(statusName) as Status[]).map(status => <option key={status} value={status}>{statusName[status]}</option>)}</select></label>
        <label>Motivo do cancelamento<input name="cancellationReason" defaultValue={item.cancellation_reason ?? ''} placeholder="Ex.: cliente não localizado" /></label>
        <label>Observação<textarea name="notes" rows={3} defaultValue={item.notes} /></label>
        <button disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
      </form>
    </div>
  )
}

function CourierManager({ couriers, close, saved, showError }: {
  couriers: Profile[]
  close: () => void
  saved: () => void
  showError: (value: string) => void
}) {
  const [savingId, setSavingId] = useState<string | null>(null)

  const toggle = async (courier: Profile) => {
    if (!window.confirm(`${courier.active ? 'Desativar' : 'Ativar'} ${courier.full_name || 'este entregador'}?`)) return

    setSavingId(courier.id)
    const { error } = await supabase.from('profiles')
      .update({ active: !courier.active })
      .eq('id', courier.id)
    setSavingId(null)

    if (error) {
      showError(`Não foi possível atualizar o entregador: ${error.message}`)
      return
    }
    saved()
  }

  return (
    <div className="overlay">
      <section className="new-form">
        <header>
          <h2>Entregadores</h2>
          <button className="ghost" type="button" onClick={close}>Fechar</button>
        </header>
        <p className="helper">Para criar uma nova conta, use Authentication no Supabase. Aqui você controla quem recebe novas entregas.</p>
        <div className="store-list">
          {couriers.length === 0
            ? <p>Nenhum entregador cadastrado.</p>
            : couriers.map(courier => (
              <article key={courier.id}>
                <b>{courier.full_name || 'Entregador sem nome'}</b>
                <span>{courier.active ? 'Disponível para novas entregas' : 'Desativado'}</span>
                <div className="store-actions">
                  <button
                    className={courier.active ? 'danger' : 'ghost'}
                    type="button"
                    disabled={savingId === courier.id}
                    onClick={() => void toggle(courier)}
                  >
                    {savingId === courier.id ? 'Salvando…' : courier.active ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              </article>
            ))}
        </div>
      </section>
    </div>
  )
}

function StoreManager({ stores, close, saved, showError }: {
  stores: Store[]
  close: () => void
  saved: () => void
  showError: (value: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Store | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')

  const resetForm = () => {
    setEditing(null)
    setName('')
    setAddress('')
    setPhone('')
  }

  const startEdit = (store: Store) => {
    setEditing(store)
    setName(store.name)
    setAddress(store.address ?? '')
    setPhone(store.phone ?? '')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)

    const values = {
      name: name.trim(),
      address: address.trim() || null,
      phone: phone.trim() || null
    }

    const request = editing
      ? supabase.from('stores').update(values).eq('id', editing.id)
      : supabase.from('stores').insert({ ...values, active: true })

    const { error } = await request
    setSaving(false)

    if (error) {
      showError(`Não foi possível salvar a loja: ${error.message}`)
      return
    }

    resetForm()
    saved()
  }

  const deactivate = async (store: Store) => {
    if (!window.confirm(`Desativar ${store.name}? Ela não será apagada e não aparecerá em novas entregas.`)) return

    setSaving(true)
    const { error } = await supabase.from('stores')
      .update({ active: false })
      .eq('id', store.id)
    setSaving(false)

    if (error) {
      showError(`Não foi possível desativar a loja: ${error.message}`)
      return
    }

    if (editing?.id === store.id) resetForm()
    saved()
  }

  return (
    <div className="overlay">
      <section className="new-form">
        <header>
          <h2>Lojas parceiras</h2>
          <button className="ghost" type="button" onClick={close}>Fechar</button>
        </header>

        <p className="helper">Cadastre, edite ou desative lojas. Desativar não apaga entregas antigas.</p>

        <form onSubmit={submit}>
          <label>Nome da loja<input value={name} onChange={event => setName(event.target.value)} required placeholder="Ex.: Padaria Central" /></label>
          <label>Endereço<input value={address} onChange={event => setAddress(event.target.value)} placeholder="Rua, número e bairro" /></label>
          <label>Telefone<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="(00) 00000-0000" /></label>

          <div className="form-actions">
            <button disabled={saving}>{saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar loja'}</button>
            {editing && <button className="ghost" type="button" onClick={resetForm}>Cancelar edição</button>}
          </div>
        </form>

        <div className="store-list">
          {stores.length === 0
            ? <p>Nenhuma loja cadastrada.</p>
            : stores.map(store => (
              <article key={store.id}>
                <b>{store.name}</b>
                {store.address && <span>📍 {store.address}</span>}
                {store.phone && <span>☎ {store.phone}</span>}
                <div className="store-actions">
                  <button className="ghost" type="button" onClick={() => startEdit(store)}>Editar</button>
                  <button className="danger" type="button" onClick={() => void deactivate(store)}>Desativar</button>
                </div>
              </article>
            ))}
        </div>
      </section>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
