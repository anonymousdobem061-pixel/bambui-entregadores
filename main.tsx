import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Status = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type Profile = { id: string; full_name: string; role: 'admin' | 'courier'; active: boolean }
type Store = { id: string; name: string }
type Delivery = { id: string; order_code: string; customer_name: string; delivery_address: string; notes: string; status: Status; store_id: string | null; courier_id: string | null; created_at: string }
const projectUrl = 'https://uptztveeotvpkhnckvlg.supabase.co'
const publishableKey = 'sb_publishable_w0lw3tF_KMCynUApLBi53g_vlJinpxP'
const supabase = createClient(projectUrl, publishableKey)
const statusName: Record<Status, string> = { pending: 'Aguardando', in_progress: 'Em rota', completed: 'Concluída', cancelled: 'Cancelada' }

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [couriers, setCouriers] = useState<Profile[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async (userId: string) => {
    if (!supabase) return
    setLoading(true)
    const me = await supabase.from('profiles').select('id,full_name,role,active').eq('id', userId).maybeSingle()
    if (me.error || !me.data) { setNotice('Seu usuário ainda não possui perfil no aplicativo.'); setLoading(false); return }
    const current = me.data as Profile
    setProfile(current)
    if (!current.active) { setNotice('Seu perfil está inativo.'); setLoading(false); return }
    const [deliveryData, storeData, courierData] = await Promise.all([
      supabase.from('deliveries').select('id,order_code,customer_name,delivery_address,notes,status,store_id,courier_id,created_at').order('created_at', { ascending: false }),
      supabase.from('stores').select('id,name').eq('active', true).order('name'),
      current.role === 'admin' ? supabase.from('profiles').select('id,full_name,role,active').eq('role', 'courier').eq('active', true) : Promise.resolve({ data: [], error: null })
    ])
    if (deliveryData.error) setNotice(`Não foi possível carregar as entregas: ${deliveryData.error.message}`)
    else setDeliveries((deliveryData.data ?? []) as Delivery[])
    if (!storeData.error) setStores((storeData.data ?? []) as Store[])
    if (!courierData.error) setCouriers((courierData.data ?? []) as Profile[])
    setLoading(false)
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (data.session) void load(data.session.user.id); else setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setProfile(null); setDeliveries([]); if (next) void load(next.user.id); else setLoading(false) })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabase) return <Message title="Conexão pendente" text="As variáveis do Supabase ainda não foram configuradas." />
  if (!session) return <Login onNotice={setNotice} notice={notice} />
  if (loading) return <Message title="Bambuí Entregadores" text="Carregando…" />
  if (!profile?.active) return <Message title="Acesso indisponível" text={notice || 'Perfil não encontrado.'} signOut />
  return <Home profile={profile} deliveries={deliveries} stores={stores} couriers={couriers} reload={() => void load(session.user.id)} notice={notice} setNotice={setNotice} />
}

function Message({ title, text, signOut }: { title: string; text: string; signOut?: boolean }) { return <main className="message"><div className="logo">B</div><h1>{title}</h1><p>{text}</p>{signOut && <button onClick={() => void supabase?.auth.signOut()}>Sair</button>}</main> }

function Login({ onNotice, notice }: { onNotice: (value: string) => void; notice: string }) {
  const [sending, setSending] = useState(false)
  const enter = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!supabase) return; setSending(true); onNotice(''); const values = new FormData(event.currentTarget); const { error } = await supabase.auth.signInWithPassword({ email: String(values.get('email')), password: String(values.get('password')) }); if (error) onNotice('Não foi possível entrar. Confira os dados.'); setSending(false) }
  return <main className="login"><section><div className="logo">B</div><span>BAMBUÍ ENTREGADORES</span><h1>Seu dia começa aqui.</h1><p>Entre para acompanhar ou realizar suas entregas.</p><form onSubmit={enter}><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>{notice && <b className="error">{notice}</b>}<button disabled={sending}>{sending ? 'Entrando…' : 'Entrar'}</button></form></section></main>
}

