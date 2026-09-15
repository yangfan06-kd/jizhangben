from datetime import date

from fastapi import APIRouter, Depends, Query, Request, status

from ..dependencies import get_current_user_id
from ..schemas.overview import OverviewResponse
from ..schemas.records import ErrorResponse
from ..services.overview_service import calculate_overview


router = APIRouter(tags=["overview"])


@router.get(
    "/api/overview",
    response_model=OverviewResponse,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
)
def get_overview(
    request: Request,
    period_from: date | None = Query(default=None, alias="from"),
    period_to: date | None = Query(default=None, alias="to"),
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return calculate_overview(
        request.app.state.database_path,
        current_user_id,
        period_from,
        period_to,
    )
