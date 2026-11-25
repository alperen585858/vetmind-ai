import { Navigate } from 'react-router-dom'
import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'
import { useLocale } from '../../shared/shell/LocaleContext'
import { localizePath } from '../../i18n/paths'

const DicomUpload = lazyPage(() => import('./DicomUpload'))

/**
 * #79: cases are opened from one place, "Yeni Vaka"; DICOM upload is its "Tetkik
 * Yükleme" step. Old /dicom-yukle links go there. Test builds (VITE_ENABLE_DEMO_FIXTURES=1)
 * keep the legacy page so the existing Playwright DICOM viewer suites still run.
 */
const LEGACY_DICOM_PAGE = import.meta.env.VITE_ENABLE_DEMO_FIXTURES === '1'

function ToNewCase() {
  const { locale } = useLocale()
  return <Navigate to={localizePath('/vakalar/yeni', locale)} replace />
}

export const dicomRoutes = [
  ...dualRoutes(
    'dicom-yukle',
    'dicom-upload',
    LEGACY_DICOM_PAGE ? <Gate roles={['vet']}><DicomUpload /></Gate> : <ToNewCase />,
  ),
]
