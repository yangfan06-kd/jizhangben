from fastapi import APIRouter, Depends, Request, status

from ..dependencies import get_current_user_id
from ..schemas.backups import BackupImportResponse, BackupPayload
from ..schemas.records import ErrorResponse
from ..services.backup_service import export_backup, import_backup


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
