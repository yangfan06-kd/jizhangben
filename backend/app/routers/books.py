from fastapi import APIRouter, Depends, Request, Response, status

from ..dependencies import get_current_user_id
from ..schemas.books import (
    ApiWarning,
    BookCreateRequest,
    BookCreateResponse,
    BookListResponse,
    BookUpdateRequest,
    BookUpdateResponse,
)
from ..schemas.records import ErrorResponse
from ..services.book_service import create_book, delete_book, list_books, update_book


router = APIRouter(prefix="/api/books", tags=["books"])


@router.get("", response_model=BookListResponse)
def get_books(
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return {"items": list_books(request.app.state.database_path, current_user_id)}


@router.post(
    "",
    response_model=BookCreateResponse,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
)
def post_book(
    payload: BookCreateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    book, duplicate_name = create_book(
        request.app.state.database_path,
        current_user_id,
        payload.name,
        payload.group_name,
    )
    warnings = []
    if duplicate_name:
        warnings.append(
            ApiWarning(
                code="duplicate_book_name",
                message="当前用户已有同名账本，本次仍已创建",
            )
        )
    return {**book, "warnings": warnings}


@router.patch(
    "/{book_id}",
    response_model=BookUpdateResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def patch_book(
    book_id: str,
    payload: BookUpdateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    book, duplicate_name = update_book(
        request.app.state.database_path,
        current_user_id,
        book_id,
        payload.name,
        payload.group_name,
    )
    warnings = []
    if duplicate_name:
        warnings.append(
            ApiWarning(
                code="duplicate_book_name",
                message="当前用户已有同名账本，本次仍已修改",
            )
        )
    return {**book, "warnings": warnings}


@router.delete(
    "/{book_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
)
def delete_book_route(
    book_id: str,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> Response:
    delete_book(request.app.state.database_path, current_user_id, book_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
