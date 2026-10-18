import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Status = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type Priority = 'normal' | 'high'
type Profile = { id: string; full_name: string; role: 'admin' | 'courier'; active: boolean }
type Store = { id: string; name: string; address: string | null; phone: string | null }
type Delivery = { id: string; order_code: string; customer_name: string; customer_phone: string | null; delivery_address: string; notes: string; cancellation_reason: string | null; confirmation_code: string | null; priority: Priority; status: Status; store_id: string | null; courier_id: string | null; scheduled_for: string | null; created_at: string }
type DeliveryMessage = { id: string; author_id: string; body: string; created_at: string }
type DeliveryView = 'all' | 'today' | 'scheduled' | 'unassigned' | 'overdue' | Status
const projectUrl = 'https://quxgxxffiobgqlotpfnl.supabase.co'
const publishableKey = 'sb_publishable_mxo_SkEaEzkRKQ9jOLgjlQ_fiOIaZvl'
const supabase = createClient(projectUrl, publishableKey)
const statusName: Record<Status, string> = { pending: 'Aguardando', in_progress: 'Em rota', completed: 'Concluída', cancelled: 'Cancelada' }
const priorityName: Record<Priority, string> = { normal: 'Normal', high: 'Prioridade alta' }
const scheduleValue = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
const inputScheduleValue = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
const scheduleForDatabase = (value: FormDataEntryValue | null) => { const date = typeof value === 'string' && value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null }
const isToday = (value: string) => { const date = new Date(value); const now = new Date(); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate() }
const isTodayDelivery = (item: Delivery) => isToday(item.scheduled_for ?? item.created_at)
const isFuture = (value: string | null) => Boolean(value && new Date(value).getTime() > new Date().getTime())
const isOverdue = (item: Delivery) => Boolean(item.scheduled_for && new Date(item.scheduled_for).getTime() < new Date().getTime() && item.status !== 'completed' && item.status !== 'cancelled')

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
      supabase.from('deliveries').select('id,order_code,customer_name,customer_phone,delivery_address,notes,cancellation_reason,confirmation_code,priority,status,store_id,courier_id,scheduled_for,created_at').order('created_at', { ascending: false }),
      supabase.from('stores').select('id,name,address,phone').eq('active', true).order('name'),
      current.role === 'admin' ? supabase.from('profiles').select('id,full_name,role,active').eq('role', 'courier').order('full_name') : Promise.resolve({ data: [], error: null })
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
  const enter = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!supabase) return; setSending(true); onNotice(''); const values = new FormData(event.currentTarget); const { error } = await supabase.auth.signInWithPassword({ email: String(values.get('email')), password: String(values.get('password')) }); if (error) onNotice(`Não foi possível entrar: ${error.message}`); setSending(false) }
  return <main className="login"><section><div className="logo">B</div><span>BAMBUÍ ENTREGADORES</span><h1>Seu dia começa aqui.</h1><p>Entre para acompanhar ou realizar suas entregas.</p><form onSubmit={enter}><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>{notice && <b className="error">{notice}</b>}<button disabled={sending}>{sending ? 'Entrando…' : 'Entrar'}</button></form></section></main>
}

