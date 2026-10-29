import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router';
import '../../../packages/localization/src';
import './styles.css';
import { App } from './App';

const routes = [{ path: '*', element: <App /> }];
const router = import.meta.env.VITE_ELECTRON === 'true' ? createHashRouter(routes) : createBrowserRouter(routes);
createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
