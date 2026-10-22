from fastapi import Request

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