function Home({ profile, deliveries, stores, couriers, reload, notice, setNotice }: { profile: Profile; deliveries: Delivery[]; stores: Store[]; couriers: Profile[]; reload: () => void; notice: string; setNotice: (value: string) => void }) {
  const [formOpen, setFormOpen] = useState(false)
  const [storesOpen, setStoresOpen] = useState(false)
  const [couriersOpen, setCouriersOpen] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null)
  const [contactDelivery, setContactDelivery] = useState<Delivery | null>(null)
  const [filter, setFilter] = useState<DeliveryView>('all')
  const [search, setSearch] = useState('')
  const isAdmin = profile.role === 'admin'
  const unassignedCount = deliveries.filter(item => !item.courier_id && item.status !== 'completed' && item.status !== 'cancelled').length
  const overdueCount = deliveries.filter(isOverdue).length
  const shown = deliveries.filter(item => {
    if (filter === 'today' && !isTodayDelivery(item)) return false
    if (filter === 'scheduled' && !isFuture(item.scheduled_for)) return false
    if (filter === 'unassigned' && (item.courier_id || item.status === 'completed' || item.status === 'cancelled')) return false
    if (filter === 'overdue' && !isOverdue(item)) return false
    if (filter !== 'all' && filter !== 'today' && filter !== 'scheduled' && item.status !== filter) return false
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return !term || [item.order_code, item.customer_name, item.delivery_address, item.customer_phone ?? ''].some(value => value.toLocaleLowerCase('pt-BR').includes(term))
  }).sort((left, right) => Number(right.priority === 'high') - Number(left.priority === 'high'))
  const totals = useMemo(() => { const today = deliveries.filter(isTodayDelivery); return { pending: today.filter(item => item.status === 'pending').length, moving: today.filter(item => item.status === 'in_progress').length, done: today.filter(item => item.status === 'completed').length } }, [deliveries])
  const updateStatus = async (delivery: Delivery) => {
    if (!supabase) return
    const next: Status | null = delivery.status === 'pending' ? 'in_progress' : delivery.status === 'in_progress' ? 'completed' : null
    if (!next) return
    if (next === 'completed' && delivery.confirmation_code) {
      const typedCode = window.prompt('Peça ao cliente o código de confirmação de 4 dígitos.')?.trim()
      if (typedCode !== delivery.confirmation_code) { setNotice('Código de confirmação incorreto. A entrega continua em rota.'); return }
    }
    const { error } = await supabase.from('deliveries').update({ status: next }).eq('id', delivery.id)
    if (error) { setNotice(`Não foi possível atualizar: ${error.message}`); return }
    reload()
  }
  return <main className="shell"><header><div className="logo">B</div><div className="heading"><span>BAMBUÍ ENTREGADORES</span><h1>{isAdmin ? 'Visão de hoje' : `Olá, ${profile.full_name || 'entregador'}`}</h1></div><button className="ghost" onClick={() => void supabase?.auth.signOut()}>Sair</button></header>
    {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <section className="greeting"><div><b>{isAdmin ? 'Tudo sob controle.' : 'Boa rota!'}</b><p>{isAdmin ? 'Acompanhe os pedidos da cidade em um só lugar.' : 'Veja os pedidos atribuídos a você e avance o status.'}</p></div><span>🏍️</span></section>
    <section className="numbers"><Metric title="Aguardando" value={totals.pending} /><Metric title="Em rota" value={totals.moving} /><Metric title="Concluídas" value={totals.done} /></section>
    <label className="search">🔎 <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por cliente, endereço ou código" aria-label="Buscar entregas" /></label>
    <section className="commands"><div className="tabs">{(['today', 'scheduled', 'all', 'pending', 'in_progress', 'completed'] as const).map(value => <button key={value} className={filter === value ? 'tab active' : 'tab'} onClick={() => setFilter(value)}>{value === 'all' ? 'Todas' : value === 'today' ? 'Hoje' : value === 'scheduled' ? 'Agendadas' : statusName[value]}</button>)}</div><div className="actions">{isAdmin && <button className={filter === 'overdue' ? 'danger' : 'ghost'} onClick={() => setFilter('overdue')}>Atrasadas{overdueCount ? ` (${overdueCount})` : ''}</button>}{isAdmin && <button className={filter === 'unassigned' ? 'tab active' : 'ghost'} onClick={() => setFilter('unassigned')}>Sem entregador{unassignedCount ? ` (${unassignedCount})` : ''}</button>}{isAdmin && <button className="ghost" onClick={() => setStoresOpen(true)}>Lojas</button>}{isAdmin && <button className="ghost" onClick={() => setCouriersOpen(true)}>Entregadores</button>}{isAdmin && <button onClick={() => setFormOpen(true)}>Nova entrega</button>}<button className="ghost" onClick={reload}>Atualizar</button></div></section>
    {formOpen && <DeliveryForm owner={profile.id} stores={stores} couriers={couriers} close={() => setFormOpen(false)} saved={() => { setFormOpen(false); reload() }} showError={setNotice} />}
    {storesOpen && <StoreManager stores={stores} close={() => setStoresOpen(false)} saved={reload} showError={setNotice} />}
    {couriersOpen && <CourierManager couriers={couriers} close={() => setCouriersOpen(false)} saved={reload} showError={setNotice} />}
    {editingDelivery && <DeliveryEditor item={editingDelivery} stores={stores} couriers={couriers} close={() => setEditingDelivery(null)} saved={() => { setEditingDelivery(null); reload() }} showError={setNotice} />}
    {contactDelivery && <ContactPanel item={contactDelivery} viewerId={profile.id} close={() => setContactDelivery(null)} showError={setNotice} />}
    <section className="deliveries">{shown.length === 0 ? <div className="empty">Nenhuma entrega nesta lista.</div> : shown.map(delivery => <Card key={delivery.id} item={delivery} store={stores.find(store => store.id === delivery.store_id)} courier={couriers.find(courier => courier.id === delivery.courier_id)} isAdmin={isAdmin} advance={() => void updateStatus(delivery)} edit={() => setEditingDelivery(delivery)} contact={() => setContactDelivery(delivery)} />)}</section>
  </main>
}

