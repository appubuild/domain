import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from '@/providers/AppProviders';
import { AuthProvider } from '@/providers/AuthProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { AppRoutes } from '@/routes';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AppProviders>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </AppProviders>
      </ThemeProvider>
    </BrowserRouter>
  );
}
