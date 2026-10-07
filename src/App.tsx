import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from '@/providers/AppProviders';
import { AuthProvider } from '@/providers/AuthProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { AppRoutes } from '@/routes';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ThemeProvider>
          <AppProviders>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </AppProviders>
        </ThemeProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
