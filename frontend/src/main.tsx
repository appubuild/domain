import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createApiClient } from './core/api/client';
import { ApiContext } from './core/api/context';
import { I18nProvider } from './core/i18n/I18nProvider';
import { preferredLocale } from './core/i18n/locale';
import { readRuntimeConfig } from './core/shell/config';
import { ThemeProvider } from './core/theme/ThemeProvider';
import './styles/theme.css';

/** The composition root of the window.
 *
 *  This is the only place that knows how the app is *delivered*: the desktop
 *  shell starts the service and hands the window its token in the query string
 *  (`ARCHITECTURE.md` §11); the dev server proxies a service started by hand.
 *  Everything below this file takes an `ApiClient` from context, which is what
 *  lets a component be rendered in a test without a service.
 */
const config = readRuntimeConfig();
const client = createApiClient({
  baseUrl: config.baseUrl,
  // Conditional rather than `token: config.token`: the dev server has no token
  // to hand out, and an explicit `undefined` is not the same as "not given".
  ...(config.token ? { token: config.token } : {}),
});

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root to mount into');

createRoot(container).render(
  <StrictMode>
    {/* Outside the API context and outside the app, because neither is about
        the other: the theme and the language are properties of the *window*, and
        a panel that needed a service to know what colour it is would be a panel
        that cannot be rendered in a test. */}
    <ThemeProvider>
      <I18nProvider locale={preferredLocale()}>
        <ApiContext.Provider value={client}>
          <App />
        </ApiContext.Provider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
