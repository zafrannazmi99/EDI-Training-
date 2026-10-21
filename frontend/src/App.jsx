import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, Bookmark, Check,
  Compass, Leaf, LoaderCircle, LogOut, MapPin, Menu, Plus,
  Sparkles, Trees, X,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const DEFAULT_CENTER = [49.0069, 8.4037]
const icon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
})

async function api(path, options = {}, token = '') {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed (${response.status})`)
  }
  if (response.status === 204) return null
  return response.json()
}

function FitPlaces({ places }) {
  const map = useMap()
  useEffect(() => {
    if (places.length === 1) map.flyTo([places[0].lat, places[0].lon], 14, { duration: 0.7 })
    else if (places.length > 1) {
      const bounds = L.latLngBounds(places.map((place) => [place.lat, place.lon]))
      map.fitBounds(bounds.pad(0.18), { maxZoom: 14, duration: 0.7 })
    }
  }, [places, map])
  return null
}

function PlaceMap({ places }) {
  return (
    <div className="map-shell">
      <MapContainer center={DEFAULT_CENTER} zoom={12} scrollWheelZoom className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitPlaces places={places} />
        {places.map((place) => (
          <Marker key={place.id} position={[place.lat, place.lon]} icon={icon}>
            <Popup><strong>{place.name}</strong><br />{place.place_type}</Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="map-label"><span className="map-pulse" /> Karlsruhe &amp; surroundings</div>
      <div className="map-credit">Map data &copy; OpenStreetMap</div>
    </div>
  )
}

function AuthDialog({ mode, setMode, onClose, onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api(`/auth/${mode}`, {
        method: 'POST', body: JSON.stringify({ email, password }),
      })
      onSuccess(result)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className="brand-mark small"><Trees size={20} /></div>
        <span className="eyebrow">YOUR OUTDOOR JOURNAL</span>
        <h2 id="auth-title">{mode === 'register' ? 'Make room for wonder.' : 'Welcome back.'}</h2>
        <p className="muted">{mode === 'register' ? 'Create an account to keep your favourite places close.' : 'Sign in to pick up where your next adventure begins.'}</p>
        <form onSubmit={submit} className="auth-form">
          <label>Email address<input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></label>
          <label>Password<input type="password" minLength={mode === 'register' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} required placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{mode === 'register' ? 'Create account' : 'Sign in'}<ArrowUpRight size={17} /></button>
        </form>
        <p className="switch-auth">{mode === 'register' ? 'Already have an account?' : 'New around here?'} <button onClick={() => { setError(''); setMode(mode === 'register' ? 'login' : 'register') }}>{mode === 'register' ? 'Sign in' : 'Create an account'}</button></p>
      </section>
    </div>
  )
}

function PlaceCard({ place, index, onSave, saved }) {
  return (
    <article className="place-card" style={{ '--card-order': index }}>
      <div className="place-card-top">
        <span className="place-kind"><MapPin size={13} />{place.place_type}</span>
        <button className={`save-button ${saved ? 'saved' : ''}`} onClick={() => onSave(place)} aria-label={saved ? 'Saved to a trip' : 'Save to a trip'} title={saved ? 'Saved' : 'Save place'}>
          {saved ? <Check size={16} /> : <Bookmark size={16} />}
        </button>
      </div>
      <h3>{place.name}</h3>
      <p>{place.description}</p>
      {place.score != null && <div className="match-row"><span className="match-line"><i style={{ width: `${Math.max(16, place.score * 100)}%` }} /></span><span>{Math.round(place.score * 100)}% match</span></div>}
    </article>
  )
}

function TripsView({ trips, setTrips, token, onBack, onError }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function createTrip(event) {
    event.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const trip = await api('/trips', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }, token)
      setTrips((current) => [...current, trip])
      setName('')
    } catch (err) { onError(err.message) }
    finally { setCreating(false) }
  }

  async function removeTrip(id) {
    try {
      await api(`/trips/${id}`, { method: 'DELETE' }, token)
      setTrips((current) => current.filter((trip) => trip.id !== id))
    } catch (err) { onError(err.message) }
  }

  async function removePlace(trip, place) {
    try {
      await api(`/trips/${trip.id}/places/${place.id}`, { method: 'DELETE' }, token)
      setTrips((current) => current.map((item) => item.id === trip.id ? { ...item, places: item.places.filter((saved) => saved.id !== place.id) } : item))
    } catch (err) { onError(err.message) }
  }

  return (
    <main className="trips-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to discovery</button>
      <div className="trips-heading"><div><span className="eyebrow">YOUR COLLECTION</span><h1>Trips worth taking.</h1><p>Gather your favourite places into little plans for later.</p></div><div className="trip-count"><strong>{trips.length.toString().padStart(2, '0')}</strong><span>saved trips</span></div></div>
      <form className="new-trip-form" onSubmit={createTrip}><Plus size={18} /><input aria-label="New trip name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name a new trip…" maxLength={120} /><button disabled={!name.trim() || creating}>{creating ? 'Creating…' : 'Create trip'}<ArrowUpRight size={15} /></button></form>
      {trips.length === 0 ? <div className="empty-trips"><div className="empty-icon"><Bookmark size={22} /></div><h2>Your first collection starts here.</h2><p>Save a place from discovery, or create a trip above.</p></div> : (
        <div className="trip-grid">{trips.map((trip, index) => (
          <section className="trip-card" key={trip.id} style={{ '--card-order': index }}>
            <div className="trip-card-heading"><div className="trip-card-icon"><Compass size={18} /></div><button className="text-danger" onClick={() => removeTrip(trip.id)}>Delete trip</button></div>
            <h2>{trip.name}</h2><p className="trip-meta">{trip.places.length} {trip.places.length === 1 ? 'place' : 'places'} · Created {new Date(trip.created_at).toLocaleDateString()}</p>
            {trip.places.length ? <div className="saved-list">{trip.places.map((place) => <div className="saved-place" key={place.id}><div><strong>{place.name}</strong><span>{place.place_type}</span></div><button className="icon-button" aria-label={`Remove ${place.name}`} onClick={() => removePlace(trip, place)}><X size={15} /></button></div>)}</div> : <div className="trip-empty-note">Places you save will find a home here.</div>}
          </section>
        ))}</div>
      )}
    </main>
  )
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState('discover')
  const [authMode, setAuthMode] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [token, setToken] = useState(() => localStorage.getItem('khg-token') || '')
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('khg-user') || 'null') } catch { return null }
  })
  const [trips, setTrips] = useState([])
  const [savedIds, setSavedIds] = useState(() => new Set())
  const examples = useMemo(() => [
    { icon: '◌', text: 'A quiet viewpoint for sunset', detail: 'Easy walk, a little away from the crowds' },
    { icon: '⌁', text: 'A gentle forest walk', detail: 'Somewhere good for a picnic with kids' },
    { icon: '≈', text: 'A peaceful place by the water', detail: 'A scenic spot to sit and read' },
  ], [])

  useEffect(() => {
    if (!token) { setTrips([]); return }
    api('/trips', {}, token).then((items) => {
      setTrips(items)
      setSavedIds(new Set(items.flatMap((trip) => trip.places.map((place) => place.place_id))))
    }).catch(() => signOut())
  }, [token])

  function signOut() {
    localStorage.removeItem('khg-token')
    localStorage.removeItem('khg-user')
    setToken(''); setUser(null); setTrips([]); setSavedIds(new Set()); setPage('discover')
  }

  function handleAuth(result) {
    localStorage.setItem('khg-token', result.access_token)
    localStorage.setItem('khg-user', JSON.stringify(result.user))
    setToken(result.access_token); setUser(result.user); setAuthMode('')
  }

  async function search(text = question) {
    const query = text.trim()
    if (query.length < 3 || loading) return
    setQuestion(query); setLoading(true); setNotice(''); setAnswer(''); setPlaces([])
    try {
      const result = await api('/ask', { method: 'POST', body: JSON.stringify({ question: query, limit: 5 }) })
      setAnswer(result.answer); setPlaces(result.places)
      if (result.model_status === 'ollama-unavailable') setNotice('Your place matches are ready; the recommendation model is temporarily offline.')
      if (result.model_status === 'no-results') setNotice('Try another description to explore more of the area.')
      if (result.model_status === 'records-only') setNotice('These map records list place names and types, but do not include details about their individual features.')
    } catch (err) {
      if (err.message.includes('index is empty') || err.message.includes('places first')) {
        setNotice('Place search is not ready yet. Download the Karlsruhe places and build the local search index first.')
      } else setNotice(err.message)
    } finally { setLoading(false) }
  }

  async function savePlace(place) {
    if (!token) { setAuthMode('login'); return }
    try {
      let currentTrips = trips
      if (currentTrips.length === 0) {
        const created = await api('/trips', { method: 'POST', body: JSON.stringify({ name: 'Karlsruhe ideas' }) }, token)
        currentTrips = [created]
        setTrips(currentTrips)
      }
      const trip = currentTrips[0]
      const updated = await api(`/trips/${trip.id}/places`, {
        method: 'POST',
        body: JSON.stringify({
          place_id: place.id, name: place.name, place_type: place.place_type,
          lat: place.lat, lon: place.lon, description: place.description, tags: place.tags,
        }),
      }, token)
      setTrips((items) => items.map((item) => item.id === updated.id ? updated : item))
      setSavedIds((ids) => new Set([...ids, place.id]))
    } catch (err) { setNotice(err.message) }
  }

  const signOutLink = user ? <><span className="user-email">{user.email}</span><button className="nav-text signout" onClick={signOut}><LogOut size={15} /> Sign out</button></> : <button className="nav-text" onClick={() => setAuthMode('login')}>Sign in</button>

  return (
    <div className="app-shell">
        <header className="topbar">
        <button className="brand" onClick={() => setPage('discover')}><span className="brand-mark"><Trees size={21} /></span><span className="brand-copy">Hidden gems<span>KARLSRUHE, GERMANY</span></span></button>
        <nav className={`top-nav ${mobileMenu ? 'open' : ''}`}>
          <button className={`nav-link ${page === 'discover' ? 'active' : ''}`} onClick={() => { setPage('discover'); setMobileMenu(false) }}>Discover</button>
          {user && <button className={`nav-link ${page === 'trips' ? 'active' : ''}`} onClick={() => { setPage('trips'); setMobileMenu(false) }}>My trips <span className="nav-count">{trips.length}</span></button>}
          <span className="nav-divider" />{signOutLink}
        </nav>
        <button className="icon-button menu-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle menu">{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button>
      </header>

      {page === 'trips' && user ? <TripsView trips={trips} setTrips={setTrips} token={token} onBack={() => setPage('discover')} onError={setNotice} /> : (
        <main className="discover-layout">
          <section className="discovery-panel">
            <div className="hero-intro"><span className="eyebrow"><span className="eyebrow-dot" /> THE OUTDOORS, A LITTLE CLOSER</span><h1>Find your<br /><em>somewhere.</em></h1><p className="hero-description">Tell us what kind of day you’re dreaming of. We’ll find a place around Karlsruhe that feels just right.</p></div>
            <form className="search-form" onSubmit={(event) => { event.preventDefault(); search() }}>
              <label className="sr-only" htmlFor="outing-search">Describe your outing</label>
              <textarea id="outing-search" rows="3" maxLength="1000" placeholder="A quiet place for a slow Sunday…" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); search() } }} />
              <div className="search-form-bottom"><span><Sparkles size={14} /> A little guidance, grounded in local places</span><button className="search-button" disabled={loading || question.trim().length < 3} aria-label="Search places">{loading ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={19} />}</button></div>
            </form>

            {!answer && !loading && places.length === 0 && <div className="examples"><div className="section-kicker">A FEW PLACES TO START</div>{examples.map((example) => <button className="example-row" key={example.text} onClick={() => search(example.text)}><span className="example-icon">{example.icon}</span><span><strong>{example.text}</strong><small>{example.detail}</small></span><ArrowUpRight size={16} className="example-arrow" /></button>)}</div>}
            {loading && <div className="loading-state"><span className="loading-orbit"><Leaf size={20} /></span><div><strong>Looking around for you…</strong><span>Finding places that fit your kind of day.</span></div></div>}
            {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
            {answer && <section className="answer-panel"><div className="answer-heading"><span className="answer-spark"><Sparkles size={15} /></span><span>A THOUGHTFUL PLACE TO BEGIN</span><button className="icon-button answer-clear" onClick={() => { setAnswer(''); setPlaces([]); setNotice('') }} aria-label="Clear search"><X size={16} /></button></div><p className="answer-copy">{answer}</p><div className="results-heading"><span>{places.length} {places.length === 1 ? 'place' : 'places'} to explore</span><span className="grounded-note"><Check size={13} /> From local map data</span></div><div className="place-list">{places.map((place, index) => <PlaceCard key={place.id} place={place} index={index} onSave={savePlace} saved={savedIds.has(place.id)} />)}</div></section>}
            <footer className="panel-footer"><span><span className="footer-dot" /> Made for curious days outside</span><a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">Powered by OpenStreetMap <ArrowUpRight size={12} /></a></footer>
          </section>
          <section className="map-panel" aria-label="Map of suggested outdoor places"><div className="map-ornament"><span>49°00′N</span><i /><span>08°24′E</span></div><PlaceMap places={places} /><div className="map-caption"><span className="caption-icon"><MapPin size={16} /></span><span><strong>{places.length ? 'Your next little escape' : 'A familiar place, seen differently'}</strong><small>{places.length ? 'Suggestions are marked on the map' : 'Your search will bring the map to life'}</small></span><span className="map-caption-arrow"><ArrowDownLeft size={17} /></span></div></section>
        </main>
      )}
      {authMode && <AuthDialog mode={authMode} setMode={setAuthMode} onClose={() => setAuthMode('')} onSuccess={handleAuth} />}
      {notice && page === 'trips' && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    </div>
  )
}
