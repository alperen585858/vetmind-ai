from fastapi import Depends, HTTPException, Request, status

from app.container import AppContainer
from app.services.analysis_application import AnalysisApplication
from app.services.case_collaboration import CaseCollaborationService
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.document_service import DocumentService
from app.services.messaging_facade import MessagingFacade
from app.services.pet_service import PetService
from app.services.report_application import ReportApplication
from app.services.submission_service import SubmissionService


def get_container(request: Request) -> AppContainer:
    return request.app.state.container


def get_case_service(request: Request) -> CaseService:
    return get_container(request).cases


def get_report_service(request: Request) -> ReportApplication:
    """Report drafts, review, delivery, and activity."""
    return get_container(request).reports


def get_analysis_service(request: Request) -> AnalysisApplication:
    """Synchronous and queued analysis plus job control."""
    return get_container(request).analysis


def get_collaboration_service(request: Request) -> CaseCollaborationService:
    """Case messages, AI chat, notes, and info requests."""
    return get_container(request).collaboration


def get_messaging_facade(request: Request) -> MessagingFacade:
    """Support threads and case-scoped chat behind one domain object."""
    return get_container(request).messaging_domain


def get_pet_service(request: Request) -> PetService:
    return get_container(request).pets


def get_submission_service(request: Request) -> SubmissionService:
    return get_container(request).submissions


def get_dicom_service(request: Request) -> DicomService:
    return get_container(request).dicom


def get_document_service(request: Request) -> DocumentService:
    return get_container(request).documents


def require_demo_deployment(container: AppContainer = Depends(get_container)) -> AppContainer:
    """Block demo-only endpoints (fixture DICOM, fake card pay) outside deployment_mode=demo."""
    if container.settings.deployment_mode != "demo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This demo-only endpoint is disabled when VETMIND_DEPLOYMENT_MODE=protected. "
                "Use real upload / payment integrations instead."
            ),
        )
    return container
