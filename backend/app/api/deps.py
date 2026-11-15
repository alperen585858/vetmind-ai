from fastapi import Depends, HTTPException, Request, status

from app.container import AppContainer
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.document_service import DocumentService


def get_container(request: Request) -> AppContainer:
    return request.app.state.container


def get_case_service(request: Request) -> CaseService:
    return get_container(request).cases


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
