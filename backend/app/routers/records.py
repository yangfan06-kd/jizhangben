from datetime import date

from fastapi import APIRouter, Depends, Query, Request, Response, status

from ..dependencies import get_current_user_id
from ..schemas.records import (
    ErrorResponse,
    RecordCreateRequest,
    RecordListResponse,
    RecordResponse,
)
from ..services.record_service import (
    NewRecord,
    create_record,
    delete_record,
    list_records,
    update_record,
)


router = APIRouter(prefix="/api/books/{book_id}/records", tags=["records"])


@router.get(
    "",
    response_model=RecordListResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def get_book_records(
    book_id: str,
    request: Request,
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    account_id: str | None = Query(default=None, min_length=1, max_length=100),
    category_id: str | None = Query(default=None, min_length=1, max_length=100),
    q: str | None = Query(default=None, max_length=1000),
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return {
        "items": list_records(
            request.app.state.database_path,
            current_user_id,
            book_id,
            from_date.isoformat() if from_date else None,
            to_date.isoformat() if to_date else None,
            account_id,
            category_id,
            q,
        )
    }


@router.post(
    "",
    response_model=RecordResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def create_book_record(
    book_id: str,
    payload: RecordCreateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    record = NewRecord(
        book_id=book_id,
        type_id=payload.type_id,
        category_id=payload.category_id,
        account_id=payload.account_id,
        to_account_id=payload.to_account_id,
        amount_cents=payload.amount_cents,
        occurred_on=payload.occurred_on.isoformat(),
        note=payload.note,
        deposit_direction=payload.deposit_direction,
        deposit_target=payload.deposit_target,
        deposit_link_id=payload.deposit_link_id,
        deposit_final=payload.deposit_final,
    )
    return create_record(request.app.state.database_path, current_user_id, record)


@router.delete(
    "/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
    },
)
def delete_book_record(
    book_id: str,
    record_id: str,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> Response:
    delete_record(
        request.app.state.database_path,
        current_user_id,
        book_id,
        record_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{record_id}",
    response_model=RecordResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def update_book_record(
    book_id: str,
    record_id: str,
    payload: RecordCreateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    record = NewRecord(
        record_id=record_id,
        book_id=book_id,
        type_id=payload.type_id,
        category_id=payload.category_id,
        account_id=payload.account_id,
        to_account_id=payload.to_account_id,
        amount_cents=payload.amount_cents,
        occurred_on=payload.occurred_on.isoformat(),
        note=payload.note,
        deposit_direction=payload.deposit_direction,
        deposit_target=payload.deposit_target,
        deposit_link_id=payload.deposit_link_id,
        deposit_final=payload.deposit_final,
    )
    return update_record(request.app.state.database_path, current_user_id, record)
