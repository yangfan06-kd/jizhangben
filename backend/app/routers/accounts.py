from fastapi import APIRouter, Depends, Request, Response, status

from ..dependencies import get_current_user_id
from ..schemas.accounts import AccountCreateRequest, AccountListResponse, AccountResponse, AccountUpdateRequest
from ..schemas.records import ErrorResponse
from ..services.account_service import create_account, delete_account, list_accounts, update_account


router = APIRouter(prefix="/api/books/{book_id}/accounts", tags=["accounts"])


@router.get(
    "",
    response_model=AccountListResponse,
    responses={status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
)
def get_book_accounts(
    book_id: str,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return {
        "items": list_accounts(
            request.app.state.database_path,
            current_user_id,
            book_id,
        )
    }


@router.post(
    "",
    response_model=AccountResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
)
def post_book_account(
    book_id: str,
    payload: AccountCreateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return create_account(
        request.app.state.database_path,
        current_user_id,
        book_id,
        payload.name,
        payload.kind,
        payload.initial_cents,
    )


@router.patch(
    "/{account_id}",
    response_model=AccountResponse,
    responses={status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}, status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
)
def patch_book_account(
    book_id: str,
    account_id: str,
    payload: AccountUpdateRequest,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> dict[str, object]:
    return update_account(request.app.state.database_path, current_user_id, book_id, account_id, payload.name, payload.kind, payload.initial_cents)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT, responses={status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}})
def delete_book_account(
    book_id: str,
    account_id: str,
    request: Request,
    current_user_id: str = Depends(get_current_user_id),
) -> Response:
    delete_account(request.app.state.database_path, current_user_id, book_id, account_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
