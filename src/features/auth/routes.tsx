import { Route } from 'react-router-dom'
import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const Login = lazyPage(() => import('./Login'))
const Register = lazyPage(() => import('./Register'))
const ForgotPassword = lazyPage(() => import('./ForgotPassword'))
const ResetPassword = lazyPage(() => import('./ResetPassword'))
const Settings = lazyPage(() => import('./Settings'))

export const publicAuthRoutes = [
  <Route key="giris" path="/giris" element={<Login />} />,
  <Route key="login" path="/login" element={<Login />} />,
  <Route key="kayit" path="/kayit" element={<Register />} />,
  <Route key="register" path="/register" element={<Register />} />,
  ...dualRoutes('/sifremi-unuttum', '/forgot-password', <ForgotPassword />),
  ...dualRoutes('/sifre-sifirla', '/reset-password', <ResetPassword />),
]

/** Emailed reset links work even when this browser is still signed in. */
export const signedInResetRoutes = [
  ...dualRoutes('/sifre-sifirla', '/reset-password', <ResetPassword />),
]

export const settingsRoutes = [
  ...dualRoutes(
    'ayarlar',
    'settings',
    <Gate roles={['vet', 'expert', 'owner', 'clinic_owner', 'admin']}>
      <Settings />
    </Gate>,
  ),
]