function Home({ profile, deliveries, stores, couriers, reload, notice, setNotice }: { profile: Profile; deliveries: Delivery[]; stores: Store[]; couriers: Profile[]; reload: () => void; notice: string; setNotice: (value: string) => void }) {
  const [formOpen, setFormOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | Status>('all')
  const isAdmin = profile.role === 'admin'
  const shown = filter === 'all' ? deliveries : deliveries.filter(item => item.status === filter)
  const totals = useMemo(() => ({ pending: deliveries.filter(item => item.status === 'pending').length, moving: deliveries.filter(item => item.status === 'in_progress').length, done: deliveries.filter(item => item.status === 'completed').length }), [deliveries])
  const updateStatus = async (delivery: Delivery) => { if (!supabase) return; const next: Status | null = delivery.status === 'pending' ? 'in_progress' : delivery.status === 'in_progress' ? 'completed' : null; if (!next) return; const { error } = await supabase.from('deliveries').update({ status: next }).eq('id', delivery.id); if (error) { setNotice(`Não foi possível atualizar: ${error.message}`); return }; reload() }
  return <main className="shell"><header><div className="logo">B</div><div className="heading"><span>BAMBUÍ ENTREGADORES</span><h1>{isAdmin ? 'Visão de hoje' : `Olá, ${profile.full_name || 'entregador'}`}</h1></div><button className="ghost" onClick={() => void supabase?.auth.signOut()}>Sair</button></header>
    {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <section className="greeting"><div><b>{isAdmin ? 'Tudo sob controle.' : 'Boa rota!'}</b><p>{isAdmin ? 'Acompanhe os pedidos da cidade em um só lugar.' : 'Veja os pedidos atribuídos a você e avance o status.'}</p></div><span>🏍️</span></section>
    <section className="numbers"><Number title="Aguardando" value={totals.pending} /><Number title="Em rota" value={totals.moving} /><Number title="Concluídas" value={totals.done} /></section>
    <section className="commands"><div className="tabs">{(['all', 'pending', 'in_progress', 'completed'] as const).map(value => <button key={value} className={filter === value ? 'tab active' : 'tab'} onClick={() => setFilter(value)}>{value === 'all' ? 'Todas' : statusName[value]}</button>)}</div><div className="actions">{isAdmin && <button onClick={() => setFormOpen(true)}>Nova entrega</button>}<button className="ghost" onClick={reload}>Atualizar</button></div></section>
    {formOpen && <DeliveryForm owner={profile.id} stores={stores} couriers={couriers} close={() => setFormOpen(false)} saved={() => { setFormOpen(false); reload() }} showError={setNotice} />}
    <section className="deliveries">{shown.length === 0 ? <div className="empty">Nenhuma entrega nesta lista.</div> : shown.map(delivery => <Card key={delivery.id} item={delivery} store={stores.find(store => store.id === delivery.store_id)} courier={couriers.find(courier => courier.id === delivery.courier_id)} isAdmin={isAdmin} advance={() => void updateStatus(delivery)} />)}</section>
  </main>
}

function Number({ title, value }: { title: string; value: number }) { return <article className="number"><small>{title}</small><strong>{value}</strong></article> }
function Card({ item, store, courier, isAdmin, advance }: { item: Delivery; store?: Store; courier?: Profile; isAdmin: boolean; advance: () => void }) { const canAdvance = item.status === 'pending' || item.status === 'in_progress'; return <article className="card"><div className="card-head"><span className={`pill ${item.status}`}>{statusName[item.status]}</span><small>{item.order_code}</small></div><h2>{item.customer_name}</h2><p>📍 {item.delivery_address}</p>{store && <p>🏪 {store.name}</p>}{isAdmin && <p>🛵 {courier?.full_name || 'Sem entregador'}</p>}{item.notes && <p className="notes">{item.notes}</p>}<footer><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.delivery_address)}`} target="_blank" rel="noreferrer">Abrir rota</a>{canAdvance && <button onClick={advance}>{item.status === 'pending' ? 'Iniciar' : 'Concluir'}</button>}</footer></article> }

function DeliveryForm({ owner, stores, couriers, close, saved, showError }: { owner: string; stores: Store[]; couriers: Profile[]; close: () => void; saved: () => void; showError: (value: string) => void }) {
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!supabase) return; setSaving(true); const values = new FormData(event.currentTarget); const { error } = await supabase.from('deliveries').insert({ order_code: `BAM-${Date.now()}`, customer_name: String(values.get('customer')), delivery_address: String(values.get('address')), notes: String(values.get('notes') || ''), store_id: String(values.get('store') || '') || null, courier_id: String(values.get('courier') || '') || null, created_by: owner, status: 'pending' }); setSaving(false); if (error) { showError(`Não foi possível salvar: ${error.message}`); return }; saved() }
  return <div className="overlay"><form className="new-form" onSubmit={submit}><header><h2>Nova entrega</h2><button className="ghost" type="button" onClick={close}>Fechar</button></header><label>Cliente<input name="customer" required /></label><label>Endereço<input name="address" required placeholder="Rua, número e bairro" /></label><label>Loja<select name="store"><option value="">Definir depois</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Entregador<select name="courier"><option value="">Atribuir depois</option>{couriers.map(courier => <option key={courier.id} value={courier.id}>{courier.full_name}</option>)}</select></label><label>Observação<textarea name="notes" rows={3} /></label><button disabled={saving}>{saving ? 'Salvando…' : 'Salvar pedido'}</button></form></div>
}
createRoot(document.getElementById('root')!).render(<App />)
