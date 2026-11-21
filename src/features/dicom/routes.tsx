import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const DicomUpload = lazyPage(() => import('./DicomUpload'))

export const dicomRoutes = [
  ...dualRoutes('dicom-yukle', 'dicom-upload', <Gate roles={['vet']}><DicomUpload /></Gate>),
]
