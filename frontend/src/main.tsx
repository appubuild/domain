import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createApiClient } from './core/api/client';
import { ApiContext } from './core/api/context';
import { readRuntimeConfig } from './core/shell/config';
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
    <ApiContext.Provider value={client}>
      <App />
    </ApiContext.Provider>
  </StrictMode>,
);
