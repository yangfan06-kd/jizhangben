from fastapi import APIRouter, Depends, Request, status

from ..dependencies import get_current_user_id
from typing import Any

from ..schemas.backups import BackupImportResponse, BackupPayload, BackupPreviewResponse
from ..schemas.records import ErrorResponse
from ..services.backup_service import export_backup, import_backup, preview_backup
from ..services.errors import BusinessValidationError
from ..services.local_backup_migration import LocalBackupMigrationError, convert_local_backup


router = APIRouter(tags=["backups"])


@router.get("/api/backups/export", response_model=BackupPayload)
def get_backup(
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return export_backup(request.app.state.database_path, current_user_id)


@router.post(
    "/api/backups/import",
    response_model=BackupImportResponse,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
)
def post_backup(
    payload: BackupPayload,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return import_backup(request.app.state.database_path, current_user_id, payload)


@router.post(
    "/api/backups/preview",
    response_model=BackupPreviewResponse,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
)
def post_backup_preview(
    payload: BackupPayload,
    _current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return preview_backup(payload)


@router.post(
    "/api/backups/preview-local",
    response_model=BackupPreviewResponse,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
)
def post_local_backup_preview(
    payload: dict[str, Any],
    _current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    try:
        converted = convert_local_backup(payload)
        server_payload = BackupPayload.model_validate(converted)
    except LocalBackupMigrationError as error:
        raise BusinessValidationError("backup_invalid", str(error)) from error
    return preview_backup(server_payload)
