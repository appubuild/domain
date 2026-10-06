import ForgotPasswordPage from './ForgotPasswordPage';

/**
 * Reset links land on /reset-password?token=… — the same component handles both
 * stages, so this route simply reuses it.
 */
export default function ResetPasswordPage() {
  return <ForgotPasswordPage />;
}
