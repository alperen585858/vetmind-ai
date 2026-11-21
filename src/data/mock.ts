// Demo seed facade — prefer shared/demo or feature demo modules for new code.
export { ROLE_LABELS, USERS } from '../shared/demo/users'
export {
  CLINIC,
  EMPTY_NEURO,
  SAMPLE_FORM,
  SECTION_LABELS,
  getSectionLabels,
} from '../shared/demo/clinic'
export {
  KB_SOURCES,
  getKbSources,
  kbLicenseLabel,
  kbSourceText,
  kbTypeLabel,
} from '../features/rag-admin/demoKb'
export { DEPLOYMENTS, GPU_SERIES, SERVICES } from '../features/admin/demoInfra'
export { MODULES } from '../features/rag-admin/demoModules'