function Metric({ title, value }: { title: string; value: number }) { return <article className="number"><small>{title}</small><strong>{value}</strong></article> }
function Card({ item, store, courier, isAdmin, advance, edit, contact }: { item: Delivery; store?: Store; courier?: Profile; isAdmin: boolean; advance: () => void; edit: () => void; contact: () => void }) { const canAdvance = item.status === 'pending' || item.status === 'in_progress'; return <article className="card"><div className="card-head"><span className={`pill ${item.status}`}>{statusName[item.status]}</span><small>{item.order_code}</small></div><h2>{item.customer_name}</h2>{item.priority === 'high' && <p className="priority">⚡ {priorityName[item.priority]}</p>}{isOverdue(item) && <p className="cancel-reason">⚠ Entrega atrasada</p>}<p>📍 {item.delivery_address}</p>{item.scheduled_for && <p>🗓️ Agendada: {scheduleValue(item.scheduled_for)}</p>}{store && <p>🏪 {store.name}</p>}{isAdmin && <p>🛵 {courier?.full_name || 'Sem entregador'}</p>}{item.notes && <p className="notes">{item.notes}</p>}{item.status === 'cancelled' && item.cancellation_reason && <p className="cancel-reason">Cancelamento: {item.cancellation_reason}</p>}<footer><button className="ghost" onClick={contact}>Contato</button><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.delivery_address)}`} target="_blank" rel="noreferrer">Abrir rota</a>{isAdmin && <button className="ghost" onClick={edit}>Editar</button>}{canAdvance && <button onClick={advance}>{item.status === 'pending' ? 'Iniciar' : 'Concluir'}</button>}</footer></article> }

function ContactPanel({ item, viewerId, close, showError }: { item: Delivery; viewerId: string; close: () => void; showError: (value: string) => void }) {
  const [messages, setMessages] = useState<DeliveryMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const loadMessages = async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase.from('delivery_messages').select('id,author_id,body,created_at').eq('delivery_id', item.id).order('created_at')
    setLoading(false)
    if (error) { showError(`Não foi possível carregar as mensagens: ${error.message}`); return }
    setMessages((data ?? []) as DeliveryMessage[])
  }
  useEffect(() => { void loadMessages() }, [item.id])
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    const values = new FormData(event.currentTarget)
    const body = String(values.get('message') || '').trim()
    if (!body) return
    setSending(true)
    const { error } = await supabase.from('delivery_messages').insert({ delivery_id: item.id, author_id: viewerId, body })
    setSending(false)
    if (error) { showError(`Não foi possível enviar a mensagem: ${error.message}`); return }
    event.currentTarget.reset()
    void loadMessages()
  }
  return <div className="overlay"><section className="new-form contact-panel"><header><h2>Contato da entrega</h2><button className="ghost" type="button" onClick={close}>Fechar</button></header><p className="helper">{item.order_code} · {item.customer_name}</p>{item.customer_phone ? <a className="call-customer" href={`tel:${item.customer_phone}`}>Ligar para o cliente</a> : <p className="helper">Telefone do cliente não informado.</p>}<h3>Mensagens com a equipe</h3><div className="messages">{loading ? <p>Carregando mensagens…</p> : messages.length === 0 ? <p>Nenhuma mensagem ainda.</p> : messages.map(message => <article className={message.author_id === viewerId ? 'mine' : ''} key={message.id}><span>{message.author_id === viewerId ? 'Você' : 'Equipe'}</span><p>{message.body}</p><small>{new Date(message.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></article>)}</div><form onSubmit={send}><label>Nova mensagem<textarea name="message" rows={3} maxLength={1000} placeholder="Escreva uma mensagem para a equipe" required /></label><button disabled={sending}>{sending ? 'Enviando…' : 'Enviar mensagem'}</button></form></section></div>
}

function DeliveryForm({ owner, stores, couriers, close, saved, showError }: { owner: string; stores: Store[]; couriers: Profile[]; close: () => void; saved: () => void; showError: (value: string) => void }) {
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!supabase) return; setSaving(true); const values = new FormData(event.currentTarget); const confirmationCode = String(Math.floor(1000 + Math.random() * 9000)); const { error } = await supabase.from('deliveries').insert({ order_code: `BAM-${Date.now()}`, customer_name: String(values.get('customer')), customer_phone: String(values.get('phone') || '') || null, delivery_address: String(values.get('address')), scheduled_for: scheduleForDatabase(values.get('scheduledFor')), priority: String(values.get('priority')) as Priority, notes: String(values.get('notes') || ''), store_id: String(values.get('store') || '') || null, courier_id: String(values.get('courier') || '') || null, created_by: owner, confirmation_code: confirmationCode, status: 'pending' }); setSaving(false); if (error) { showError(`Não foi possível salvar: ${error.message}`); return }; saved() }
  return <div className="overlay"><form className="new-form" onSubmit={submit}><header><h2>Nova entrega</h2><button className="ghost" type="button" onClick={close}>Fechar</button></header><label>Cliente<input name="customer" required /></label><label>Telefone do cliente<input name="phone" inputMode="tel" placeholder="(00) 00000-0000" /></label><label>Endereço<input name="address" required placeholder="Rua, número e bairro" /></label><label>Agendar para<input name="scheduledFor" type="datetime-local" /></label><label>Prioridade<select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">Alta</option></select></label><label>Loja<select name="store"><option value="">Definir depois</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Entregador<select name="courier"><option value="">Atribuir depois</option>{couriers.filter(courier => courier.active).map(courier => <option key={courier.id} value={courier.id}>{courier.full_name}</option>)}</select></label><label>Observação<textarea name="notes" rows={3} /></label><button disabled={saving}>{saving ? 'Salvando…' : 'Salvar pedido'}</button></form></div>
}

function DeliveryEditor({ item, stores, couriers, close, saved, showError }: { item: Delivery; stores: Store[]; couriers: Profile[]; close: () => void; saved: () => void; showError: (value: string) => void }) {
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setSaving(true)
    const values = new FormData(event.currentTarget)
    const status = String(values.get('status')) as Status
    const { error } = await supabase.from('deliveries').update({ customer_name: String(values.get('customer')).trim(), customer_phone: String(values.get('phone') || '').trim() || null, delivery_address: String(values.get('address')).trim(), scheduled_for: scheduleForDatabase(values.get('scheduledFor')), priority: String(values.get('priority')) as Priority, notes: String(values.get('notes') || '').trim(), cancellation_reason: status === 'cancelled' ? String(values.get('cancellationReason') || '').trim() || 'Não informado' : null, store_id: String(values.get('store') || '') || null, courier_id: String(values.get('courier') || '') || null, status }).eq('id', item.id)
    setSaving(false)
    if (error) { showError(`Não foi possível atualizar a entrega: ${error.message}`); return }
    saved()
  }
  return <div className="overlay"><form className="new-form" onSubmit={submit}><header><h2>Editar entrega</h2><button className="ghost" type="button" onClick={close}>Fechar</button></header><label>Cliente<input name="customer" defaultValue={item.customer_name} required /></label><label>Telefone do cliente<input name="phone" inputMode="tel" defaultValue={item.customer_phone ?? ''} /></label><label>Endereço<input name="address" defaultValue={item.delivery_address} required /></label><label>Agendar para<input name="scheduledFor" type="datetime-local" defaultValue={inputScheduleValue(item.scheduled_for)} /></label><label>Prioridade<select name="priority" defaultValue={item.priority}><option value="normal">Normal</option><option value="high">Alta</option></select></label><label>Loja<select name="store" defaultValue={item.store_id ?? ''}><option value="">Definir depois</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Entregador<select name="courier" defaultValue={item.courier_id ?? ''}><option value="">Atribuir depois</option>{couriers.filter(courier => courier.active || courier.id === item.courier_id).map(courier => <option key={courier.id} value={courier.id}>{courier.full_name}</option>)}</select></label><label>Status<select name="status" defaultValue={item.status}>{(Object.keys(statusName) as Status[]).map(status => <option key={status} value={status}>{statusName[status]}</option>)}</select></label><label>Motivo do cancelamento<input name="cancellationReason" defaultValue={item.cancellation_reason ?? ''} placeholder="Ex.: cliente não localizado" /></label><label>Observação<textarea name="notes" rows={3} defaultValue={item.notes} /></label><button disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></form></div>
}

function CourierManager({ couriers, close, saved, showError }: { couriers: Profile[]; close: () => void; saved: () => void; showError: (value: string) => void }) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const toggle = async (courier: Profile) => {
    if (!supabase || !window.confirm(`${courier.active ? 'Desativar' : 'Ativar'} ${courier.full_name || 'este entregador'}?`)) return
    setSavingId(courier.id)
    const { error } = await supabase.from('profiles').update({ active: !courier.active }).eq('id', courier.id)
    setSavingId(null)
    if (error) { showError(`Não foi possível atualizar o entregador: ${error.message}`); return }
    saved()
  }
  return <div className="overlay"><section className="new-form"><header><h2>Entregadores</h2><button className="ghost" type="button" onClick={close}>Fechar</button></header><p className="helper">Para criar uma nova conta, use Authentication no Supabase. Aqui você controla quem recebe novas entregas.</p><div className="store-list">{couriers.length === 0 ? <p>Nenhum entregador cadastrado.</p> : couriers.map(courier => <article key={courier.id}><b>{courier.full_name || 'Entregador sem nome'}</b><span>{courier.active ? 'Disponível para novas entregas' : 'Desativado'}</span><div className="store-actions"><button className={courier.active ? 'danger' : 'ghost'} type="button" disabled={savingId === courier.id} onClick={() => void toggle(courier)}>{savingId === courier.id ? 'Salvando…' : courier.active ? 'Desativar' : 'Ativar'}</button></div></article>)}</div></section></div>
}

function StoreManager({ stores, close, saved, showError }: { stores: Store[]; close: () => void; saved: () => void; showError: (value: string) => void }) {
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Store | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const resetForm = () => { setEditing(null); setName(''); setAddress(''); setPhone('') }
  const startEdit = (store: Store) => { setEditing(store); setName(store.name); setAddress(store.address ?? ''); setPhone(store.phone ?? '') }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setSaving(true)
    const values = { name: name.trim(), address: address.trim() || null, phone: phone.trim() || null }
    const request = editing ? supabase.from('stores').update(values).eq('id', editing.id) : supabase.from('stores').insert({ ...values, active: true })
    const { error } = await request
    setSaving(false)
    if (error) { showError(`Não foi possível salvar a loja: ${error.message}`); return }
    resetForm()
    saved()
  }
  const deactivate = async (store: Store) => {
    if (!supabase || !window.confirm(`Desativar ${store.name}? Ela não será apagada e não aparecerá em novas entregas.`)) return
    setSaving(true)
    const { error } = await supabase.from('stores').update({ active: false }).eq('id', store.id)
    setSaving(false)
    if (error) { showError(`Não foi possível desativar a loja: ${error.message}`); return }
    if (editing?.id === store.id) resetForm()
    saved()
  }
  return <div className="overlay"><section className="new-form"><header><h2>Lojas parceiras</h2><button className="ghost" type="button" onClick={close}>Fechar</button></header><p className="helper">Cadastre, edite ou desative lojas. Desativar não apaga entregas antigas.</p><form onSubmit={submit}><label>Nome da loja<input value={name} onChange={event => setName(event.target.value)} required placeholder="Ex.: Padaria Central" /></label><label>Endereço<input value={address} onChange={event => setAddress(event.target.value)} placeholder="Rua, número e bairro" /></label><label>Telefone<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="(00) 00000-0000" /></label><div className="form-actions"><button disabled={saving}>{saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar loja'}</button>{editing && <button className="ghost" type="button" onClick={resetForm}>Cancelar edição</button>}</div></form><div className="store-list">{stores.length === 0 ? <p>Nenhuma loja cadastrada.</p> : stores.map(store => <article key={store.id}><b>{store.name}</b>{store.address && <span>📍 {store.address}</span>}{store.phone && <span>☎ {store.phone}</span>}<div className="store-actions"><button className="ghost" type="button" onClick={() => startEdit(store)}>Editar</button><button className="danger" type="button" onClick={() => void deactivate(store)}>Desativar</button></div></article>)}</div></section></div>
}
createRoot(document.getElementById('root')!).render(<App />)
