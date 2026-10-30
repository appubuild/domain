import { lazy, Suspense, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Compass, Globe2, Languages, Layers3, LayoutDashboard, Map, MapPinned, Settings as SettingsIcon, ShieldCheck, UserRound } from 'lucide-react';
import { Link, NavLink, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { setLanguage, type Language } from '../../../packages/localization/src';
const CloudPanel = lazy(() => import('./cloud/CloudPanel').then(module => ({ default: module.CloudPanel })));
const SurveyPage = lazy(() => import('./survey/SurveyPage').then(module => ({ default: module.SurveyPage }))); 

function LanguageSelect({ id, label }: { id: string; label: string }) {
  const { i18n, t } = useTranslation();
  const [storageFailed, setStorageFailed] = useState(false);
  return <div className="language-control">
    <label className={id === 'header-language' ? 'sr-only' : 'field-label'} htmlFor={id}>{label}</label>
    <div className="language-select"><Languages size={17} aria-hidden="true" />
      <select id={id} value={i18n.resolvedLanguage === 'bn' ? 'bn' : 'en'} onChange={event => { void setLanguage(event.target.value as Language).then(saved => setStorageFailed(!saved)); }}>
        <option value="en">English</option><option value="bn">বাংলা</option>
      </select>
    </div>
    {storageFailed && <p className="storage-warning" role="status">{t('languageStorageWarning')}</p>}
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const links = [{ to: '/', icon: LayoutDashboard, label: t('home'), end: true }, { to: '/survey', icon: MapPinned, label: t('survey'), end: false }, { to: '/settings', icon: SettingsIcon, label: t('settings'), end: false }];
  return <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#main">{t('skip')}</a>
    <aside className="sidebar">
      <Link className="brand" to="/" aria-label={collapsed ? t('product') : undefined}><span className="brand-mark"><Compass size={23} strokeWidth={1.8} /></span><span className="brand-copy"><strong>{t('product')}</strong>{' '}<small>{t('tagline')}</small></span></Link>
      <div className="nav-heading">{t('breadcrumb')}</div>
      <nav className="primary-nav" aria-label={t('navigationLabel')}>
        {links.map(({ to, icon: Icon, label, end }) => <NavLink key={to} to={to} end={end} title={label} aria-label={label} className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}><Icon size={19} aria-hidden="true" /><span className="nav-text">{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-bottom"><div className="guest-sidebar"><UserRound size={18} aria-hidden="true"/><span className="nav-text"><strong>{t('guestTitle')}</strong><small>{t('guestBadge')}</small></span></div>
        <button type="button" className="collapse-button" onClick={() => setCollapsed(value => !value)} aria-label={t(collapsed ? 'expandSidebar' : 'collapseSidebar')} title={t(collapsed ? 'expandSidebar' : 'collapseSidebar')} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}<span className="nav-text">{t('collapseSidebar')}</span></button>
      </div>
    </aside>
    <div className="app-body"><header className="topbar"><div><span className="topbar-label">{t('breadcrumb')}</span><span className="topbar-divider">/</span><span>{t('guestBadge')}</span></div><LanguageSelect id="header-language" label={t('languageLabel')} /></header>
      <main id="main" tabIndex={-1}><div className="preview-notice"><strong>{t('previewTitle')}</strong> {t('previewNotice')}</div>{children}</main><footer><div className="footer-inner"><span>© Land Expert</span><span>{t('footer')}</span></div></footer>
    </div>
  </div>;
}
function Home() {
  const { t } = useTranslation();
  const principles = [ { icon: <Map />, title: 'principle1Title', body: 'principle1Body', number: '01' }, { icon: <ShieldCheck />, title: 'principle2Title', body: 'principle2Body', number: '02' }, { icon: <Globe2 />, title: 'principle3Title', body: 'principle3Body', number: '03' } ];
  return <div className="container"><div className="breadcrumb"><Layers3 size={15} aria-hidden="true" /> {t('breadcrumb')} <span>/</span> <strong>{t('home')}</strong></div>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><span />{t('eyebrow')}</div><h1>{t('title')}</h1><p>{t('intro')}</p></div><div className="hero-art" aria-hidden="true"><div className="art-grid"/><div className="art-circle circle-one"/><div className="art-circle circle-two"/><div className="art-cross cross-one">+</div><div className="art-cross cross-two">+</div><div className="art-compass"><Compass size={58} strokeWidth={0.8}/></div><div className="art-caption">LAND EXPERT <span> / </span> EST. FOR THE FIELD</div></div></section>
    <section className="foundation" aria-labelledby="foundation-title"><div className="foundation-icon"><Layers3 size={22}/></div><div><div className="section-label">{t('statusLabel')}</div><h2 id="foundation-title">{t('status')}</h2><p>{t('description')}</p></div><span className="status-dot" aria-hidden="true" /></section>
    <section className="guest-notice" aria-labelledby="guest-title"><UserRound size={21} aria-hidden="true"/><div><h2 id="guest-title">{t('guestTitle')}</h2><p>{t('guestDescription')}</p></div><Link to="/settings">{t('openSettings')} <ChevronRight size={16} aria-hidden="true"/></Link></section>
    <div className="principles">{principles.map(item => <section className="principle" key={item.number}><div className="principle-top"><span className="principle-icon">{item.icon}</span><span className="number">{item.number}</span></div><h2>{t(item.title)}</h2><p>{t(item.body)}</p></section>)}</div>
  </div>;
}
function SettingsPage() {
  const { t } = useTranslation();
  return <div className="container settings-page"><div className="breadcrumb"><Layers3 size={15} aria-hidden="true" /> {t('breadcrumb')} <span>/</span> <strong>{t('settings')}</strong></div>
    <header className="page-heading"><div className="section-label">{t('preferencesLabel')}</div><h1>{t('settings')}</h1><p>{t('settingsIntro')}</p></header>
    <section className="settings-card" aria-labelledby="language-heading"><div className="settings-icon"><Languages size={21} aria-hidden="true"/></div><div className="settings-content"><h2 id="language-heading">{t('languageSettingsTitle')}</h2><p>{t('languageSettingsDescription')}</p><LanguageSelect id="settings-language" label={t('displayLanguage')} /><p className="settings-hint">{t('reportLanguageNote')}</p></div></section>
    <section className="settings-card" aria-labelledby="guest-settings-heading"><div className="settings-icon"><UserRound size={21} aria-hidden="true"/></div><div className="settings-content"><h2 id="guest-settings-heading">{t('guestTitle')}</h2><p>{t('guestSettingsDescription')}</p></div></section>
    <Suspense fallback={<p role="status">{t('cloudLoading')}</p>}><CloudPanel /></Suspense>
  </div>;
}
function NotFound() { const { t } = useTranslation(); return <div className="container not-found"><h1>{t('notFoundTitle')}</h1><p>{t('notFoundBody')}</p><Link to="/"><ArrowLeft size={16}/> {t('backHome')}</Link></div>; }
function SurveyLoading() { const { t } = useTranslation(); return <>{t('mapLoading')}</>; }
export function App() { return <Shell><Routes><Route path="/" element={<Home/>}/><Route path="/survey" element={<Suspense fallback={<div className="container" role="status"><SurveyLoading /></div>}><SurveyPage/></Suspense>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="*" element={<NotFound/>}/></Routes></Shell>; }
